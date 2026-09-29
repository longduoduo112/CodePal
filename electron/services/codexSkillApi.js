/**
 * Codex Skill 官方接口
 *
 * 负责：
 * - 经 codex app-server 的 skills/list 读每个 Skill 在 Codex 里的真实开关（Codex 自己的判断，不是我们猜的）
 * - 经 skills/config/write 打开 / 关闭一个 Skill；写法由 Codex 自己决定
 * - 只传 SKILL.md 的绝对路径：传文件夹路径 Codex 会照写进 config.toml 但不认（旧版 CodePal 关不掉的根因）
 * - 没装 Codex 报 CODEX_NOT_FOUND，接口起不来 / 报错报 CODEX_API_FAILED，由调用方把 Codex 标成不可用
 *
 * @module electron/services/codexSkillApi
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { findCodexBinary, openAppServer } = require('./codexHookTrust')

const RPC_TIMEOUT_MS = 15000

function codedError(code, cause) {
  return Object.assign(new Error(code, cause ? { cause } : undefined), { code })
}

/**
 * 解析成 Codex 会报告的路径：Codex 比对前会解析软链接
 * @param {string} filePath - 绝对路径
 * @returns {string}
 */
function resolveForCodex(filePath) {
  try {
    return fs.realpathSync(filePath)
  } catch {
    return path.resolve(filePath)
  }
}

/**
 * app-server 的环境：让它读的就是快照里这个 homeDir 下的 Codex 配置
 * @param {string} homeDir
 * @returns {object}
 */
function codexEnv(homeDir) {
  const env = { ...process.env, HOME: homeDir }
  // 用户自己设过 CODEX_HOME 且就是本机真实家目录时尊重它；其余一律按 homeDir 推
  if (!process.env.CODEX_HOME || homeDir !== os.homedir()) env.CODEX_HOME = path.join(homeDir, '.codex')
  return env
}

/**
 * 起一个 app-server，做完 fn 就关掉；整个过程有超时
 * @param {object} options
 * @param {string} options.homeDir - 用户主目录（skills/list 的 cwd）
 * @param {(server: object) => Promise<any>} fn
 * @returns {Promise<any>}
 */
async function withAppServer({ homeDir, codexBin = findCodexBinary(), env = codexEnv(homeDir), timeoutMs = RPC_TIMEOUT_MS }, fn) {
  if (!codexBin) throw codedError('CODEX_NOT_FOUND')
  // 这个家目录下从没用过 Codex（没有 ~/.codex）：当作没找到；不替用户建目录
  const codexHome = env.CODEX_HOME || path.join(homeDir, '.codex')
  if (!fs.existsSync(codexHome)) throw codedError('CODEX_NOT_FOUND')
  let server
  let timer
  try {
    server = openAppServer(codexBin, env)
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(codedError('CODEX_API_FAILED')), timeoutMs)
    })
    return await Promise.race([timeout, (async () => {
      await server.call('initialize', { clientInfo: { name: 'codepal', title: 'CodePal', version: '1' } })
      server.notify('initialized')
      return fn(server, homeDir)
    })()])
  } catch (error) {
    if (error?.code === 'CODEX_NOT_FOUND' || error?.code === 'CODEX_API_FAILED') throw error
    throw codedError('CODEX_API_FAILED', error)
  } finally {
    clearTimeout(timer)
    server?.close()
  }
}

/**
 * 读 Codex 眼里的全部 Skill
 * @param {object} options - 见 withAppServer
 * @returns {Promise<Array<{name: string, path: string, scope: string, enabled: boolean, pluginId: string|null}>>}
 *   path 是 Codex 报告的 SKILL.md 路径（已解析软链接）
 */
async function listCodexSkills(options) {
  return withAppServer(options, async (server, homeDir) => {
    const result = await server.call('skills/list', { cwds: [homeDir], forceReload: true })
    const byPath = new Map()
    for (const entry of result?.data || []) {
      for (const skill of entry?.skills || []) {
        if (typeof skill?.path !== 'string') continue
        byPath.set(skill.path, {
          name: skill.name,
          path: skill.path,
          scope: skill.scope,
          enabled: skill.enabled !== false,
          pluginId: skill.pluginId || null,
        })
      }
    }
    return [...byPath.values()]
  })
}

/**
 * 打开或关闭一个 Skill
 * @param {object} params
 * @param {string} params.skillMdPath - SKILL.md 的绝对路径（不接受文件夹路径）
 * @param {boolean} params.enabled
 * @param {object} options - 见 withAppServer
 * @returns {Promise<{effectiveEnabled: boolean}>}
 */
async function writeCodexSkillEnabled({ skillMdPath, enabled }, options) {
  if (typeof skillMdPath !== 'string' || !path.isAbsolute(skillMdPath) || path.basename(skillMdPath) !== 'SKILL.md') {
    throw codedError('INVALID_SKILL_PATH')
  }
  return withAppServer(options, async (server) => {
    const result = await server.call('skills/config/write', { path: skillMdPath, enabled: Boolean(enabled) })
    return { effectiveEnabled: result?.effectiveEnabled !== false }
  })
}

/**
 * 默认的官方接口实现；测试注入 deps.codexSkillApi 替换
 * @param {object} deps
 * @returns {{list: Function, write: Function}}
 */
function getCodexSkillApi(deps = {}) {
  if (deps.codexSkillApi) return deps.codexSkillApi
  return {
    list: ({ homeDir }) => listCodexSkills({ homeDir }),
    write: ({ homeDir, skillMdPath, enabled }) => writeCodexSkillEnabled({ skillMdPath, enabled }, { homeDir }),
  }
}

module.exports = { resolveForCodex, listCodexSkills, writeCodexSkillEnabled, getCodexSkillApi }
