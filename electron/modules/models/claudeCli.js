/**
 * 第三方模型接入 · 找本机 Claude Code 并检查版本
 *
 * 负责：
 * - 先按当前 PATH 找 claude，找不到再问登录 shell（Finder 启动的 CodePal 拿不到用户的 PATH）
 * - 读 `claude --version`，低于 2.1.251 不启动（Nexus 实测过的最低版本，
 *   Nexus internal/app/claudelaunch/service.go:133-174）
 *
 * 测试用覆盖口 CODEPAL_CLAUDE_BIN。
 *
 * @module electron/modules/models/claudeCli
 */

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const MIN_CLAUDE_VERSION = '2.1.251'

/** 是可执行的普通文件 */
function isExecutable(file) {
  try {
    const st = fs.statSync(file)
    if (!st.isFile()) return false
    fs.accessSync(file, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * 找 claude 可执行文件
 * @param {object} [env=process.env]
 * @returns {string|null} 绝对路径，找不到返回 null
 */
function locateClaude(env = process.env) {
  if (env.CODEPAL_CLAUDE_BIN) return isExecutable(env.CODEPAL_CLAUDE_BIN) ? env.CODEPAL_CLAUDE_BIN : null
  for (const dir of String(env.PATH || '').split(path.delimiter)) {
    if (!dir) continue
    const file = path.join(dir, 'claude')
    if (isExecutable(file)) return file
  }
  try {
    const r = spawnSync('/bin/bash', ['-lc', 'command -v claude'], { encoding: 'utf8', timeout: 5000 })
    const found = r.status === 0 ? r.stdout.trim().split('\n').pop() : ''
    if (found && isExecutable(found)) return found
  } catch {}
  return null
}

/** 比较 x.y.z，a < b 返回负数 */
function compareVersions(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
  }
  return 0
}

/**
 * 检查 Claude Code 版本
 * @param {string} claudePath
 * @param {object} [env=process.env]
 * @returns {{ok: boolean, current: string|null, required: string}}
 */
function checkClaudeVersion(claudePath, env = process.env) {
  const r = spawnSync(claudePath, ['--version'], { encoding: 'utf8', timeout: 20000, env })
  const m = r.status === 0 ? String(r.stdout).match(/(\d+\.\d+\.\d+)/) : null
  if (!m) return { ok: false, current: null, required: MIN_CLAUDE_VERSION }
  return { ok: compareVersions(m[1], MIN_CLAUDE_VERSION) >= 0, current: m[1], required: MIN_CLAUDE_VERSION }
}

module.exports = { MIN_CLAUDE_VERSION, locateClaude, checkClaudeVersion, compareVersions }
