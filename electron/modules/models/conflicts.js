/**
 * 第三方模型接入 · Claude settings 冲突检查（只在交互模式启动前做）
 *
 * 负责：
 * - 扫用户配置目录的 settings.json，以及当前目录到 git 根（没有 git 就到家目录为止）的
 *   .claude/settings.json、.claude/settings.local.json
 * - 找出会让请求绕过注入、或改变认证的字段；只返回字段路径（env. 前缀是 CodePal 自定格式），绝不返回值
 * - 被注入覆盖的 ANTHROPIC_* 不算冲突
 *
 * 规则来源：Nexus internal/app/claudelaunch/service.go:429-484,513-586。
 *
 * @module electron/modules/models/conflicts
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const CONFLICT_ENV = new Set(['ANTHROPIC_CUSTOM_HEADERS', 'HTTP_USER_AGENT', 'MAX_THINKING_TOKENS', 'CLAUDE_CODE_DISABLE_THINKING', 'CLAUDE_CODE_DISABLE_1M_CONTEXT'])
// 启动时会被注入值覆盖的变量，写在 settings 里也不影响
const OVERRIDDEN_ENV = new Set([
  'ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
])
const CONFLICT_TOP = ['apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport']

/** 读 JSON，读不到或坏了返回 null（冲突检查不因别人的坏文件拦住启动） */
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

/** 从 cwd 往上到 git 根（含）或家目录（不含）的项目 settings 文件 */
function projectSettingsFiles(cwd) {
  const files = []
  const home = os.homedir()
  let dir = path.resolve(cwd)
  for (;;) {
    if (dir === home) break
    files.push(path.join(dir, '.claude', 'settings.json'), path.join(dir, '.claude', 'settings.local.json'))
    if (fs.existsSync(path.join(dir, '.git'))) break
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return files
}

/**
 * 找冲突字段
 * @param {{cwd: string, configDir: string}} p
 * @returns {string[]} 去重后的字段路径，如 ['env.HTTP_USER_AGENT', 'apiKeyHelper']
 */
function findSettingsConflicts({ cwd, configDir }) {
  const found = []
  const add = (k) => { if (!found.includes(k)) found.push(k) }
  for (const file of [path.join(configDir, 'settings.json'), ...projectSettingsFiles(cwd)]) {
    const s = readJson(file)
    if (!s || typeof s !== 'object') continue
    const env = s.env && typeof s.env === 'object' ? s.env : {}
    for (const k of Object.keys(env)) {
      if (CONFLICT_ENV.has(k) || (k.startsWith('ANTHROPIC_') && !OVERRIDDEN_ENV.has(k))) add(`env.${k}`)
    }
    for (const k of CONFLICT_TOP) if (k in s) add(k)
  }
  return found
}

module.exports = { findSettingsConflicts }
