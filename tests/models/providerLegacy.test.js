/** @vitest-environment node
 * 手写历史配置验证兼容性，避免用新实现生成旧样本。
 * @module tests/models/providerLegacy.test
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { makeSandbox, CLI, KEY, runCli, readReport } from './helpers'
const require = createRequire(import.meta.url)
const store = require('../../electron/modules/models/store.js')
const commands = require('../../electron/modules/models/commands.js')
let sb
beforeEach(() => {
  sb = makeSandbox()
  for (const [k, v] of Object.entries(sb.env)) vi.stubEnv(k, v)
})
afterEach(() => { vi.unstubAllEnvs(); sb.cleanup() })
describe('TC-006 历史 DeepSeek', () => {
  it('旧配置、Key、状态读取不变；命令和启动不迁移用户设置', () => {
    const model = { id: 'deepseek-flash', name: 'deepseek-flash', effort: 'xhigh', contextTokens: 1000000, maxOutputTokens: 384000, autoCompactWindow: 786432 }
    const cfg = { schemaVersion: 1, commandsInstalled: false, providers: { deepseek: { keySet: true, models: [model] } } }
    const status = { ok: true, reason: null, at: '2026-09-26T00:00:00Z', source: 'test' }
    for (const sub of ['secrets', 'status']) fs.mkdirSync(path.join(sb.models, sub), { recursive: true })
    fs.writeFileSync(path.join(sb.models, 'models.json'), JSON.stringify(cfg))
    fs.writeFileSync(path.join(sb.models, 'secrets/deepseek.key'), KEY, { mode: 0o600 })
    fs.writeFileSync(path.join(sb.models, 'status/deepseek__deepseek-flash.json'), JSON.stringify(status))
    expect(store.readConfig()).toEqual(cfg)
    expect(store.readKey('deepseek')).toBe(KEY)
    expect(store.readStatuses()['deepseek__deepseek-flash']).toEqual(status)
    const settings = path.join(sb.home, '.claude/settings.json')
    fs.mkdirSync(path.dirname(settings), { recursive: true })
    fs.writeFileSync(settings, '{"theme":"dark"}')
    expect(commands.installCommands({ appExecPath: process.execPath, cliPath: CLI }).installed).toEqual(['codepal-deepseek-flash', 'codepal-deepseek'])
    const result = runCli(['launch', 'deepseek', '@first', '--', '--print'], { env: sb.env })
    expect(result.status).toBe(0)
    const report = readReport(sb.report)
    expect(report.env).toMatchObject({ ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic', ANTHROPIC_MODEL: 'deepseek-flash' })
    expect(report.envNames).toContain('ANTHROPIC_AUTH_TOKEN')
    expect(report.envNames).not.toContain('ANTHROPIC_API_KEY')
    expect(JSON.parse(report.argv[1]).env).toMatchObject({ CLAUDE_CODE_EFFORT_LEVEL: 'xhigh', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '384000' })
    expect(store.readConfig().providers).toEqual(cfg.providers)
    expect(store.readStatuses()['deepseek__deepseek-flash']).toEqual(status)
    expect(fs.readFileSync(settings, 'utf8')).toBe('{"theme":"dark"}')
  })
})
