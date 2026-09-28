/** @vitest-environment node
 * 渠道命令命名、同步与整批冲突保护。
 * @module tests/models/providerCommands.test
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { makeSandbox, CLI, KEY, readReport } from './helpers'
const require = createRequire(import.meta.url)
const store = require('../../electron/modules/models/store.js')
const commands = require('../../electron/modules/models/commands.js')
let sb
const install = () => commands.installCommands({ appExecPath: process.execPath, cliPath: CLI })
const snapshot = () => fs.existsSync(sb.bin) ? Object.fromEntries(fs.readdirSync(sb.bin).map(n => [n, fs.readFileSync(path.join(sb.bin, n), 'utf8')])) : {}
beforeEach(() => {
  sb = makeSandbox()
  for (const [k, v] of Object.entries(sb.env)) vi.stubEnv(k, v)
})
afterEach(() => { vi.unstubAllEnvs(); sb.cleanup() })
describe('TC-002 CHANNEL_COMMANDS', () => {
  it('同模型按渠道生成命令，稳定入口在改名和移除后跟随首模型', () => {
    expect(commands.commandName('glm-5.3', 'zhipu-api'), 'CHANNEL_COMMANDS').toBe('codepal-zhipu-api--glm-5.3')
    for (const id of ['zhipu-api', 'zhipu-coding', 'deepseek']) store.setKey(id, KEY)
    const installed = install().installed
    expect(installed).toEqual(expect.arrayContaining(['codepal-zhipu-api--glm-5.3', 'codepal-zhipu-coding--glm-5.3', 'codepal-deepseek-flash', 'codepal-deepseek']))
    for (const id of ['zhipu-api', 'zhipu-coding']) expect(snapshot()[`codepal-${id}--glm-5.3`]).toContain(`launch ${id} glm-5.3`)
    store.updateModel('zhipu-api', 'glm-5.3', { name: 'glm-renamed' })
    store.addModel('zhipu-api', 'glm-next')
    commands.syncCommands()
    expect(snapshot()['codepal-zhipu-api--glm-5.3']).toBeUndefined()
    const launchFirst = () => {
      const result = spawnSync(path.join(sb.bin, 'codepal-zhipu-api'), ['--print', '--output-format', 'json'], { env: sb.env, encoding: 'utf8', input: 'fixture' })
      expect(result.status).toBe(0)
      return readReport(sb.report).env.ANTHROPIC_MODEL
    }
    expect(launchFirst()).toBe('glm-renamed')
    store.removeModel('zhipu-api', 'glm-renamed')
    commands.syncCommands()
    expect(launchFirst()).toBe('glm-next')
    store.removeModel('zhipu-api', 'glm-next')
    commands.syncCommands()
    expect(Object.keys(snapshot()).filter(n => n.startsWith('codepal-zhipu-api'))).toEqual([])
    expect(store.readKey('zhipu-api')).toBe(KEY)
    expect(snapshot()['codepal-zhipu-coding']).toBeDefined()
  })
  it('跨渠道大小写碰撞先拒绝，现有命令零改动', () => {
    expect(commands.commandName('x', 'mimo-api'), 'CHANNEL_COMMANDS').toBe('codepal-mimo-api--x')
    store.setKey('deepseek', KEY)
    store.setKey('mimo-api', KEY)
    store.addModel('mimo-api', 'shared')
    install()
    const before = snapshot()
    store.addModel('deepseek', 'MIMO-API--SHARED')
    expect(install).toThrow(/冲突/)
    expect(snapshot()).toEqual(before)
    expect(() => commands.syncCommands()).toThrow(/冲突/)
    expect(snapshot()).toEqual(before)
  })
  it('非 CodePal 文件占用时不先写前面的命令', () => {
    expect(commands.commandName('x', 'kimi-coding'), 'CHANNEL_COMMANDS').toBe('codepal-kimi-coding--x')
    store.setKey('deepseek', KEY)
    store.setKey('kimi-coding', 'fixture.kimi')
    fs.mkdirSync(sb.bin, { recursive: true })
    fs.writeFileSync(path.join(sb.bin, 'codepal-kimi-coding'), 'user-owned')
    const before = snapshot()
    expect(install).toThrow(/占用/)
    expect(snapshot()).toEqual(before)
  })
})
