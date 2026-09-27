/**
 * @vitest-environment node
 *
 * 模型接入 · 启动环境与参数构建（4-test-cases.md 模块 B）
 *
 * 负责：
 * - buildLaunch 的环境清理、注入、--settings 覆盖、保留参数、两种模式差异
 * - Claude Code 版本检查（替身）与 settings 冲突检查
 *
 * @module tests/models/launchEnv.test
 */

import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { FAKE } from './helpers'

const require = createRequire(import.meta.url)
const { buildLaunch, isPrintMode, wantsJson } = require('../../electron/modules/models/launchEnv.js')
const { PRESETS } = require('../../electron/modules/models/presets.js')
const { checkClaudeVersion } = require('../../electron/modules/models/claudeCli.js')
const { findSettingsConflicts } = require('../../electron/modules/models/conflicts.js')

const KEY = 'sk-test-0123456789abcdef'
const MODEL = { name: 'deepseek-flash', effort: 'max', contextTokens: 1000000, maxOutputTokens: 384000, autoCompactWindow: 786432 }
const run = (mode, parentEnv = { PATH: '/usr/bin' }, userArgs = []) =>
  buildLaunch({ mode, preset: PRESETS.deepseek, model: MODEL, key: KEY, parentEnv, userArgs, modelsHome: '/tmp/mh' })

