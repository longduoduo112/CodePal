/* @vitest-environment node */
/** Subscription sources remain independent from background API usage. @module tests/sharedUsage/backgroundPlanGuard */
import { expect, it } from 'vitest'
import { createRequire } from 'node:module'
const require=createRequire(import.meta.url)
const {createSharedUsageStatistics,SCHEMA,SEMANTICS}=require('../../electron/services/sharedUsageStatistics')
const {aggregatePlanCosts}=require('../../electron/services/plan/planUsageService')
it('TC-005 existing Claude/GPT value excludes third-party models and codepal partition',async()=>{
  const row=(model,source)=>({model,source,input:100,output:0,cacheRead:0,cacheCreate:0,timestamp:'2026-09-27T03:00:00Z'})
  const rows=[row('claude-opus-5','claude'),row('gpt-6-astra','codex'),...['deepseek-flash','mimo-v2-pro','glm-5.3'].map(m=>row(m,'claude')),row('claude-opus-5','codepal'),row('gpt-6-astra','codepal')]
  const prices={aliases:{},models:Object.fromEntries(rows.map(r=>[r.model,{input:1,output:1,cacheRead:1,cacheWrite:1}]))}
  expect((await aggregatePlanCosts('claude',rows,prices)).total).toBe(0.0001)
  expect((await aggregatePlanCosts('codex',rows,prices)).total).toBe(0.0001)
  const partition=records=>({status:'ready',complete:true,cutoff:'2026-09-27T16:00:00Z',records})
  const entry={schemaVersion:SCHEMA,semantics:SEMANTICS,date:'2026-09-27',cutoff:'2026-09-27T16:00:00Z',sources:{claude:partition([rows[0]]),codex:partition([rows[1]]),dsh:partition([]),codepal:partition(rows.slice(-2))}}
  const service=createSharedUsageStatistics({storage:{read:async k=>k==='metadata'?null:entry,write:async()=>{},list:async()=>['2026-09-27']},scanFn:async()=>{throw Error('must reuse cache')},sourceStatusFn:async()=> 'present',legacyReadFn:async()=>null,nowFn:()=>new Date('2026-09-28T04:00:00Z')})
  for(const id of ['claude','codex'])expect((await service.getPlanTokens(id,{start:'2026-09-27',end:'2026-09-28'})).records).toHaveLength(1)
})
