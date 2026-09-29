/**
 * Skill 次数统计口径守卫（specs/skills-redesign-dev TC-038、TC-049）
 *
 * 负责：
 * - 用临时 HOME 里的固定对话样本，钉住现有口径：Claude 看 Skill 调用、Codex 只认 `$名字`
 * - 近 30 天边界：第 29 天的算、第 31 天的不算；调用记录条数 = 汇总次数
 * - 个人 Skill 与插件 Skill 同名：带插件前缀的调用不算进个人那份
 *
 * @module tests/skills/skillUsage.test
 */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { scanSkillRunSamples, listSkillInvocationRecords } = require('../../electron/services/skillRunSampleService')

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-09-29T12:00:00.000Z')
const daysAgo = (days) => new Date(NOW.getTime() - days * DAY).toISOString()

let sandbox
let homeDir
let env
let ledgerPath

function claudeToolUse(id, skill, timestamp) {
  return {
    type: 'assistant',
    uuid: `u-${id}`,
    timestamp,
    sessionId: 'claude-session-1',
    message: { id: `m-${id}`, content: [{ type: 'tool_use', id: `t-${id}`, name: 'Skill', input: { skill } }] },
  }
}

function claudeSlash(id, command, timestamp) {
  return {
    type: 'user',
    uuid: `s-${id}`,
    timestamp,
    sessionId: 'claude-session-1',
    message: { content: `<command-name>/${command}</command-name>` },
  }
}

function codexUser(text, timestamp) {
  return { type: 'event_msg', timestamp, payload: { type: 'user_message', message: text } }
}

async function writeJsonl(filePath, records) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`)
}

const deps = () => ({ homeDir, env, nowFn: () => NOW })
const scan = (skillNames) => scanSkillRunSamples(deps(), { windowDays: 30, skillNames, ledgerPath })
const records = (skillName) => listSkillInvocationRecords(deps(), { skillName, windowDays: 30, ledgerPath })

beforeEach(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'codepal-skill-usage-'))
  homeDir = path.join(sandbox, 'home')
  env = { CLAUDE_CONFIG_DIR: path.join(homeDir, '.claude'), CODEX_HOME: path.join(homeDir, '.codex') }
  ledgerPath = path.join(sandbox, 'ledger', 'skill-runs.jsonl')
  await fs.mkdir(homeDir, { recursive: true })
})

afterEach(async () => {
  await fs.rm(sandbox, { recursive: true, force: true })
})

describe('次数统计口径（守卫）', () => {
  it('TC-038 Claude 看 Skill 调用、Codex 只认 $名字；第 29 天算、第 31 天不算；调用记录条数 = 汇总次数', async () => {
    await writeJsonl(path.join(homeDir, '.claude', 'projects', '-Users-me-skills', 'claude-session-1.jsonl'), [
      claudeToolUse('1', 'viral-title', daysAgo(1)),
      claudeToolUse('2', 'viral-title', daysAgo(29)),
      claudeToolUse('3', 'viral-title', daysAgo(31)),
    ])
    await writeJsonl(path.join(homeDir, '.codex', 'sessions', '2026', '09', '28', 'rollout-2026-09-28T08-00-00-abc.jsonl'), [
      { type: 'session_meta', timestamp: daysAgo(1), payload: { id: 'codex-session-1' } },
      codexUser('$viral-title 起几个标题', daysAgo(1)),
      codexUser('用 viral-title 起标题（没有 $，不算）', daysAgo(1)),
    ])

    const result = await scan(['viral-title'])
    const usage = result.skills.find((skill) => skill.name === 'viral-title')
    expect(usage).toMatchObject({ total: 3, claude: 2, codex: 1 })
    const listed = await records('viral-title')
    expect(listed.records).toHaveLength(usage.total)
  })

  it('TC-049 个人与插件同名：带插件前缀的调用不算进个人那份，记录也只列个人的；Codex 不带前缀的 $名字 算个人', async () => {
    await writeJsonl(path.join(homeDir, '.claude', 'projects', '-Users-me-skills', 'claude-session-1.jsonl'), [
      claudeToolUse('1', 'page-solution-design', daysAgo(2)),
      claudeToolUse('2', 'dev-workflow:page-solution-design', daysAgo(2)),
      claudeSlash('3', 'dev-workflow:page-solution-design', daysAgo(3)),
    ])
    await writeJsonl(path.join(homeDir, '.codex', 'sessions', '2026', '09', '27', 'rollout-2026-09-27T08-00-00-def.jsonl'), [
      { type: 'session_meta', timestamp: daysAgo(2), payload: { id: 'codex-session-2' } },
      codexUser('$page-solution-design 重做这页', daysAgo(2)),
      codexUser('$dev-workflow:page-solution-design 重做那页', daysAgo(2)),
    ])

    const result = await scan(['page-solution-design'])
    const usage = result.skills.find((skill) => skill.name === 'page-solution-design')
    expect(usage).toMatchObject({ total: 2, claude: 1, codex: 1 })
    const listed = await records('page-solution-design')
    expect(listed.records).toHaveLength(2)
    expect(listed.records.every((record) => record.skillName === 'page-solution-design')).toBe(true)
  })
})
