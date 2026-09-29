/**
 * Skill 管理页纯规则（照签收定稿 specs/skills-redesign/Skill管理-定稿/）
 *
 * 负责：
 * - 左栏分组与排序：在用（次数多到少）/ 外部 / 近 30 天没用（还在装载的排前）/ 只读；次数读不出时资产库两组合成「资产库」
 * - 搜索（名字 + 一句话用途，不分大小写）与命中片段切分
 * - 数字与时间写法：约 2.5k tokens、今天 / 昨天 / 周几 / 几月几日
 * - 工具状态：读不出、没找到
 *
 * @module pages/skills/skillsModel
 */

export const TOOLS = Object.freeze([
  { id: 'claude-code', label: 'Claude Code', short: 'Claude', usageKey: 'claude' },
  { id: 'codex', label: 'Codex', short: 'Codex', usageKey: 'codex' },
])

export const OVERVIEW_ID = '__overview'

const READ_ONLY_ORIGINS = new Set(['synced', 'system', 'plugin', 'project', 'bundled', 'command'])

/**
 * 这个 Skill 是只读的（claude.ai 同步来的、Codex 系统自带的）
 * @param {object} skill
 * @returns {boolean}
 */
export function isReadOnly(skill) {
  return !skill.managed && (skill.origins || []).length > 0 && skill.origins.every((origin) => origin.mutable === false || READ_ONLY_ORIGINS.has(origin.origin))
}

const READ_ONLY_KINDS = Object.freeze({
  synced: { list: 'claude.ai 同步', header: 'claude.ai 同步 · 只读', where: '在 claude.ai 的设置里关' },
  system: { list: 'Codex 系统', header: 'Codex 系统自带 · 只读', where: 'Codex 自带，关不了' },
  command: { list: '旧命令', header: 'Claude Code 旧命令 · 只读', where: '在 ~/.claude/commands 里管理' },
})

/**
 * 只读 Skill 的来历，决定列表行尾、栏头与「去哪关」三处文案（按来源分，不再默认当 Codex 系统）
 * @param {object} skill
 * @returns {{list: string, header: string, where: string}}
 */
export function readOnlyKind(skill) {
  const origins = (skill.origins || []).map((origin) => origin.origin)
  const key = ['synced', 'system', 'command'].find((item) => origins.includes(item))
  return READ_ONLY_KINDS[key] || { list: '只读', header: '只读', where: '在它所属的工具里管理' }
}

/** 外部 Skill：不在资产库、可以收进来 */
export function isExternal(skill) {
  return !skill.managed && !isReadOnly(skill)
}

/** 至少在一个工具里装载着 */
export function isLoaded(skill) {
  return Object.values(skill.tools || {}).some((state) => state?.enabled === true)
}

/** 有位置已经找不到（删了、快捷方式断了） */
export function hasMissingFolder(skill) {
  return (skill.locations || []).some((location) => location.missing)
}

/** 同一个工具里装了两份（内容不一样） */
export function hasDuplicate(skill) {
  return Object.values(skill.tools || {}).some((state) => state?.duplicate)
}

/**
 * 某个工具的读取状态
 * @param {object|null} snapshot
 * @param {string} toolId
 * @returns {'ok'|'missing'|'unreadable'}
 */
export function toolStatus(snapshot, toolId) {
  const errors = (snapshot?.errors || []).filter((error) => error.toolId === toolId)
  if (errors.some((error) => error.code === 'CODEX_NOT_FOUND')) return 'missing'
  // 个人 Skill 目录读不出（权限等）也算读不出，不能显示成一个都没装
  if (errors.some((error) => ['tool', 'config', 'settings', 'user', 'legacy'].includes(error.origin))) return 'unreadable'
  return 'ok'
}

/** claude.ai 同步目录读不出 */
export function syncedUnreadable(snapshot) {
  return (snapshot?.errors || []).some((error) => error.toolId === 'claude-code' && error.origin === 'synced')
}

/**
 * 名字和用途里是否含搜索词
 * @param {object} skill
 * @param {string} query - 已 trim
 * @returns {boolean}
 */
export function matchesQuery(skill, query) {
  if (!query) return true
  const needle = query.toLowerCase()
  return [skill.name, skill.displayName, skill.description].some((value) => String(value || '').toLowerCase().includes(needle))
}

/**
 * 把一段文字按搜索词切开，命中的片段标 hit
 * @param {string} text
 * @param {string} query
 * @returns {Array<{text: string, hit: boolean}>}
 */
