/**
 * #51 启动静默维护不再重写内容没变的 settings.json
 *
 * - TC-001：托管状态栏已是最新写法，连续静默维护不写文件、不新增备份
 * - TC-002：旧命令写法照常迁移，只留一份内容与改前一致的备份
 * - TC-003：迁移写入时其他配置原样保留
 * - TC-004：用户自定义状态栏不被覆盖、不备份
 * - TC-005：settings.json 不存在时不创建、不备份
 * - 用临时 HOME 跑真实的 settings 写入服务，绝不碰真实 ~/.claude
 *
 * @module tests/statusLine/settingsNoRewrite.test
 */

import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

const require = createRequire(import.meta.url)

const ORIGINAL_ENV = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, PATH: process.env.PATH }

async function pathExists(checkPath) {
  try {
    await fs.access(checkPath)
    return true
  } catch {
    return false
  }
}

// 服务在加载时按 HOME 算出 ~/.claude 路径，所以每个用例换 HOME 后重新加载模块
function loadServicesWithHome(tempHome) {
  process.env.HOME = tempHome
  process.env.USERPROFILE = tempHome
  process.env.PATH = '/nonexistent'
  for (const modulePath of [
    require.resolve('../../electron/services/claudeUsageStatusService'),
    require.resolve('../../electron/services/claudeSettingsService'),
  ]) {
    delete require.cache[modulePath]
  }
  const usageModule = require('../../electron/services/claudeUsageStatusService')
  const settingsModule = require('../../electron/services/claudeSettingsService')
  const claudeSettingsService = settingsModule.createClaudeSettingsService({ pathExists })
  const service = usageModule.createClaudeUsageStatusService({ pathExists, claudeSettingsService })
  return { usageModule, service }
}

async function listStatusBackups(claudeDir) {
  try {
    const names = await fs.readdir(path.join(claudeDir, 'backups'))
    return names.filter((name) => name.includes('codepal-usage-status')).sort()
  } catch {
    return []
  }
}

describe('#51 settings.json 静默维护', () => {
  let tempHome
  let claudeDir
  let settingsPath

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codepal-51-'))
    claudeDir = path.join(tempHome, '.claude')
    settingsPath = path.join(claudeDir, 'settings.json')
    await fs.mkdir(claudeDir, { recursive: true })
  })

  afterEach(async () => {
    process.env.HOME = ORIGINAL_ENV.HOME
    process.env.USERPROFILE = ORIGINAL_ENV.USERPROFILE
    process.env.PATH = ORIGINAL_ENV.PATH
    await fs.rm(tempHome, { recursive: true, force: true })
  })

  async function writeSettings(data) {
    const raw = `${JSON.stringify(data, null, 2)}\n`
    await fs.writeFile(settingsPath, raw, 'utf8')
    return raw
  }

  const otherFields = {
    env: { ANTHROPIC_BASE_URL: 'https://api.example.invalid' },
    permissions: { allow: ['Bash(npm run test:*)'] },
    model: 'opus',
  }

  it('TC-001 托管状态栏已是最新写法，连续静默维护 3 次不写文件、不新增备份', async () => {
    const { usageModule, service } = loadServicesWithHome(tempHome)
    const raw = await writeSettings({
      ...otherFields,
      statusLine: { type: 'command', command: usageModule.MANAGED_STATUS_COMMAND },
    })
    const before = await fs.stat(settingsPath)

    for (let round = 0; round < 3; round += 1) {
      const result = await service.ensureUsageStatusInstalled({ intent: 'silent' })
      expect(result.success, JSON.stringify(result)).not.toBe(false)
    }

    const backups = await listStatusBackups(claudeDir)
    expect(backups.length, 'UNCHANGED_REWRITE：内容没变却新增了备份').toBe(0)
    expect(await fs.readFile(settingsPath, 'utf8'), 'UNCHANGED_REWRITE：内容没变却重写了文件').toBe(raw)
    const after = await fs.stat(settingsPath)
    expect(after.mtimeMs, 'UNCHANGED_REWRITE：内容没变却更新了修改时间').toBe(before.mtimeMs)
  })

  it('TC-002 旧命令写法照常迁移，只新增 1 份与改前逐字节一致的备份', async () => {
    const { usageModule, service } = loadServicesWithHome(tempHome)
    const raw = await writeSettings({
      ...otherFields,
      statusLine: { type: 'command', command: usageModule.LEGACY_MANAGED_STATUS_COMMAND },
    })

    await service.ensureUsageStatusInstalled({ intent: 'silent' })

    const written = JSON.parse(await fs.readFile(settingsPath, 'utf8'))
    expect(written.statusLine).toEqual({ type: 'command', command: usageModule.MANAGED_STATUS_COMMAND })
    const backups = await listStatusBackups(claudeDir)
    expect(backups.length).toBe(1)
    expect(await fs.readFile(path.join(claudeDir, 'backups', backups[0]), 'utf8')).toBe(raw)
  })

  it('TC-003 迁移写入时 statusLine 以外的字段逐字段保持原值', async () => {
    const { usageModule, service } = loadServicesWithHome(tempHome)
    await writeSettings({
      ...otherFields,
      statusLine: { type: 'command', command: usageModule.LEGACY_MANAGED_STATUS_COMMAND },
    })

    await service.ensureUsageStatusInstalled({ intent: 'silent' })

    const written = JSON.parse(await fs.readFile(settingsPath, 'utf8'))
    const { statusLine, ...rest } = written
    expect(statusLine.command).toBe(usageModule.MANAGED_STATUS_COMMAND)
    expect(rest).toEqual(otherFields)
  })

  it('TC-004 用户自定义状态栏：返回冲突，settings.json 字节不变，不新增备份', async () => {
    const { service } = loadServicesWithHome(tempHome)
    const raw = await writeSettings({
      ...otherFields,
      statusLine: { type: 'command', command: 'bash ~/my-own-statusline.sh' },
    })

    const result = await service.ensureUsageStatusInstalled({ intent: 'silent' })

    expect(result.hasCustomStatusLine, JSON.stringify(result)).toBe(true)
    expect(await fs.readFile(settingsPath, 'utf8')).toBe(raw)
    expect(await listStatusBackups(claudeDir)).toEqual([])
  })

  it('TC-005 settings.json 不存在：不创建、不新增备份、返回未接入', async () => {
    const { service } = loadServicesWithHome(tempHome)

    const result = await service.ensureUsageStatusInstalled({ intent: 'silent' })

    expect(await pathExists(settingsPath)).toBe(false)
    expect(await listStatusBackups(claudeDir)).toEqual([])
    expect(result.integrationState, JSON.stringify(result)).not.toBe('ready')
  })
})
