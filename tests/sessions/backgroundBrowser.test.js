/* @vitest-environment node */
/** Multi-root read-only browser contract. @module tests/sessions/backgroundBrowser */
import { afterEach, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { makeProjectsDir, L, stamp } from './fixtures'
import { buildProjectMenu } from '../../src/pages/sessions/sessionView'
const require = createRequire(import.meta.url)
const { listRecent, readSessionPage, searchSessions } = require('../../electron/services/sessionBrowserService')
const dirs = []
function setup() {
  const main = makeProjectsDir(), bg = makeProjectsDir()
  dirs.push(main,bg)
  return { main,bg,options:{projectsDir:main.dir,backgroundProjectsDir:bg.dir} }
}
const lines = text => stamp([L.user(text), L.answer('回答 '+text), L.user('后续 '+text)],{cwd:'/tmp/demo'})
afterEach(()=>dirs.splice(0).forEach(d=>d.cleanup()))
it('TC-003 BACKGROUND_BROWSER namespaces only background IDs, same cwd groups unchanged and search/details stay in correct root', async () => {
  const d = setup()
  d.main.write('-demo','same',lines('普通正文'),new Date('2026-09-27'))
  d.bg.write('-demo','same',lines('后台正文'),new Date('2026-09-28'))
  d.bg.write('-demo','broken',['{broken'])
  const result = await listRecent(d.options)
  expect(result.sessions, 'BACKGROUND_BROWSER list').toHaveLength(2)
  const [bg,ordinary] = result.sessions
  expect(bg).toMatchObject({projectId:'codepal:-demo',sessionId:'same',source:'codepal',auto:true,projectPath:'/tmp/demo',projectName:'demo'})
  expect(ordinary).toMatchObject({projectId:'-demo',sessionId:'same',auto:false})
  expect(buildProjectMenu(result.sessions)).toHaveLength(1)
  const page = await readSessionPage(bg.projectId,bg.sessionId,{...d.options,limit:1})
  expect(page.messages[0].text).toBe('后续 后台正文')
  expect(page.hasMore).toBe(true)
  const previous = await readSessionPage(bg.projectId,bg.sessionId,{...d.options,before:page.cursor})
  expect(previous.messages.map(m=>m.text)).toEqual(['后台正文','回答 后台正文'])
  expect((await readSessionPage('-demo','same',d.options)).messages[0].text).toBe('普通正文')
  expect(await searchSessions('后台正文',d.options)).toEqual([])
  expect(await searchSessions('后台正文',{...d.options,includeAuto:true,projectPath:'/tmp/demo'})).toMatchObject([{projectId:bg.projectId,sessionId:'same'}])
  expect(await searchSessions('后台正文',{...d.options,includeAuto:true,projectPath:'/tmp/other'})).toEqual([])
})
it('TC-003 BACKGROUND_BROWSER missing main still exposes background, missing both is empty and alias roots list once', async()=>{
  const d=setup()
  d.bg.write('-demo','one',lines('后台'))
  fs.rmSync(d.main.dir,{recursive:true})
  const only=await listRecent(d.options)
  expect(only.projectsDirExists).toBe(true)
  expect(only.sessions).toHaveLength(1)
  fs.symlinkSync(d.bg.dir,d.main.dir)
  expect((await listRecent(d.options)).sessions).toHaveLength(1)
  fs.unlinkSync(d.main.dir)
  d.bg.cleanup()
  expect(await listRecent(d.options)).toEqual({projectsDirExists:false,sessions:[]})
})
it('TC-003 BACKGROUND_BROWSER rejects traversal, unknown source and symlink escape without exposing outside messages',async()=>{
  const d=setup()
  const outside=makeProjectsDir();dirs.push(outside)
  const file=outside.write('-secret','one',lines('outside text'))
  d.bg.write('-demo','safe',lines('safe text'))
  fs.symlinkSync(file,path.join(d.bg.dir,'-demo','escape.jsonl'))
  for(const [p,s] of [['codepal:../x','one'],['codepal:-demo','../one'],['nexus:-demo','one'],['codepal:-demo','escape']]) {
    await expect(readSessionPage(p,s,d.options)).rejects.toThrow()
  }
  const result=await listRecent(d.options)
  expect(result.sessions.map(s=>s.sessionId)).toEqual(['safe'])
  expect(await searchSessions('outside',{...d.options,includeAuto:true})).toEqual([])
})
