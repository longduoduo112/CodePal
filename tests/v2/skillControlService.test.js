/**
 * v2.0 Skill 控制中心服务测试
 *
 * 所有写入只发生在 mkdtemp 创建的临时 HOME。
 *
 * @module tests/v2/skillControlService
 */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

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


let buildSkillManifest
let getSkillControlSnapshot
let executeSkillCommand
let discoverCodexSkills
let applyCodexCommand
let discoverClaudeSkills
let applyClaudeCommand

beforeAll(async () => {
  try {
    const servicePath = '../../electron/services/skillControlService.js'
    const codexPath = '../../electron/services/skillAdapters/codexSkillAdapter.js'
    const claudePath = '../../electron/services/skillAdapters/claudeSkillAdapter.js'
    const service = await import(/* @vite-ignore */ servicePath)
    const codex = await import(/* @vite-ignore */ codexPath)
    const claude = await import(/* @vite-ignore */ claudePath)
    ;({ buildSkillManifest, getSkillControlSnapshot, executeSkillCommand } = service.default || service)
    ;({ discoverCodexSkills, applyCodexCommand } = codex.default || codex)
    ;({ discoverClaudeSkills, applyClaudeCommand } = claude.default || claude)
  } catch (error) {
    throw new Error(`not implemented: ${error.message}`)
  }
})

// Trace targets: SC-001 dual provider snapshot; SC-005 partial source isolation;
// SC-006 protected origins and project allowlist; SC-008 codex and claude atomic mutations.
// TC-046（specs/skills-redesign-dev2）：Codex 开关改走官方接口，Codex 相关断言注入文件内的 Codex 接口替身（按 Codex 实测规则判断开关）。

async function writeSkill(root, name, body = name) {
  const skillPath = path.join(root, name)
  await fs.mkdir(skillPath, { recursive: true })
  await fs.writeFile(path.join(skillPath, 'SKILL.md'), `---
name: ${name}
description: ${body}
---
# ${body}
`)
  return skillPath
}

