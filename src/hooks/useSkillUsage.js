/**
 * useSkillUsage — 拉取每个 skill 近 N 天使用统计（Claude + Codex 合计）
 *
 * 负责：
 * - 调 IPC `aggregate-skill-usage`（后端发现 invocation 并从 ledger 聚合）
 * - 模块级缓存 5 分钟：切走切回不重复全扫；refreshToken 变了就跳过缓存重读
 * - 重读时旧次数留着，新结果到了就地换（不闪骨架）
 * - 返回 { status, usageMap(name→{total,claude,codex,lastUsedAt}), sources, scanMeta }
 *
 * @module hooks/useSkillUsage
 */
import { useEffect, useRef, useState } from 'react'

const STALE_MS = 5 * 60 * 1000
// 模块级缓存：跨页面切换复用，避免重复全扫
let usageCache = null // { key, at, data }

/** 清掉模块级缓存（测试用，也给需要强制重读的调用方） */
export function resetSkillUsageCache() {
  usageCache = null
}

/**
 * @param {string[]} skillNames - 当前已管理 skill 名（用于过滤噪声 + 限定统计范围）
 * @param {number} [windowDays=30] - 时间窗
 * @param {number} [refreshToken=0] - 变了就跳过缓存重读
 * @returns {{status:'loading'|'ready'|'error', usageMap:Map, sources:object|null, scanMeta:object|null}}
 */
export default function useSkillUsage(skillNames, windowDays = 30, refreshToken = 0) {
  const [status, setStatus] = useState('loading')
  const [usageMap, setUsageMap] = useState(() => new Map())
  const [sources, setSources] = useState(null)
  const [scanMeta, setScanMeta] = useState(null)
  const reqRef = useRef(0)
  const lastTokenRef = useRef(refreshToken)

  // 用排序后的名字串作为依赖键：内容变才重扫，避免数组每次新引用导致无限刷新
  const key = Array.isArray(skillNames) && skillNames.length ? [...skillNames].sort().join('|') : ''

  useEffect(() => {
    if (!key) {
      setStatus('ready'); setUsageMap(new Map()); setSources(null); setScanMeta(null)
      return
    }
    const api = typeof window !== 'undefined' ? window.electronAPI : null
    if (!api || typeof api.aggregateSkillUsage !== 'function') {
      setStatus('error')
      return
    }

    const apply = (data) => {
      const m = new Map()
      for (const s of data.skills || []) m.set(s.name, s)
      setUsageMap(m)
      setSources(data.scanMeta?.sources || data.sources || null)
      setScanMeta(data.scanMeta || null)
      setStatus('ready')
    }

    const forced = refreshToken !== lastTokenRef.current
    lastTokenRef.current = refreshToken
    // 命中缓存直接用（主动重读时跳过）
    if (!forced && usageCache && usageCache.key === key && Date.now() - usageCache.at < STALE_MS) {
      apply(usageCache.data)
      return
    }

    const myReq = ++reqRef.current
    setStatus('loading')
    api
      .aggregateSkillUsage({ windowDays, skillNames })
      .then((res) => {
        if (myReq !== reqRef.current) return // 已有更新的请求，丢弃旧结果
        if (!res || !res.success || !res.data) { setStatus('error'); return }
        usageCache = { key, at: Date.now(), data: res.data }
        apply(res.data)
      })
      .catch(() => { if (myReq === reqRef.current) setStatus('error') })
    // skillNames 故意不入依赖：其内容已由 key 表达，直接入会因引用变化触发无限循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, windowDays, refreshToken])

  return { status, usageMap, sources, scanMeta }
}
