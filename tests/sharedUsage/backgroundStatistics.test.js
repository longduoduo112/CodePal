/* @vitest-environment node */
/** Source partition migration and consumer consistency. @module tests/sharedUsage/backgroundStatistics */
import { expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createSharedUsageStatistics } = require('../../electron/services/sharedUsageStatistics')
const rec = (n, timestamp, model = 'deepseek-flash') => ({ model, input: n, output: 2, cacheRead: 3, cacheCreate: 4, timestamp, project: 'demo' })
function fixture() {
  const entries = new Map()
  let now = new Date('2026-09-28T04:00:00Z')
  const storage = { read: async k => structuredClone(entries.get(k) || null), write: async (k,v) => entries.set(k, structuredClone(v)), list: async () => [...entries.keys()].filter(k => /^\d{4}-/.test(k)) }
  const scanFn = vi.fn(async (id,start) => [rec(10, start.toISOString(), id === 'claude' ? 'claude-opus-5' : 'gpt-6-astra')])
  const deps = { storage, scanFn, sourceStatusFn: async () => 'present', earliestFn: async () => '2026-09-27', legacyReadFn: async () => null, nowFn: () => now }
  const background = { status: vi.fn(async () => 'present'), scan: vi.fn(async (start) => [rec(100,start.toISOString())]), earliest: vi.fn(async () => '2026-09-26') }
  return { entries, deps, scanFn, background, setNow: v => { now = new Date(v) } }
}
it('TC-002 BACKGROUND_STATISTICS supplements closed cache once, preserves primary partitions and old discovered earliest', async () => {
  const d = fixture()
  const old = createSharedUsageStatistics(d.deps)
  await old.getCalendar({ month: '2026-09' })
  const primary = structuredClone(d.entries.get('2026-09-27').sources)
  d.scanFn.mockClear()
  const s = createSharedUsageStatistics({ ...d.deps, background: d.background })
  await s.ensureRange('2026-09-27', '2026-09-28')
  expect((await s.readLegacyDay('2026-09-27')).summary.total, 'BACKGROUND_STATISTICS totals').toBe(166)
  expect(d.scanFn).not.toHaveBeenCalled()
  expect(d.background.scan).toHaveBeenCalledTimes(1)
  for (const id of ['claude','codex','dsh']) expect(d.entries.get('2026-09-27').sources[id]).toEqual(primary[id])
  await s.ensureRange('2026-09-27', '2026-09-28')
  const restart = createSharedUsageStatistics({ ...d.deps, background: d.background })
  await restart.ensureRange('2026-09-27', '2026-09-28')
  expect(d.background.scan).toHaveBeenCalledTimes(1)
  expect(await restart.getEarliestDate()).toBe('2026-09-26')
  const c = await restart.getCalendar({ month: '2026-09' })
  expect(c.days['2026-09-27'].total).toBe(166)
  expect(c.days['2026-09-27'].models['deepseek-flash'].total).toBe(109)
  const today = await restart.getTodayAggregates()
  expect(today.models.get('deepseek-flash').total).toBe(109)
  expect([...today.models.keys()]).not.toContain('codepal')
  expect((await restart.getPlanTokens('claude', { start: '2026-09-27', end: '2026-09-28' })).records.map(r=>r.input)).toEqual([10])
})
it('TC-002 BACKGROUND_STATISTICS keeps legacy object verbatim and adds background only when reading, including after restart', async () => {
  const d = fixture()
  const legacy = { version: 6, date: '2026-09-27', models: { 'gpt-6-astra': { input: 500, output: 0, cacheRead: 0, cacheCreate: 0, total: 500 } }, projects: { demo: { value: 500 } }, summary: { total: 500, input: 500, output: 0, cache: 0 }, generatedAt: '2026-09-27T16:00:00Z' }
  d.deps.sourceStatusFn = async () => 'missing'
  d.deps.legacyReadFn = async key => key === '2026-09-27' ? structuredClone(legacy) : null
  const old = createSharedUsageStatistics(d.deps)
  await old.ensureRange('2026-09-27','2026-09-28')
  const s = createSharedUsageStatistics({ ...d.deps, background: d.background })
  await s.ensureRange('2026-09-27','2026-09-28')
  expect((await s.readLegacyDay('2026-09-27')).summary.total).toBe(609)
  expect(JSON.stringify(d.entries.get('2026-09-27').legacy)).toBe(JSON.stringify(legacy))
  const restarted = createSharedUsageStatistics({ ...d.deps, background: d.background })
  expect((await restarted.getCalendar({ month:'2026-09' })).days['2026-09-27'].total).toBe(609)
  expect(d.entries.get('2026-09-27').legacy).toEqual(legacy)
  await expect(restarted.getPlanTokens('codex', {start:'2026-09-27',end:'2026-09-28'})).rejects.toThrow('SOURCE_UNVERIFIABLE')
})
it('TC-002 BACKGROUND_STATISTICS failure marks day/range failed, preserves plan and retries only failed source, tick refreshes live partition', async () => {
  const d = fixture()
  d.background.scan.mockRejectedValueOnce(Error('EACCES'))
  const s = createSharedUsageStatistics({ ...d.deps, background:d.background })
  await s.ensureRange('2026-09-27','2026-09-28')
  await expect(s.readLegacyDay('2026-09-27',{ensure:true})).rejects.toThrow('SOURCE_FAILED')
  const c = await s.getCalendar({month:'2026-09'})
  expect(c.days['2026-09-27'].status).toBe('failed')
  expect(c.complete).toBe(false)
  expect((await s.getPlanTokens('codex',{start:'2026-09-27',end:'2026-09-28'})).records).toHaveLength(1)
  d.scanFn.mockClear()
  await s.getCalendar({month:'2026-09',retryDate:'2026-09-27'})
  expect(d.scanFn).not.toHaveBeenCalled()
  expect((await s.readLegacyDay('2026-09-27')).summary.total).toBe(166)
  d.setNow('2026-09-28T04:05:00Z')
  d.background.scan.mockImplementation(async start => [rec(200,start.toISOString())])
  await s.tick()
  expect((await s.getTodayAggregates()).models.get('deepseek-flash').total).toBe(209)
})
it('TC-002 BACKGROUND_STATISTICS missing background is zero without scans', async () => {
  const d = fixture()
  d.background.status.mockResolvedValue('missing')
  const s = createSharedUsageStatistics({...d.deps,background:d.background})
  await s.ensureRange('2026-09-27','2026-09-28')
  expect(d.entries.get('2026-09-27').sources.codepal?.status).toBe('missing')
  expect((await s.readLegacyDay('2026-09-27')).summary.total).toBe(57)
  expect(d.background.scan).not.toHaveBeenCalled()
})
