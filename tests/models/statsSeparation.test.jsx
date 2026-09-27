/**
 * 模型接入 · 统计区分（4-test-cases.md 模块 G）
 *
 * 负责：
 * - 对话回顾：详情元信息给非 Claude 模型的会话接上模型名，Claude 模型不接，列表不变（G01–G03）
 * - 会话服务返回最后一条助手消息的模型（G04）
 * - 回归：订阅管理不把 DeepSeek 算进 Claude（G05）；用量监测把一天 ≥100 万 token 的 DeepSeek 单列一行（G06）
 *
 * @module tests/models/statsSeparation.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRequire } from 'node:module'
import SessionBrowserPage from '../../src/pages/SessionBrowserPage'
import { resetSessionCacheForTests } from '../../src/hooks/useSessionBrowser'
import { getModelRows } from '../../src/pages/usage/calendarUtils'
import { L, stamp, makeProjectsDir } from '../sessions/fixtures'

const require = createRequire(import.meta.url)
const sessionService = require('../../electron/services/sessionBrowserService.js')
const { aggregatePlanCosts } = require('../../electron/services/plan/planUsageService.js')
const { parseClaudeLog } = require('../../electron/services/usageLogScan/claude.js')

const BASE = new Date(2026, 8, 26, 12, 0, 0).getTime()
const session = (o) => ({
  projectId: '-p-proj', projectPath: '/Users/x/proj', projectName: 'proj', parentDir: '~', branch: 'main',
  preview: null, auto: false, title: '一段对话', modifiedAt: new Date(BASE - 5 * 60000).toISOString(), ...o,
})
const PAGE = { messages: [{ offset: 10, kind: 'ask', text: '你好', toolUses: [], timestamp: new Date(BASE).toISOString() }, { offset: 20, kind: 'answer', text: '在的', toolUses: [], timestamp: new Date(BASE).toISOString() }], hasMore: false, cursor: 0 }

/** 渲染对话回顾，列表只有一条会话 */
async function renderSessions(one) {
  window.electronAPI = {
    listRecentSessions: vi.fn(async () => ({ success: true, data: { projectsDirExists: true, sessions: [one] }, error: null })),
    readSession: vi.fn(async () => ({ success: true, data: PAGE, error: null })),
    searchSessions: vi.fn(async () => ({ success: true, data: [], error: null })),
    readSessionCwd: vi.fn(async () => ({ success: true, cwd: '/Users/x/proj', cwdExists: true })),
    launchSessionInTerminal: vi.fn(async () => ({ success: true })),
  }
  const utils = render(<SessionBrowserPage />)
  await waitFor(() => expect(document.querySelector('.np-row--rec')).not.toBeNull())
  return utils
}

/** 打开第一条会话，返回详情元信息文本 */
async function openMeta() {
  fireEvent.click(document.querySelector('.np-row--rec'))
  await screen.findByText('在的')
  return document.querySelector('.np-detail-hd .meta > span').textContent
}

describe('模块 G · 对话回顾', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: BASE, shouldAdvanceTime: true })
    resetSessionCacheForTests()
    localStorage.clear()
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    delete window.electronAPI
  })

  it('TC-G01 详情元信息接上非 Claude 模型名', async () => {
    await renderSessions(session({ sessionId: 'g1', model: 'deepseek-flash' }))
    const meta = await openMeta()
    expect(meta.endsWith(' · deepseek-flash')).toBe(true)
    expect(meta.startsWith('proj · main · ')).toBe(true)
  })

  it('TC-G02 Claude 模型不接模型名', async () => {
    await renderSessions(session({ sessionId: 'g2', model: 'claude-opus-5' }))
    const meta = await openMeta()
    expect(meta).not.toContain('claude-opus-5')
  })

  it('TC-G03 列表行不显示模型', async () => {
    await renderSessions(session({ sessionId: 'g3', model: 'deepseek-flash' }))
    expect(document.querySelector('.np-scroll').textContent).not.toContain('deepseek-flash')
  })
})

describe('模块 G · 会话服务', () => {
  let p
  beforeEach(() => { p = makeProjectsDir() })
  afterEach(() => p.cleanup())

  const answerBy = (model, text) => ({ ...L.answer(text), message: { ...L.answer(text).message, model } })

  it('TC-G04 返回最后一条助手消息的模型；<synthetic> 不算', async () => {
    p.write('-a', 'mixed', stamp([L.user('问'), answerBy('claude-opus-5', '一'), answerBy('deepseek-flash', '二'), answerBy('<synthetic>', 'API Error')], { cwd: '/tmp/a' }))
    p.write('-a', 'none', stamp([L.user('只有提问')], { cwd: '/tmp/a' }))
    const { sessions } = await sessionService.listRecent({ projectsDir: p.dir })
    const byId = Object.fromEntries(sessions.map((s) => [s.sessionId, s]))
    expect(byId.mixed.model).toBe('deepseek-flash')
    expect(byId.none.model).toBeNull()
  })
})

describe('模块 G · 回归', () => {
  it('TC-G05 订阅管理不把 deepseek-flash 算进 Claude 订阅', async () => {
    const pricing = { models: { 'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 } }, aliases: {} }
    const r = await aggregatePlanCosts('claude', [{ source: 'claude', model: 'deepseek-flash', input: 100, output: 10, cacheRead: 0, cacheCreate: 0, timestamp: '2026-09-26T04:00:00Z' }], pricing)
    expect(r.models.some((m) => /deepseek/i.test(m.key || m.name))).toBe(false)
    expect(r.excludedModels.map((e) => e.model)).toContain('deepseek-flash')
  })

  it('TC-G06 用量监测把一天 ≥100 万 token 的 deepseek-flash 单列一行', () => {
    const line = JSON.stringify({ type: 'assistant', timestamp: '2026-09-26T04:00:00Z', message: { model: 'deepseek-flash', usage: { input_tokens: 1000000, output_tokens: 200000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } })
    const rec = parseClaudeLog(line)
    expect(rec.model).toBe('deepseek-flash')
    const total = rec.input + rec.output + rec.cacheRead + rec.cacheCreate
    expect(total).toBe(1200000)
    const rows = getModelRows({ 'deepseek-flash': { total }, 'claude-opus-5': { total: 3000000 } })
    expect(rows).toContainEqual({ name: 'deepseek-flash', total: 1200000 })
  })
})
