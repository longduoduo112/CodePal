/**
 * Skill 快照、Claude 开关核对、删除（specs/skills-redesign-dev TC-001–004、009–013、036、039）
 *
 * 负责：
 * - 装载汇总（个人开着的 + claude.ai 同步 / Codex 系统自带，插件不算）与上下文估算
 * - 同一工具两份、位置（完整路径、快捷方式实际位置、不在了）
 * - Claude 写完核对、写回、状态不确定
 * - 删除：资产库和各工具里指向它的一起删，失败一个都不删
 * - 全部在 mkdtemp 临时 HOME；Codex 接口用文件内的替身 createFakeCodexApi
 *
 * @module tests/skills/skillSnapshot.test
 */

import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

// ---------- Codex 官方接口替身 ----------
// 照 Codex 0.155 实测到的规则判断开关（2026-09-29 临时 CODEX_HOME 实测，见 specs/skills-redesign-dev2/1-plan.md）：
// 只认 path 指向 SKILL.md（解析软链接后比对）或 name 的 [[skills.config]]，指向文件夹的记录不认；
// write 照 Codex（toml_edit）只动相关几行：关 = 追加一条解析后的 SKILL.md 路径记录，开 = 删掉指向同一 SKILL.md 的记录；
// 可注入故障：listFails / writeFails / writeIgnored / failWriteAt / failListAt / listFailsAfterWrite / notFound。
// 各测试文件各带一份（计划只声明测试文件本身，不另建共用文件）。
const fakeFs = require('node:fs')
const FAKE_TOML = require('@iarna/toml')

function fakeRealpath(filePath) {
  try {
    return fakeFs.realpathSync(filePath)
  } catch {
    return path.resolve(filePath)
  }
}

function fakeReadEntries(configPath) {
  let text = ''
  try {
    text = fakeFs.readFileSync(configPath, 'utf8')
  } catch {
    return []
  }
  const doc = FAKE_TOML.parse(text)
  return Array.isArray(doc?.skills?.config) ? doc.skills.config : []
}

