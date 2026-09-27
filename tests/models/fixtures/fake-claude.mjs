#!/usr/bin/env node
/**
 * 替身 claude（测试用）
 *
 * 负责：
 * - `--version` / `--help` 恒回固定文本、不写报告（FAKE_CLAUDE_MODE=oldversion 时版本为 2.1.200）
 * - 其余调用先把报告写到 $FAKE_CLAUDE_REPORT（argv、环境变量名、白名单变量的值、Key 的 sha256、标准输入、pid），再按 $FAKE_CLAUDE_MODE 行动
 * - Key 原文永不写进报告
 *
 * @module tests/models/fixtures/fake-claude
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const argv = process.argv.slice(2)
const mode = process.env.FAKE_CLAUDE_MODE || 'success'
const report = process.env.FAKE_CLAUDE_REPORT

// 只 TC-F06 用：每次被调用都记一行参数
if (process.env.FAKE_CLAUDE_LOG_ALL === '1' && report) {
  fs.appendFileSync(path.join(path.dirname(report), 'doctor-calls.log'), JSON.stringify(argv) + '\n')
}

if (argv.includes('--version')) {
  process.stdout.write(mode === 'oldversion' ? '2.1.200 (Claude Code)\n' : '2.1.283 (Claude Code)\n')
  process.exit(0)
}
if (argv.includes('--help')) {
  process.stdout.write('Usage: claude [options]\n  --print\n  --output-format <format>\n  --safe-mode\n  --json-schema <schema>\n')
  process.exit(0)
}

const WHITELIST = [
  'ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_FABLE_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL',
  'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST', 'CLAUDE_CODE_SUBPROCESS_ENV_SCRUB', 'CLAUDE_CONFIG_DIR', 'HOME', 'DISABLE_TELEMETRY',
  'CLAUDE_CODE_MAX_RETRIES',
]

/** 读完标准输入（没有管道时返回空串） */
function readStdin() {
  if (process.stdin.isTTY) return ''
  try { return fs.readFileSync(0, 'utf8') } catch { return '' }
}

const stdin = readStdin()
if (report) {
  const env = {}
  for (const k of WHITELIST) if (k in process.env) env[k] = process.env[k]
  const token = process.env.ANTHROPIC_AUTH_TOKEN
  fs.writeFileSync(report, JSON.stringify({
    argv,
    envNames: Object.keys(process.env).sort(),
    env,
    tokenSha256: token ? crypto.createHash('sha256').update(token).digest('hex') : null,
    stdin,
    pid: process.pid,
  }))
}

const base = { type: 'result', subtype: 'success', is_error: false, result: 'CODEPAL_OK', session_id: 's1', num_turns: 1, modelUsage: { 'deepseek-flash': {} } }
// api401 / api400 是 2026-09-27 对 DeepSeek 真实调用拿到的原文（TC-H06，请求 id 已去掉）；api402 仍按 Nexus 经验
const OUT = {
  success: [base, 0],
  api401: [{ ...base, is_error: true, result: 'Failed to authenticate. API Error: 401 Authentication Fails, Your api key: ****tion is invalid' }, 1],
  api400: [{ ...base, is_error: true, result: 'API Error: 400 The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed deepseek-not-exist-codepal.' }, 1],
  api402: [{ ...base, is_error: true, result: 'API Error: 402 {"error":{"message":"Insufficient Balance"}}' }, 1],
}

if (OUT[mode]) {
  process.stdout.write(JSON.stringify(OUT[mode][0]))
  process.exit(OUT[mode][1])
}
if (mode === 'conn') {
  process.stderr.write('Connection error.\n')
  process.exit(1)
}
if (mode === 'exit3') process.exit(3)
if (mode === 'hang') {
  setTimeout(() => process.exit(0), 120000)
}
