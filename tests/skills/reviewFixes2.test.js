/**
 * 代码审核（lite.G1 第 2 轮）指出的主进程问题的回归测试（specs/skills-redesign-dev2 TC-058）
 *
 * 负责：
 * - 补关失败、config.toml 已恢复成和备份一模一样：这次的备份删掉，反复失败也不在 ~/.codex 里越攒越多
 * - 全部在 mkdtemp 临时 HOME；Codex 接口用注入的假接口，不起真实 Codex
 *
 * @module tests/skills/reviewFixes2.test
 */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const codex = require('../../electron/services/skillAdapters/codexSkillAdapter')

let sandbox
let homeDir

beforeEach(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'codepal-review-fixes2-'))
  homeDir = path.join(sandbox, 'home')
  await fs.mkdir(path.join(homeDir, '.codex'), { recursive: true })
})

afterEach(async () => {
  await fs.rm(sandbox, { recursive: true, force: true })
})

describe('审核修复：补关失败不留备份', () => {
  it('TC-058 LEGACY_BACKUP_CLEANUP 补关写入失败两次：config.toml 恢复原样，~/.codex 里不留补关备份', async () => {
    const skillDir = path.join(homeDir, '.agents', 'skills', 'beta')
    await fs.mkdir(skillDir, { recursive: true })
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: beta\ndescription: beta\n---\n')
    const configPath = path.join(homeDir, '.codex', 'config.toml')
    const original = `model = "gpt"\n\n[[skills.config]]\npath = "${skillDir}"\nenabled = false\n`
    await fs.writeFile(configPath, original)
    const skillMd = await fs.realpath(path.join(skillDir, 'SKILL.md'))
    const api = {
      list: async () => [{ name: 'beta', path: skillMd, enabled: true }],
      // 写到一半失败：先把文件改坏，再报错，逼出恢复分支
      write: async () => {
        await fs.appendFile(configPath, '\n# half written\n')
        throw Object.assign(new Error('boom'), { code: 'CODEX_API_FAILED' })
      },
    }
    let times = 0
    const nowFn = () => new Date(Date.UTC(2026, 8, 30, 0, 0, times++))

    for (let round = 0; round < 2; round += 1) {
      const result = await codex.migrateLegacyCodexDisables({ homeDir }, { codexSkillApi: api, nowFn })
      expect(result.status).toBe('failed')
      expect(await fs.readFile(configPath, 'utf8')).toBe(original)
    }
    const leftovers = (await fs.readdir(path.join(homeDir, '.codex'))).filter((name) => name.includes('codepal-legacy-skill'))
    expect(leftovers).toEqual([])
  })
})