function fakeListRoot(root, scope) {
  let entries = []
  try {
    entries = fakeFs.readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((entry) => !entry.name.startsWith('.'))
    .map((entry) => path.join(root, entry.name, 'SKILL.md'))
    .filter((skillMd) => fakeFs.existsSync(skillMd))
    .map((skillMd) => ({ name: path.basename(path.dirname(skillMd)), path: fakeRealpath(skillMd), scope, pluginId: null }))
}

/**
 * @param {object} options
 * @param {string} options.homeDir - 临时 HOME
 * @returns {{list: Function, write: Function, calls: Array, faults: object}}
 */
function createFakeCodexApi({ homeDir }) {
  const configPath = path.join(homeDir, '.codex', 'config.toml')
  const calls = []
  const faults = { listFails: 0, writeFails: 0, writeIgnored: 0, failWriteAt: null, failListAt: null, listFailsAfterWrite: false, notFound: false }
  let writeCount = 0
  let listCount = 0

  function isDisabled(skill, entries) {
    return entries.some((entry) => entry.enabled === false && (
      (typeof entry.name === 'string' && entry.name === skill.name)
      || (typeof entry.path === 'string' && entry.path.endsWith('SKILL.md') && fakeRealpath(entry.path) === skill.path)
    ))
  }

  return {
    calls,
    faults,
    async list() {
      calls.push({ method: 'skills/list' })
      listCount += 1
      if (faults.notFound) throw Object.assign(new Error('CODEX_NOT_FOUND'), { code: 'CODEX_NOT_FOUND' })
      if (faults.failListAt === listCount) throw Object.assign(new Error('CODEX_API_FAILED'), { code: 'CODEX_API_FAILED' })
      if (faults.listFailsAfterWrite && writeCount > 0) throw Object.assign(new Error('CODEX_API_FAILED'), { code: 'CODEX_API_FAILED' })
      if (faults.listFails > 0) {
        faults.listFails -= 1
        throw Object.assign(new Error('CODEX_API_FAILED'), { code: 'CODEX_API_FAILED' })
      }
      const entries = fakeReadEntries(configPath)
      const skills = [
        ...fakeListRoot(path.join(homeDir, '.agents', 'skills'), 'user'),
        ...fakeListRoot(path.join(homeDir, '.codex', 'skills'), 'user'),
        ...fakeListRoot(path.join(homeDir, '.codex', 'skills', '.system'), 'system'),
      ]
      return skills.map((skill) => ({ ...skill, enabled: !isDisabled(skill, entries) }))
    },
    async write({ skillMdPath, enabled }) {
      calls.push({ method: 'skills/config/write', path: skillMdPath, enabled })
      writeCount += 1
      if (faults.notFound) throw Object.assign(new Error('CODEX_NOT_FOUND'), { code: 'CODEX_NOT_FOUND' })
      if (faults.failWriteAt === writeCount || faults.writeFails > 0) {
        if (faults.writeFails > 0) faults.writeFails -= 1
        throw Object.assign(new Error('CODEX_API_FAILED'), { code: 'CODEX_API_FAILED' })
      }
      if (faults.writeIgnored > 0) {
        faults.writeIgnored -= 1
        return { effectiveEnabled: enabled }
      }
      // 照 Codex（toml_edit）的做法只动相关的那几行：关 = 末尾追加一条，开 = 删掉指向同一 SKILL.md 的记录
      const target = fakeRealpath(skillMdPath)
      let text = ''
      try {
        text = fakeFs.readFileSync(configPath, 'utf8')
      } catch {}
      const blocks = text.split(/(?=^\[\[skills\.config\]\]\s*$)/m)
      const kept = blocks.map((block) => {
        if (!block.startsWith('[[skills.config]]')) return block
        // 一条记录到下一个表头为止，后面别的表原样保留
        const firstBreak = block.indexOf('\n')
        const nextHeader = firstBreak < 0 ? -1 : block.slice(firstBreak + 1).search(/^\[/m)
        const end = nextHeader < 0 ? block.length : firstBreak + 1 + nextHeader
        const entry = block.slice(0, end)
        const match = entry.match(/^path\s*=\s*"([^"]*)"/m)
        return match && fakeRealpath(match[1]) === target ? block.slice(end) : block
      })
      let next = kept.join('')
      if (!enabled) next += `${next && !next.endsWith('\n') ? '\n' : ''}\n[[skills.config]]\npath = "${target}"\nenabled = false\n`
      fakeFs.mkdirSync(path.dirname(configPath), { recursive: true })
      fakeFs.writeFileSync(configPath, next)
      return { effectiveEnabled: enabled }
    },
  }
}
// ---------- 替身结束 ----------

const service = require('../../electron/services/skillControlService')

let sandbox
let homeDir
let repoPath
let api

async function writeSkill(root, name, description = name) {
  const skillPath = path.join(root, name)
  await fs.mkdir(skillPath, { recursive: true })
  await fs.writeFile(path.join(skillPath, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`)
  return skillPath
}

async function link(target, at) {
  await fs.mkdir(path.dirname(at), { recursive: true })
  await fs.symlink(target, at, 'dir')
  return at
}

async function writeClaudeSettings(value) {
  await fs.mkdir(path.join(homeDir, '.claude'), { recursive: true })
  await fs.writeFile(path.join(homeDir, '.claude', 'settings.json'), JSON.stringify(value, null, 2))
}

const readClaudeSettings = async () => JSON.parse(await fs.readFile(path.join(homeDir, '.claude', 'settings.json'), 'utf8'))
const deps = (extra = {}) => ({ codexSkillApi: api, skipPluginDiscovery: true, ...extra })
const snapshot = (extra) => service.getSkillControlSnapshot({ repoPath, homeDir }, deps(extra))
const byName = (snap, name) => snap.skills.find((skill) => skill.name === name)

beforeEach(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'codepal-skill-snapshot-'))
  homeDir = path.join(sandbox, 'home')
  repoPath = path.join(sandbox, 'catalog')
  await fs.mkdir(homeDir, { recursive: true })
  await fs.mkdir(repoPath, { recursive: true })
  api = createFakeCodexApi({ homeDir })
})

afterEach(async () => {
  await fs.rm(sandbox, { recursive: true, force: true })
})

describe('快照：装载汇总与来源', () => {
  it('TC-001 LOAD_SUMMARY_CLAUDE 个人开着的 + claude.ai 同步的；插件目录不算；tokens = 名字 + 说明字符数 ÷ 3.5', async () => {
    await writeSkill(repoPath, 'on-one', 'a'.repeat(10))
    await writeSkill(repoPath, 'off-one', 'b'.repeat(20))
    await link(path.join(repoPath, 'on-one'), path.join(homeDir, '.claude', 'skills', 'on-one'))
    await link(path.join(repoPath, 'off-one'), path.join(homeDir, '.claude', 'skills', 'off-one'))
    await writeClaudeSettings({ skillOverrides: { 'off-one': 'off' } })
    await writeSkill(path.join(homeDir, '.claude', 'skills', 'synced', 'acct-1'), 'pptx', 'c'.repeat(30))
    // 插件目录：根下没有 SKILL.md，只有 skills/ 子目录
    await writeSkill(path.join(homeDir, '.claude', 'skills', 'dev-workflow', 'skills'), 'orchestrate', 'd'.repeat(40))

    const snap = await snapshot()
    const pptx = byName(snap, 'pptx')
    expect(pptx.origins).toContainEqual(expect.objectContaining({ toolId: 'claude-code', origin: 'synced', mutable: false }))
    expect(byName(snap, 'orchestrate')).toBeUndefined()
    const load = snap.tools['claude-code'].load
    expect(load).toMatchObject({ personal: 1, synced: 1, total: 2 })
    // on-one: 名字 6 + 说明 10；pptx: 名字 4 + 说明 30 → 50 字符 ÷ 3.5
    expect(load.tokens).toBe(Math.round(50 / 3.5))
  })

  it('TC-002 LOAD_SUMMARY_CODEX 个人开着的 + 系统自带；开关以 skills/list 为准', async () => {
    await writeSkill(repoPath, 'on-one')
    await writeSkill(repoPath, 'off-one')
    await link(path.join(repoPath, 'on-one'), path.join(homeDir, '.agents', 'skills', 'on-one'))
    await link(path.join(repoPath, 'off-one'), path.join(homeDir, '.agents', 'skills', 'off-one'))
    await writeSkill(path.join(homeDir, '.codex', 'skills', '.system'), 'imagegen')
    await api.write({ skillMdPath: path.join(homeDir, '.agents', 'skills', 'off-one', 'SKILL.md'), enabled: false })

    const snap = await snapshot()
    expect(byName(snap, 'off-one').tools.codex.enabled).toBe(false)
    expect(byName(snap, 'on-one').tools.codex.enabled).toBe(true)
    expect(snap.tools.codex.load).toMatchObject({ personal: 1, system: 1, total: 2 })
    expect(api.calls.some((call) => call.method === 'skills/list')).toBe(true)
  })

  it('TC-003 DUPLICATE_COPIES Codex 两个目录各一份且内容不同 → 标出两份并列出两个位置；内容相同不标', async () => {
    await writeSkill(repoPath, 'logo-design')
    await link(path.join(repoPath, 'logo-design'), path.join(homeDir, '.agents', 'skills', 'logo-design'))
    await writeSkill(path.join(homeDir, '.codex', 'skills'), 'logo-design', 'old copy')
    await writeSkill(repoPath, 'same')
    await link(path.join(repoPath, 'same'), path.join(homeDir, '.agents', 'skills', 'same'))
    await fs.cp(path.join(repoPath, 'same'), path.join(homeDir, '.codex', 'skills', 'same'), { recursive: true })

    const snap = await snapshot()
    const logo = byName(snap, 'logo-design')
    expect(logo.tools.codex.duplicate).toBe(true)
    const codexLocations = logo.locations.filter((location) => location.toolId === 'codex')
    expect(codexLocations.map((location) => location.path)).toEqual(['~/.agents/skills/logo-design', '~/.codex/skills/logo-design'])
    expect(byName(snap, 'same').tools.codex.duplicate).toBeFalsy()
  })

  it('TC-004 LOCATIONS 每个来源给完整路径；快捷方式指到资产库以外给实际位置；不在了标出', async () => {
    await writeSkill(repoPath, 'mine')
    await link(path.join(repoPath, 'mine'), path.join(homeDir, '.claude', 'skills', 'mine'))
    const upstream = await writeSkill(path.join(sandbox, 'knowledge', '分享'), 'baseplate-deck')
    await link(upstream, path.join(homeDir, '.claude', 'skills', 'baseplate-deck'))
    await writeSkill(repoPath, 'gone')
    await link(path.join(sandbox, 'nowhere', 'gone'), path.join(homeDir, '.claude', 'skills', 'gone'))

    const snap = await snapshot()
    const mine = byName(snap, 'mine')
    expect(mine.locations).toEqual([
      expect.objectContaining({ toolId: 'central', path: path.join(repoPath, 'mine') }),
      expect.objectContaining({ toolId: 'claude-code', path: '~/.claude/skills/mine', missing: false }),
    ])
    expect(mine.locations[1].target).toBeUndefined()
    const external = byName(snap, 'baseplate-deck')
    expect(external.locations).toContainEqual(expect.objectContaining({ toolId: 'claude-code', path: '~/.claude/skills/baseplate-deck', target: fsSync.realpathSync(upstream) }))
    // 指到家目录里的，也写成 ~
    const inHome = await writeSkill(path.join(homeDir, 'Documents', '知识库'), 'in-home')
    await link(inHome, path.join(homeDir, '.claude', 'skills', 'in-home'))
    const again = byName(await snapshot(), 'in-home')
    expect(again.locations).toContainEqual(expect.objectContaining({ toolId: 'claude-code', target: '~/Documents/知识库/in-home' }))
    const gone = byName(snap, 'gone')
    expect(gone.locations).toContainEqual(expect.objectContaining({ toolId: 'claude-code', path: '~/.claude/skills/gone', missing: true }))
  })

  it('TC-039 SYNCED_UNREADABLE claude.ai 同步目录读不出：只把同步来源标为读不出，其余照常', async () => {
    await writeSkill(repoPath, 'mine')
    await link(path.join(repoPath, 'mine'), path.join(homeDir, '.claude', 'skills', 'mine'))
    await link(path.join(repoPath, 'mine'), path.join(homeDir, '.agents', 'skills', 'mine'))
    const syncedRoot = path.join(homeDir, '.claude', 'skills', 'synced')
    await fs.mkdir(syncedRoot, { recursive: true })
    const realReaddir = fs.readdir
    const readdirFn = async (target, options) => {
      if (path.resolve(target).startsWith(syncedRoot)) throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
      return realReaddir(target, options)
    }

    const snap = await snapshot({ readdirFn })
    expect(snap.errors).toContainEqual(expect.objectContaining({ toolId: 'claude-code', origin: 'synced' }))
    expect(byName(snap, 'mine').tools['claude-code'].enabled).toBe(true)
    expect(byName(snap, 'mine').tools.codex.enabled).toBe(true)
    expect(snap.tools['claude-code'].available).toBe(true)
  })
})

describe('Claude 开关核对', () => {
  it('TC-009 NOT_EFFECTIVE_CLAUDE 写完重读核对；不一致写回原值再核对，返回 NOT_EFFECTIVE，settings 不变', async () => {
    await writeSkill(repoPath, 'mine')
    await link(path.join(repoPath, 'mine'), path.join(homeDir, '.claude', 'skills', 'mine'))
    await writeClaudeSettings({ skillOverrides: { other: 'off' }, model: 'opus' })

    await service.executeSkillCommand({ repoPath, homeDir, toolId: 'claude-code', skillName: 'mine', action: 'disable' }, deps())
    expect((await readClaudeSettings()).skillOverrides).toEqual({ other: 'off', mine: 'off' })

    const before = await fs.readFile(path.join(homeDir, '.claude', 'settings.json'), 'utf8')
    const writes = []
    // 第一次写「没生效」（什么都不写），第二次写回照常
    const setSkillOverrideFn = async (settingsPath, name, state) => {
      writes.push(state)
      if (writes.length === 1) return state
      const { setSkillOverride } = require('../../electron/services/skillAdapters/claudeSkillAdapter')
      return setSkillOverride(settingsPath, name, state)
    }
    await expect(service.executeSkillCommand({ repoPath, homeDir, toolId: 'claude-code', skillName: 'mine', action: 'enable' }, deps({ setSkillOverrideFn })))
      .rejects.toMatchObject({ code: 'NOT_EFFECTIVE' })
    expect(writes).toEqual(['enabled', 'disabled'])
    expect(JSON.parse(await fs.readFile(path.join(homeDir, '.claude', 'settings.json'), 'utf8'))).toEqual(JSON.parse(before))
  })

  it('TC-036 STATE_UNKNOWN_CLAUDE 写回也失败，或核对时 settings 读不出：STATE_UNKNOWN；之后读得出按实际，读不出标为读不出', async () => {
    await writeSkill(repoPath, 'mine')
    await link(path.join(repoPath, 'mine'), path.join(homeDir, '.claude', 'skills', 'mine'))
    await writeClaudeSettings({})

    let count = 0
    const failingRestore = async () => {
      count += 1
      if (count === 1) return 'disabled'
      throw Object.assign(new Error('WRITE_FAILED'), { code: 'WRITE_FAILED' })
    }
    await expect(service.executeSkillCommand({ repoPath, homeDir, toolId: 'claude-code', skillName: 'mine', action: 'disable' }, deps({ setSkillOverrideFn: failingRestore })))
      .rejects.toMatchObject({ code: 'STATE_UNKNOWN' })
    expect(byName(await snapshot(), 'mine').tools['claude-code'].enabled).toBe(true)

    // 写之前读得出、写之后 settings 读不出
    const claude = require('../../electron/services/skillAdapters/claudeSkillAdapter')
    let written = false
    const setSkillOverrideFn = async (...args) => { written = true; return claude.setSkillOverride(...args) }
    const readSettingsFn = async (settingsPath) => {
      if (written) throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
      return claude.readSettings(settingsPath)
    }
    await expect(service.executeSkillCommand({ repoPath, homeDir, toolId: 'claude-code', skillName: 'mine', action: 'disable' }, deps({ setSkillOverrideFn, readSettingsFn })))
      .rejects.toMatchObject({ code: 'STATE_UNKNOWN' })
    const state = byName(await snapshot({ readSettingsFn }), 'mine').tools['claude-code']
    expect(state.state).toBe('unavailable')
    expect(state.enabled).toBeNull()
  })
})

describe('删除', () => {
  async function installEverywhere(name) {
    await writeSkill(repoPath, name)
    await link(path.join(repoPath, name), path.join(homeDir, '.claude', 'skills', name))
    await link(path.join(repoPath, name), path.join(homeDir, '.agents', 'skills', name))
    await writeClaudeSettings({ skillOverrides: { [name]: 'on', other: 'off' } })
    await fs.mkdir(path.join(homeDir, '.codex'), { recursive: true })
    await fs.writeFile(path.join(homeDir, '.codex', 'config.toml'), `[[skills.config]]\npath = "${path.join(repoPath, name, 'SKILL.md')}"\nenabled = false\n`)
  }

  it('TC-010 DELETE_EVERYWHERE 资产库和两个工具里指向它的都删；配置记录保持原样', async () => {
    await installEverywhere('psd')
    const claudeBefore = await fs.readFile(path.join(homeDir, '.claude', 'settings.json'), 'utf8')
    const codexBefore = await fs.readFile(path.join(homeDir, '.codex', 'config.toml'), 'utf8')

    await service.executeSkillCommand({ repoPath, homeDir, skillName: 'psd', action: 'delete' }, deps())
    for (const target of [path.join(repoPath, 'psd'), path.join(homeDir, '.claude', 'skills', 'psd'), path.join(homeDir, '.agents', 'skills', 'psd')]) {
      expect(fsSync.existsSync(target) || fsSync.lstatSync(target, { throwIfNoEntry: false })).toBeFalsy()
    }
    expect(await fs.readFile(path.join(homeDir, '.claude', 'settings.json'), 'utf8')).toBe(claudeBefore)
    expect(await fs.readFile(path.join(homeDir, '.codex', 'config.toml'), 'utf8')).toBe(codexBefore)
  })

  it('TC-011 DELETE_ATOMIC 中途有一处删不掉：所有位置恢复原样，返回失败', async () => {
    await installEverywhere('psd')
    let renames = 0
    const renameFn = async (from, to) => {
      renames += 1
      if (renames === 2) throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
      return fs.rename(from, to)
    }
    await expect(service.executeSkillCommand({ repoPath, homeDir, skillName: 'psd', action: 'delete' }, deps({ renameFn })))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(fsSync.existsSync(path.join(repoPath, 'psd', 'SKILL.md'))).toBe(true)
    expect(fsSync.readlinkSync(path.join(homeDir, '.claude', 'skills', 'psd'))).toBe(path.join(repoPath, 'psd'))
    expect(fsSync.readlinkSync(path.join(homeDir, '.agents', 'skills', 'psd'))).toBe(path.join(repoPath, 'psd'))
    const leftovers = (await fs.readdir(repoPath)).filter((name) => name.includes('codepal-delete'))
    expect(leftovers).toEqual([])
  })
})

describe('守卫：现有行为不变', () => {
  it('TC-012 收进资产库：快捷方式的外部 Skill 复制真实内容，上游目录不删', async () => {
    const upstream = await writeSkill(path.join(sandbox, 'upstream'), 'ext')
    await link(upstream, path.join(homeDir, '.claude', 'skills', 'ext'))
    await service.executeSkillCommand({ repoPath, homeDir, toolId: 'claude-code', skillName: 'ext', action: 'adopt', source: { origin: 'user', mutable: true } }, deps())
    expect(fsSync.lstatSync(path.join(repoPath, 'ext')).isSymbolicLink()).toBe(false)
    expect(fsSync.existsSync(path.join(repoPath, 'ext', 'SKILL.md'))).toBe(true)
    expect(fsSync.existsSync(path.join(upstream, 'SKILL.md'))).toBe(true)
  })

  it('TC-013 只读来源（同步、系统、插件）的写操作一律拒绝', async () => {
    for (const origin of ['synced', 'system', 'plugin']) {
      await expect(service.executeSkillCommand({ repoPath, homeDir, toolId: 'claude-code', skillName: 'x', action: 'disable', source: { origin, mutable: false } }, deps()))
        .rejects.toMatchObject({ code: 'ORIGIN_READ_ONLY' })
    }
  })
})
