/**
 * useSkillUsage — 拉取近 N 天 Skill 次数，统计仍由主进程负责
 * - 运行上下文、时间窗和稳定名字集合共同限定五分钟缓存
 * - 回访第一帧同步展示旧次数；手动刷新跳过缓存，旧次数保留到新结果返回
 * @module hooks/useSkillUsage
 */
import { useEffect, useRef, useState } from 'react'

const STALE_MS = 5 * 60 * 1000
let usageCache = null
let usageVersion = 0

/** 清除次数缓存，不修改后端调用账本。 */
export function resetSkillUsageCache() {
  usageCache = null
  usageVersion += 1
}

/**
 * @param {object|null} data
 * @returns {object} 页面可展示的次数状态
 */
function viewOf(data) {
  const usageMap = new Map()
  for (const skill of data?.skills || []) usageMap.set(skill.name, skill)
  return { status: data ? 'ready' : 'loading', usageMap, sources: data?.scanMeta?.sources || data?.sources || null, scanMeta: data?.scanMeta || null }
}

/**
 * @param {string[]} skillNames 当前技能集合
 * @param {number} [windowDays=30] 时间窗
 * @param {number} [refreshToken=0] 变更时强制重读
 * @returns {object} 次数与扫描状态
 */
export default function useSkillUsage(skillNames, windowDays = 30, refreshToken = 0) {
  const api = typeof window !== 'undefined' ? window.electronAPI : null
  const names = Array.isArray(skillNames) ? [...new Set(skillNames)].sort() : []
  const key = names.length ? JSON.stringify([windowDays, names]) : ''
  const cached = usageCache?.api === api && usageCache.key === key ? usageCache.data : null
  const [view, setView] = useState(() => ({ ...viewOf(cached), key, api }))
  const reqRef = useRef(0)
  const lastTokenRef = useRef(refreshToken)

  useEffect(() => {
    let active = true
    const requestId = ++reqRef.current
    const apply = (data) => setView({ ...viewOf(data), key, api })
    if (!key) {
      apply({ skills: [] })
      return undefined
    }
    if (!api?.aggregateSkillUsage) {
      setView({ ...viewOf(cached), key, api, status: 'error' })
      return undefined
    }
    const forced = refreshToken !== lastTokenRef.current
    lastTokenRef.current = refreshToken
    if (!forced && usageCache?.api === api && usageCache.key === key && Date.now() - usageCache.at < STALE_MS) {
      apply(usageCache.data)
      return undefined
    }
    setView((previous) => ({ ...viewOf(previous.key === key && previous.api === api ? { skills: [...previous.usageMap.values()], sources: previous.sources, scanMeta: previous.scanMeta } : cached), key, api, status: 'loading' }))
    const version = ++usageVersion
    api.aggregateSkillUsage({ windowDays, skillNames: names }).then((result) => {
      if (requestId !== reqRef.current) return
      if (!result?.success || !result.data) {
        if (active) setView((previous) => ({ ...previous, status: 'error' }))
        return
      }
      if (version === usageVersion) usageCache = { key, api, at: Date.now(), data: result.data }
      if (active) apply(result.data)
    }).catch(() => {
      if (active && requestId === reqRef.current) setView((previous) => ({ ...previous, status: 'error' }))
    })
    return () => { active = false }
    // 名字数组的内容已完整进入稳定 key，引用变化不触发扫描。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, key, refreshToken])

  // 资产集合变化时，在 effect 前也不显示其它集合的次数。
  return view.key === key && view.api === api ? view : { ...viewOf(cached), key, api }
}