describe('v2.0 Skill control service', () => {
  let sandbox
  let homeDir
  let repoPath

  beforeEach(async () => {
    sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'codepal-v2-'))
    homeDir = path.join(sandbox, 'home')
    repoPath = path.join(sandbox, 'catalog')
    await fs.mkdir(homeDir, { recursive: true })
    await fs.mkdir(repoPath, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(sandbox, { recursive: true, force: true })
  })

  it('SC-001 builds stable whole-directory manifests', async () => {
    const skillPath = await writeSkill(repoPath, 'shared-skill', 'first')
    await fs.mkdir(path.join(skillPath, 'references'))
    await fs.writeFile(path.join(skillPath, 'references', 'guide.md'), 'guide')

    const first = await buildSkillManifest(skillPath)
    const second = await buildSkillManifest(skillPath)
    expect(second).toEqual(first)

    await fs.writeFile(path.join(skillPath, 'references', 'guide.md'), 'changed')
    const changed = await buildSkillManifest(skillPath)
    expect(changed.hash).not.toBe(first.hash)
  })

  it('TC-046 V2_CODEX_OFFICIAL SC-001 discovers Codex official, compatibility, config and protected origins', async () => {
    await writeSkill(path.join(homeDir, '.agents', 'skills'), 'official')
    await writeSkill(path.join(homeDir, '.codex', 'skills'), 'compat')
    await writeSkill(path.join(homeDir, '.codex', 'skills', '.system'), 'bundled')
    await fs.mkdir(path.join(homeDir, '.codex'), { recursive: true })
    // Codex 只认指向 SKILL.md 的记录
    await fs.writeFile(path.join(homeDir, '.codex', 'config.toml'), `[[skills.config]]
path = "${path.join(homeDir, '.agents', 'skills', 'official', 'SKILL.md')}"
enabled = false
`)

    const discovered = await discoverCodexSkills({ homeDir }, { skipPluginDiscovery: true, codexSkillApi: createFakeCodexApi({ homeDir }) })
    expect(discovered.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'official', origin: 'user', mutable: true, configEnabled: false }),
      expect.objectContaining({ name: 'compat', origin: 'legacy', mutable: true }),
      expect.objectContaining({ name: 'bundled', origin: 'system', mutable: false }),
    ]))
  })

  it('SC-001 discovers Claude user, project, commands and override states from an allowlist only', async () => {
    await writeSkill(path.join(homeDir, '.claude', 'skills'), 'user-skill')
    await writeSkill(path.join(homeDir, '.claude', 'commands'), 'legacy-command')
    const allowedProject = path.join(sandbox, 'allowed-project')
    const ignoredProject = path.join(sandbox, 'ignored-project')
    await writeSkill(path.join(allowedProject, '.claude', 'skills'), 'project-skill')
    await writeSkill(path.join(ignoredProject, '.claude', 'skills'), 'ignored-skill')
    await fs.mkdir(path.join(homeDir, '.claude'), { recursive: true })
    await fs.writeFile(path.join(homeDir, '.claude', 'settings.json'), JSON.stringify({
      skillOverrides: { 'user-skill': false },
      unknownSetting: { keep: true },
    }))

    const discovered = await discoverClaudeSkills({ homeDir, projectRoots: [allowedProject] }, { skipPluginDiscovery: true })
    expect(discovered.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'user-skill', origin: 'user', mutable: true, overrideState: 'disabled' }),
      expect.objectContaining({ name: 'project-skill', origin: 'project', mutable: false }),
      expect.objectContaining({ name: 'legacy-command', origin: 'command', mutable: false }),
    ]))
    expect(discovered.sources.some((item) => item.name === 'ignored-skill')).toBe(false)
  })

  it('SC-001 reads Claude native four-state override strings', async () => {
    const nativeStates = {
      'always-on': 'on',
      'fully-off': 'off',
      'metadata-only': 'name-only',
      'manual-only': 'user-invocable-only',
    }
    for (const name of Object.keys(nativeStates)) {
      await writeSkill(path.join(homeDir, '.claude', 'skills'), name)
    }
    await fs.mkdir(path.join(homeDir, '.claude'), { recursive: true })
    await fs.writeFile(path.join(homeDir, '.claude', 'settings.json'), JSON.stringify({
      skillOverrides: nativeStates,
    }))

    const discovered = await discoverClaudeSkills({ homeDir }, { skipPluginDiscovery: true })
    const statesByName = Object.fromEntries(discovered.sources.map((source) => [source.name, source.overrideState]))

    expect(statesByName).toEqual({
      'always-on': 'enabled',
      'fully-off': 'disabled',
      'manual-only': 'user-invocable-only',
      'metadata-only': 'name-only',
    })
  })

  it('SC-002 and SC-004 write native strings while preserving neighbor settings', async () => {
    await writeSkill(repoPath, 'override-me')
    await fs.mkdir(path.join(homeDir, '.claude'), { recursive: true })
    await fs.writeFile(path.join(homeDir, '.claude', 'settings.json'), JSON.stringify({
      skillOverrides: { other: 'name-only' },
      unknownSetting: { keep: true },
    }))

    await applyClaudeCommand({ repoPath, homeDir, skillName: 'override-me', action: 'disable' })
    let settings = JSON.parse(await fs.readFile(path.join(homeDir, '.claude', 'settings.json'), 'utf8'))
    expect(settings).toEqual({
      skillOverrides: { other: 'name-only', 'override-me': 'off' },
      unknownSetting: { keep: true },
    })

    await applyClaudeCommand({ repoPath, homeDir, skillName: 'override-me', action: 'clear-override' })
    settings = JSON.parse(await fs.readFile(path.join(homeDir, '.claude', 'settings.json'), 'utf8'))
    expect(settings.skillOverrides).toEqual({ other: 'name-only' })

    await applyClaudeCommand({ repoPath, homeDir, skillName: 'override-me', action: 'enable' })
    settings = JSON.parse(await fs.readFile(path.join(homeDir, '.claude', 'settings.json'), 'utf8'))
    expect(settings).toEqual({
      skillOverrides: { other: 'name-only', 'override-me': 'on' },
      unknownSetting: { keep: true },
    })
  })

  it('SC-002/004 并发：两个 skill override 同时写，互不丢失', async () => {
    // 顺序保留已由上一节覆盖；这里验证**并发**下两个 override 都落在最终文件里。
    // 注意：broker 的串行队列是**模块实例级**的（生产里 require 缓存保证只有一个实例）。
    // 测试里跨 import() 边界会拿到不同实例，因此这里只用 adapter 自己的写路径来验证。
    const settingsPath = path.join(homeDir, '.claude', 'settings.json')
    await writeSkill(repoPath, 'concurrent-a')
    await writeSkill(repoPath, 'concurrent-b')
    await fs.mkdir(path.join(homeDir, '.claude'), { recursive: true })
    await fs.writeFile(settingsPath, JSON.stringify({ skillOverrides: { other: 'name-only' }, model: 'keep-me' }))

    await Promise.all([
      applyClaudeCommand({ repoPath, homeDir, skillName: 'concurrent-a', action: 'disable' }),
      applyClaudeCommand({ repoPath, homeDir, skillName: 'concurrent-b', action: 'disable' }),
    ])

    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'))
    expect(settings.skillOverrides).toEqual({
      other: 'name-only',
      'concurrent-a': 'off',
      'concurrent-b': 'off',
    })
    // 邻居字段不被整体覆盖
    expect(settings.model).toBe('keep-me')
  })

  it('SC-003 reads legacy booleans and upgrades explicit writes', async () => {
    await writeSkill(path.join(homeDir, '.claude', 'skills'), 'legacy-on')
    await writeSkill(path.join(homeDir, '.claude', 'skills'), 'legacy-off')
    await fs.mkdir(path.join(homeDir, '.claude'), { recursive: true })
    await fs.writeFile(path.join(homeDir, '.claude', 'settings.json'), JSON.stringify({
      skillOverrides: { 'legacy-on': true, 'legacy-off': false },
    }))

    const discovered = await discoverClaudeSkills({ homeDir }, { skipPluginDiscovery: true })
    expect(discovered.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'legacy-on', overrideState: 'enabled' }),
      expect.objectContaining({ name: 'legacy-off', overrideState: 'disabled' }),
    ]))

    await applyClaudeCommand({ repoPath, homeDir, skillName: 'legacy-on', action: 'disable' })
    const settings = JSON.parse(await fs.readFile(path.join(homeDir, '.claude', 'settings.json'), 'utf8'))
    expect(settings.skillOverrides).toEqual({ 'legacy-on': 'off', 'legacy-off': false })
  })

  it('SC-005 keeps a partial snapshot when one provider source is unavailable', async () => {
    await writeSkill(repoPath, 'central')
    const snapshot = await getSkillControlSnapshot(
      { repoPath, homeDir, projectRoots: [] },
      {
        codexAdapter: {
          discover: async () => ({ toolId: 'codex', sources: [], errors: [{ origin: 'legacy', code: 'PERMISSION_DENIED' }] }),
        },
        claudeAdapter: {
          discover: async () => ({ toolId: 'claude-code', sources: [], errors: [] }),
        },
      }
    )

    expect(snapshot.partial).toBe(true)
    expect(snapshot.errors).toEqual([
      expect.objectContaining({ toolId: 'codex', origin: 'legacy', code: 'PERMISSION_DENIED' }),
    ])
    expect(JSON.stringify(snapshot)).not.toContain(homeDir)
  })

  it('SC-006 refuses mutations for project, synced, plugin, system and bundled origins', async () => {
    for (const origin of ['project', 'synced', 'plugin', 'system', 'bundled', 'command']) {
      await expect(executeSkillCommand({
        repoPath,
        homeDir,
        toolId: origin === 'system' ? 'codex' : 'claude-code',
        skillName: 'protected',
        action: 'remove-tool',
        source: { origin, mutable: false },
      })).rejects.toMatchObject({ code: 'ORIGIN_READ_ONLY' })
    }
  })

  it('SC-008 Codex enable writes only the official user path and remove-tool clears both personal copies', async () => {
    await writeSkill(repoPath, 'portable')
    await writeSkill(path.join(homeDir, '.codex', 'skills'), 'portable', 'old')

    await applyCodexCommand({ repoPath, homeDir, skillName: 'portable', action: 'enable' }, { codexSkillApi: createFakeCodexApi({ homeDir }) })
    await expect(fs.access(path.join(homeDir, '.agents', 'skills', 'portable', 'SKILL.md'))).resolves.toBeUndefined()

    await applyCodexCommand({ repoPath, homeDir, skillName: 'portable', action: 'remove-tool' })
    await expect(fs.access(path.join(homeDir, '.agents', 'skills', 'portable'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.access(path.join(homeDir, '.codex', 'skills', 'portable'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.access(path.join(repoPath, 'portable', 'SKILL.md'))).resolves.toBeUndefined()
  })

  it('TC-046 V2_CODEX_OFFICIAL SC-008 Codex disable targets the authoritative legacy source through the official API with its SKILL.md path', async () => {
    const legacyPath = await writeSkill(path.join(homeDir, '.codex', 'skills'), 'legacy-only')
    await fs.mkdir(path.join(homeDir, '.codex'), { recursive: true })
    const api = createFakeCodexApi({ homeDir })
    const deps = { skipPluginDiscovery: true, codexSkillApi: api }

    const before = await discoverCodexSkills({ homeDir }, deps)
    expect(before.sources).toContainEqual(expect.objectContaining({ name: 'legacy-only', origin: 'legacy', configEnabled: true }))

    await executeSkillCommand({ repoPath, homeDir, toolId: 'codex', skillName: 'legacy-only', action: 'disable' }, deps)

    const writes = api.calls.filter((call) => call.method === 'skills/config/write')
    expect(writes).toEqual([expect.objectContaining({ path: path.join(legacyPath, 'SKILL.md'), enabled: false })])
    const after = await discoverCodexSkills({ homeDir }, deps)
    expect(after.sources).toContainEqual(expect.objectContaining({ name: 'legacy-only', configEnabled: false }))
  })

  it('SC-008 Claude writes and clears one skillOverrides key without losing unknown settings', async () => {
    await writeSkill(repoPath, 'override-me')
    await fs.mkdir(path.join(homeDir, '.claude'), { recursive: true })
    await fs.writeFile(path.join(homeDir, '.claude', 'settings.json'), JSON.stringify({
      skillOverrides: { other: true },
      unknownSetting: { keep: true },
    }))

    await applyClaudeCommand({ repoPath, homeDir, skillName: 'override-me', action: 'set-override', overrideState: 'disabled' })
    let settings = JSON.parse(await fs.readFile(path.join(homeDir, '.claude', 'settings.json'), 'utf8'))
    expect(settings.skillOverrides).toEqual({ other: true, 'override-me': 'off' })
    expect(settings.unknownSetting).toEqual({ keep: true })

    await applyClaudeCommand({ repoPath, homeDir, skillName: 'override-me', action: 'clear-override' })
    settings = JSON.parse(await fs.readFile(path.join(homeDir, '.claude', 'settings.json'), 'utf8'))
    expect(settings.skillOverrides).toEqual({ other: true })
    expect(settings.unknownSetting).toEqual({ keep: true })
  })

  it('SC-009 skill override 写入走唯一 broker：产生备份且不污染真实家目录', async () => {
    // 收口前：claudeSkillAdapter 自带原子写，既不排队也不备份。
    // 收口后：写入与备份都落在调用方传入的 homeDir 下（与 settings.json 同根）。
    await fs.mkdir(path.join(homeDir, '.claude'), { recursive: true })
    await fs.writeFile(path.join(homeDir, '.claude', 'settings.json'), JSON.stringify({
      skillOverrides: { other: true },
      unknownSetting: { keep: true },
    }))

    // 污染守卫：真实家目录的备份数量在整个用例中不得增加
    const realBackupDir = path.join(os.homedir(), '.claude', 'backups')
    const countRealBackups = async () => (await fs.readdir(realBackupDir).catch(() => [])).length
    const realBefore = await countRealBackups()

    // 两次调用前各存一份**原始字节**，后面拿它跟备份逐字节对账
    const rawBeforeFirst = await fs.readFile(path.join(homeDir, '.claude', 'settings.json'))
    await applyClaudeCommand({ repoPath, homeDir, skillName: 'bk', action: 'set-override', overrideState: 'disabled' })
    const rawBeforeSecond = await fs.readFile(path.join(homeDir, '.claude', 'settings.json'))
    await applyClaudeCommand({ repoPath, homeDir, skillName: 'bk', action: 'clear-override' })

    expect(await countRealBackups()).toBe(realBefore)

    const backupDir = path.join(homeDir, '.claude', 'backups')
    const localBackups = (await fs.readdir(backupDir)).filter((f) => f.startsWith('settings-skill-override-'))
    expect(localBackups).toHaveLength(2)

    // 只数数量、或只挑字段看，都会漏掉"备份被换了内容"。两份备份必须与
    // 两次写入前的**原始字节完全相等**（缺字段/多字段/顺序变化都能被抓出）。
    const backupRaws = await Promise.all(
      localBackups.map((f) => fs.readFile(path.join(backupDir, f))),
    )
    const matches = (target) => backupRaws.some((buf) => buf.equals(target))
    expect(matches(rawBeforeFirst)).toBe(true)
    expect(matches(rawBeforeSecond)).toBe(true)

    const settings = JSON.parse(await fs.readFile(path.join(homeDir, '.claude', 'settings.json'), 'utf8'))
    expect(settings.skillOverrides).toEqual({ other: true })
    expect(settings.unknownSetting).toEqual({ keep: true })
  })

  it('TC-046 V2_CODEX_OFFICIAL SC-008 restores native enable flags after a disable → enable round trip', async () => {
    await writeSkill(repoPath, 'round-trip')
    const api = createFakeCodexApi({ homeDir })
    const codexDeps = { skipPluginDiscovery: true, codexSkillApi: api }

    await executeSkillCommand({ repoPath, homeDir, toolId: 'codex', skillName: 'round-trip', action: 'enable' }, codexDeps)
    await executeSkillCommand({ repoPath, homeDir, toolId: 'codex', skillName: 'round-trip', action: 'disable' }, codexDeps)
    await executeSkillCommand({ repoPath, homeDir, toolId: 'codex', skillName: 'round-trip', action: 'enable' }, codexDeps)
    const codex = await discoverCodexSkills({ homeDir }, codexDeps)
    expect(codex.sources).toContainEqual(expect.objectContaining({ name: 'round-trip', configEnabled: true }))
    expect(api.calls.filter((call) => call.method === 'skills/config/write').map((call) => [path.basename(call.path), call.enabled]))
      .toEqual([['SKILL.md', true], ['SKILL.md', false], ['SKILL.md', true]])

    await executeSkillCommand({ repoPath, homeDir, toolId: 'claude-code', skillName: 'round-trip', action: 'enable' }, { skipPluginDiscovery: true })
    await executeSkillCommand({ repoPath, homeDir, toolId: 'claude-code', skillName: 'round-trip', action: 'disable' }, { skipPluginDiscovery: true })
    await executeSkillCommand({ repoPath, homeDir, toolId: 'claude-code', skillName: 'round-trip', action: 'enable' }, { skipPluginDiscovery: true })
    const claude = await discoverClaudeSkills({ homeDir }, { skipPluginDiscovery: true })
    expect(claude.sources).toContainEqual(expect.objectContaining({ name: 'round-trip', overrideState: 'enabled' }))
  })

  it('SC-008 adopts a symlink by materializing content and never deletes its upstream directory', async () => {
    const upstreamRoot = path.join(sandbox, 'upstream')
    const upstreamSkill = await writeSkill(upstreamRoot, 'linked')
    const userRoot = path.join(homeDir, '.claude', 'skills')
    await fs.mkdir(userRoot, { recursive: true })
    await fs.symlink(upstreamSkill, path.join(userRoot, 'linked'), 'dir')

    const result = await executeSkillCommand({
      repoPath,
      homeDir,
      toolId: 'claude-code',
      skillName: 'linked',
      action: 'adopt',
      source: { origin: 'user', mutable: true },
    })

    expect(result.success).toBe(true)
    expect((await fs.lstat(path.join(repoPath, 'linked'))).isDirectory()).toBe(true)
    expect((await fs.lstat(path.join(repoPath, 'linked'))).isSymbolicLink()).toBe(false)
    await expect(fs.access(path.join(upstreamSkill, 'SKILL.md'))).resolves.toBeUndefined()
  })
})
