/**
 * 代码审核（lite.G1 第 3 轮）两条 P2 的回归测试
 *
 * 负责：
 * - 个人 Skill 目录存在但读不出（权限）：这个工具标成读不出，不当成一个都没装
 * - Codex 接口的输入管道报 EPIPE：接住并让调用按失败返回（不接住就是主进程的未捕获异常）
 * - 全部在 mkdtemp 临时目录；Codex 用注入的假进程
 *
 * @module tests/skills/reviewFixes3.test
 */

import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const service = require('../../electron/services/skillControlService')
const { openAppServer } = require('../../electron/services/codexHookTrust')

let sandbox
let homeDir
let repoPath

beforeEach(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'codepal-review-fixes3-'))
  homeDir = path.join(sandbox, 'home')
  repoPath = path.join(sandbox, 'catalog')
  await fs.mkdir(path.join(homeDir, '.codex'), { recursive: true })
  await fs.mkdir(path.join(repoPath, 'mine'), { recursive: true })
  await fs.writeFile(path.join(repoPath, 'mine', 'SKILL.md'), '---\nname: mine\ndescription: mine\n---\n')
})

afterEach(async () => {
  await fs.chmod(path.join(homeDir, '.claude', 'skills'), 0o755).catch(() => {})
  await fs.rm(sandbox, { recursive: true, force: true })
})

const noCodex = { codexAdapter: { discover: async () => ({ toolId: 'codex', sources: [], errors: [] }) }, skipPluginDiscovery: true }

describe('审核修复第 3 轮', () => {
  it('SKILL_DIR_UNREADABLE ~/.claude/skills 没有读权限：Claude 标成读不出，开关不可用、不算装载', async () => {
    const skillsDir = path.join(homeDir, '.claude', 'skills')
    await fs.mkdir(skillsDir, { recursive: true })
    await fs.chmod(skillsDir, 0o000)
    const snap = await service.getSkillControlSnapshot({ repoPath, homeDir }, noCodex)
    expect(snap.tools['claude-code'].load).toBeNull()
    expect(snap.skills.find((skill) => skill.name === 'mine').tools['claude-code']).toMatchObject({ state: 'unavailable', mutable: false })
  })

  it('APP_SERVER_EPIPE Codex 接口的输入管道报 EPIPE（进程还没退出）：调用按失败返回，不抛未捕获异常', async () => {
    // 假进程：stdin 写入后异步报 EPIPE，exit 事件不来；真机上是 Codex 中途关掉管道、退出事件还没到的那段窗口
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stdin = new EventEmitter()
    child.stdin.write = () => {
      setImmediate(() => child.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })))
      return true
    }
    child.kill = () => {}
    const server = openAppServer('/fake/codex', {}, () => child)
    const outcome = await Promise.race([
      server.call('skills/list', {}).then(() => 'resolved', (error) => error.code),
      new Promise((resolve) => setTimeout(() => resolve('hung'), 1000)),
    ])
    expect(outcome).toBe('EPIPE')
    await expect(server.call('skills/list', {})).rejects.toMatchObject({ code: 'EPIPE' })
    server.close()
  })
})

describe('隶属插件的来源（改读 Codex 官方接口）', () => {
  it('PLUGIN_OWNER_FROM_CODEX Codex 官方接口里带 pluginId 的同名 Skill：快照给出插件名，插件 Skill 本身不进列表', async () => {
    const skillDir = path.join(homeDir, '.agents', 'skills', 'page-solution-design')
    await fs.mkdir(skillDir, { recursive: true })
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: page-solution-design\ndescription: x\n---\n')
    const skillMd = await fs.realpath(path.join(skillDir, 'SKILL.md'))
    const api = {
      list: async () => [
        { name: 'page-solution-design', path: skillMd, enabled: true, pluginId: null },
        { name: 'dev-workflow:page-solution-design', path: '/plugins/dev-workflow/skills/page-solution-design/SKILL.md', enabled: true, pluginId: 'dev-workflow@local' },
        { name: 'other:off-plugin', path: '/plugins/other/skills/off-plugin/SKILL.md', enabled: false, pluginId: 'other@local' },
      ],
      write: async () => ({}),
    }
    const snap = await service.getSkillControlSnapshot({ repoPath, homeDir }, { codexSkillApi: api, skipPluginDiscovery: true })
    expect(snap.skills.find((skill) => skill.name === 'page-solution-design').plugins).toEqual(['dev-workflow'])
    expect(snap.skills.some((skill) => skill.name.includes(':'))).toBe(false)
    expect(snap.skills.some((skill) => skill.name === 'off-plugin')).toBe(false)
  })
})