export function splitHits(text, query) {
  const value = String(text || '')
  if (!query) return [{ text: value, hit: false }]
  const lower = value.toLowerCase()
  const needle = query.toLowerCase()
  const parts = []
  let index = 0
  while (index < value.length) {
    const found = lower.indexOf(needle, index)
    if (found < 0) {
      parts.push({ text: value.slice(index), hit: false })
      break
    }
    if (found > index) parts.push({ text: value.slice(index, found), hit: false })
    parts.push({ text: value.slice(found, found + needle.length), hit: true })
    index = found + needle.length
  }
  return parts
}

/**
 * 左栏分组
 * @param {object[]} skills - 快照里的 Skill
 * @param {object} options
 * @param {Map<string, object>} options.usageMap - 名字 → { total, claude, codex }
 * @param {boolean} options.usageFailed - 次数读不出（资产库两组合成一组）
 * @param {string} options.query - 搜索词
 * @returns {Array<{id: string, title: string, skills: object[]}>} 空组不返回
 */
export function buildGroups(skills, { usageMap = new Map(), usageFailed = false, query = '' } = {}) {
  const visible = skills.filter((skill) => matchesQuery(skill, query))
  const count = (skill) => usageMap.get(skill.name)?.total || 0
  const byName = (a, b) => a.name.localeCompare(b.name)
  const managed = visible.filter((skill) => skill.managed)
  const groups = []
  if (usageFailed) {
    groups.push({ id: 'library', title: '资产库', skills: [...managed].sort(byName) })
  } else {
    const used = managed.filter((skill) => count(skill) > 0).sort((a, b) => count(b) - count(a) || byName(a, b))
    // 近 30 天没用里，还在装载的最该关，排最前
    const unused = managed.filter((skill) => count(skill) === 0)
      .sort((a, b) => Number(isLoaded(b)) - Number(isLoaded(a)) || byName(a, b))
    groups.push({ id: 'used', title: '在用 · 近 30 天', skills: used })
    groups.push({ id: 'external', title: '外部', skills: visible.filter(isExternal).sort(byName) })
    groups.push({ id: 'unused', title: '近 30 天没用', skills: unused })
    groups.push({ id: 'readonly', title: '只读 · 同步来的和系统自带的', skills: visible.filter(isReadOnly) })
    return groups.filter((group) => group.skills.length > 0)
  }
  groups.push({ id: 'external', title: '外部', skills: visible.filter(isExternal).sort(byName) })
  groups.push({ id: 'readonly', title: '只读 · 同步来的和系统自带的', skills: visible.filter(isReadOnly) })
  return groups.filter((group) => group.skills.length > 0)
}

/**
 * 上下文估算的写法：约 2.5k tokens
 * @param {number} tokens
 * @returns {string}
 */
export function formatTokens(tokens) {
  if (typeof tokens !== 'number' || !Number.isFinite(tokens)) return '—'
  if (tokens < 100) return '不到 0.1k'
  return `${(Math.round(tokens / 100) / 10).toFixed(1)}k`
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const pad = (value) => String(value).padStart(2, '0')

/**
 * 调用记录的时间：今天「14:32」、昨天「昨天 14:32」、前 7 天「周六 20:42」、更早「9月20日 20:21」，跨年加年份
 * @param {string} iso
 * @param {Date} [now]
 * @returns {string}
 */
export function formatRecordTime(iso, now = new Date()) {
  const time = new Date(iso)
  if (Number.isNaN(time.getTime())) return '—'
  const hm = `${pad(time.getHours())}:${pad(time.getMinutes())}`
  const startOf = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const days = Math.round((startOf(now) - startOf(time)) / 86400000)
  if (days === 0) return hm
  if (days === 1) return `昨天 ${hm}`
  if (days > 1 && days < 7) return `${WEEKDAYS[time.getDay()]} ${hm}`
  const md = `${time.getMonth() + 1}月${time.getDate()}日 ${hm}`
  return time.getFullYear() === now.getFullYear() ? md : `${time.getFullYear()}年${md}`
}

/**
 * 调用记录的项目名：Claude 的会话目录是编码后的 cwd，取最后一段；Codex 没有项目，留空
 * @param {object} record
 * @returns {string}
 */
export function recordProject(record) {
  const relative = record?.session?.relativePath || ''
  if (record?.tool !== 'claude' || !relative.includes('/')) return ''
  const encoded = relative.split('/')[0]
  const parts = encoded.split('-').filter(Boolean)
  return parts[parts.length - 1] || ''
}

/**
 * 详情栏头的来源说明
 * @param {object} skill
 * @returns {string}
 */
export function sourceLabel(skill) {
  if (skill.managed) return '个人'
  if (isReadOnly(skill)) return readOnlyKind(skill).header
  return '外部，不在资产库'
}