describe('模块 B · 环境', () => {
  it('TC-B01 清掉父环境的 ANTHROPIC_API_KEY', () => {
    expect('ANTHROPIC_API_KEY' in run('interactive', { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-ant-redacted' }).env).toBe(false)
  })
  it('TC-B02 清掉 CLAUDE_CODE_OAUTH_TOKEN', () => {
    expect('CLAUDE_CODE_OAUTH_TOKEN' in run('interactive', { PATH: '/usr/bin', CLAUDE_CODE_OAUTH_TOKEN: 'token_redacted' }).env).toBe(false)
  })
  it('TC-B03 ANTHROPIC_BASE_URL 为 DeepSeek 官方 Anthropic 地址', () => {
    expect(run('interactive', { PATH: '/usr/bin', ANTHROPIC_BASE_URL: 'https://example.invalid' }).env.ANTHROPIC_BASE_URL).toBe('https://api.deepseek.com/anthropic')
  })
  it('TC-B04 Key 放在 ANTHROPIC_AUTH_TOKEN，没有 ANTHROPIC_API_KEY', () => {
    const { env } = run('interactive')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe(KEY)
    expect('ANTHROPIC_API_KEY' in env).toBe(false)
  })
  it('TC-B05 六个模型变量都指向模型名', () => {
    const { env } = run('print', { PATH: '/usr/bin', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-4-5' }, ['--print'])
    for (const k of ['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_FABLE_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL']) {
      expect(env[k]).toBe('deepseek-flash')
    }
  })
  it('TC-B06 --settings 在最前面且 env 恰为四个键', () => {
    const { args } = run('interactive', { PATH: '/usr/bin' }, ['--permission-mode', 'plan'])
    expect(args[0]).toBe('--settings')
    expect(JSON.parse(args[1]).env).toEqual({
      CLAUDE_CODE_EFFORT_LEVEL: 'max',
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: '1000000',
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: '786432',
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: '384000',
    })
    expect(args.slice(2)).toEqual(['--permission-mode', 'plan'])
  })
  it('TC-B07 交互模式加 PROVIDER_MANAGED_BY_HOST 与 DISABLE_TELEMETRY', () => {
    const { env } = run('interactive')
    expect(env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST).toBe('1')
    expect(env.DISABLE_TELEMETRY).toBe('1')
  })
  it('TC-B08 后台模式不加 PROVIDER_MANAGED_BY_HOST', () => {
    expect('CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST' in run('print', { PATH: '/usr/bin', CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1' }, ['--print']).env).toBe(false)
  })
  it('TC-B09 不注入 SUBPROCESS_ENV_SCRUB', () => {
    expect('CLAUDE_CODE_SUBPROCESS_ENV_SCRUB' in run('interactive').env).toBe(false)
  })
  it('TC-B10 保留调用方的 SUBPROCESS_ENV_SCRUB 原值', () => {
    expect(run('interactive', { PATH: '/usr/bin', CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '0' }).env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB).toBe('0')
  })
  it('TC-B11 交互模式拒绝 --model', () => {
    expect(() => run('interactive', { PATH: '/usr/bin' }, ['--model', 'opus'])).toThrow(expect.objectContaining({ code: 'reserved_flag', message: '这个参数由 CodePal 管理：--model' }))
  })
  it('TC-B12 后台模式允许 --effort 且原样保留', () => {
    const { args } = run('print', { PATH: '/usr/bin' }, ['--print', '--effort', 'max', '--output-format', 'json'])
    expect(args.slice(3)).toEqual(['--print', '--effort', 'max', '--output-format', 'json'])
  })
  it('TC-B13 后台模式使用隔离配置目录', () => {
    expect(run('print', { PATH: '/usr/bin', CLAUDE_CONFIG_DIR: '/Users/x/.claude' }, ['--print']).env.CLAUDE_CONFIG_DIR).toBe('/tmp/mh/claude-home')
  })
  it('TC-B14 交互模式不动 CLAUDE_CONFIG_DIR 与 HOME', () => {
    const { env } = run('interactive', { PATH: '/usr/bin', HOME: '/Users/x', CLAUDE_CONFIG_DIR: '/Users/x/.claude' })
    expect(env.HOME).toBe('/Users/x')
    expect(env.CLAUDE_CONFIG_DIR).toBe('/Users/x/.claude')
  })
  it('TC-B17 后台模式参数每一项都是非空字符串', () => {
    const { args } = run('print', { PATH: '/usr/bin' }, ['--print', '--output-format', 'json'])
    expect(args.every((a) => typeof a === 'string' && a.length > 0)).toBe(true)
  })
  it('TC-B18 ELECTRON_RUN_AS_NODE 不传给 claude', () => {
    expect('ELECTRON_RUN_AS_NODE' in run('interactive', { PATH: '/usr/bin', ELECTRON_RUN_AS_NODE: '1' }).env).toBe(false)
  })
  it('TC-B19 交互模式拒绝 --autocompact', () => {
    expect(() => run('interactive', { PATH: '/usr/bin' }, ['--autocompact', 'off'])).toThrow(expect.objectContaining({ code: 'reserved_flag', message: '这个参数由 CodePal 管理：--autocompact' }))
  })
  it('TC-B20 拒绝 --model=值 写法，-- 之后不检查', () => {
    expect(() => run('interactive', { PATH: '/usr/bin' }, ['--model=opus'])).toThrow(expect.objectContaining({ code: 'reserved_flag', message: '这个参数由 CodePal 管理：--model' }))
    expect(run('interactive', { PATH: '/usr/bin' }, ['--', '--model']).args.slice(2)).toEqual(['--', '--model'])
  })
  it('TC-B21 -p 短写法识别为后台模式', () => {
    expect(isPrintMode(['-p', 'hi'])).toBe(true)
    expect(isPrintMode(['--permission-mode', 'plan'])).toBe(false)
  })
  it('TC-B22 清掉云厂商开关、替换父环境 AUTH_TOKEN、参数里没有 Key', () => {
    const { env, args } = run('print', { PATH: '/usr/bin', CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_USE_VERTEX: '1', CLAUDE_CODE_USE_FOUNDRY: '1', ANTHROPIC_AUTH_TOKEN: 'other-token' }, ['--print'])
    for (const k of ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) expect(k in env).toBe(false)
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe(KEY)
    expect(args.some((a) => a.includes('0123456789abcdef'))).toBe(false)
  })
  it('TC-B23 后台模式在覆盖后加 --setting-sources=，交互模式不加', () => {
    const print = run('print', { PATH: '/usr/bin' }, ['--print']).args
    expect(print[2]).toBe('--setting-sources=')
    expect(print.filter((a) => a.startsWith('--setting-sources'))).toHaveLength(1)
    expect(run('interactive').args.some((a) => a.startsWith('--setting-sources'))).toBe(false)
  })
  it('TC-B24 后台模式重试次数：默认 3、沿用调用方的值、测一下传 1；交互模式不设', () => {
    expect(run('print', { PATH: '/usr/bin' }, ['--print']).env.CLAUDE_CODE_MAX_RETRIES).toBe('3')
    expect(run('print', { PATH: '/usr/bin', CLAUDE_CODE_MAX_RETRIES: '5' }, ['--print']).env.CLAUDE_CODE_MAX_RETRIES).toBe('5')
    const t = buildLaunch({ mode: 'print', preset: PRESETS.deepseek, model: MODEL, key: KEY, parentEnv: { PATH: '/usr/bin' }, userArgs: ['--print'], modelsHome: '/tmp/mh', maxRetries: 1 })
    expect(t.env.CLAUDE_CODE_MAX_RETRIES).toBe('1')
    expect('CLAUDE_CODE_MAX_RETRIES' in run('interactive').env).toBe(false)
  })
  it('后台模式拒绝 --settings 与 --model', () => {
    expect(() => run('print', { PATH: '/usr/bin' }, ['--print', '--settings', '{}'])).toThrow(expect.objectContaining({ code: 'reserved_flag' }))
    expect(() => run('print', { PATH: '/usr/bin' }, ['--print', '--model', 'x'])).toThrow(expect.objectContaining({ code: 'reserved_flag' }))
  })
  it('wantsJson 识别两种写法', () => {
    expect(wantsJson(['--output-format', 'json'])).toBe(true)
    expect(wantsJson(['--output-format=json'])).toBe(true)
    expect(wantsJson(['--output-format', 'text'])).toBe(false)
  })
})

describe('模块 B · 版本与冲突', () => {
  afterEach(() => { delete process.env.FAKE_CLAUDE_MODE })

  it('TC-B15 版本太旧被拒绝并带当前版本', () => {
    process.env.FAKE_CLAUDE_MODE = 'oldversion'
    expect(checkClaudeVersion(FAKE)).toEqual({ ok: false, current: '2.1.200', required: '2.1.251' })
  })
  it('版本够新时通过', () => {
    expect(checkClaudeVersion(FAKE)).toEqual({ ok: true, current: '2.1.283', required: '2.1.251' })
  })

  it('TC-B16 settings 冲突只报字段名', () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'codepal-conf-')))
    try {
      fs.mkdirSync(path.join(root, '.claude'))
      fs.mkdirSync(path.join(root, 'proj'))
      fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify({ env: { ANTHROPIC_CUSTOM_HEADERS: 'X-Secret: v' } }))
      const found = findSettingsConflicts({ cwd: path.join(root, 'proj'), configDir: path.join(root, '.claude') })
      expect(found).toEqual(['env.ANTHROPIC_CUSTOM_HEADERS'])
      expect(JSON.stringify(found)).not.toContain('X-Secret')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
  it('被注入覆盖的 ANTHROPIC_* 与普通设置不算冲突，项目 settings 里的 apiKeyHelper 算冲突', () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'codepal-conf-')))
    try {
      fs.mkdirSync(path.join(root, 'cfg'))
      fs.mkdirSync(path.join(root, 'proj', '.claude'), { recursive: true })
      fs.mkdirSync(path.join(root, 'proj', '.git'))
      fs.writeFileSync(path.join(root, 'cfg', 'settings.json'), JSON.stringify({ model: 'opus', env: { ANTHROPIC_MODEL: 'x', ANTHROPIC_BASE_URL: 'y' } }))
      fs.writeFileSync(path.join(root, 'proj', '.claude', 'settings.local.json'), JSON.stringify({ apiKeyHelper: '/bin/echo' }))
      expect(findSettingsConflicts({ cwd: path.join(root, 'proj'), configDir: path.join(root, 'cfg') })).toEqual(['apiKeyHelper'])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
