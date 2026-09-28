/**
 * Read-only usage adapter for CodePal's isolated Claude CLI logs.
 * - Reuse Claude parsing/window caches and keep primary-root message IDs authoritative.
 * - Missing roots are empty; unreadable roots/files fail the shared day snapshot.
 * @module services/backgroundUsageService
 */
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { backgroundProjectsDir } = require('../platform/modelPaths')
const { scanClaudeLogs, findEarliestClaudeDate } = require('./usageLogScan/claude')
const { createLogScanWindowContext } = require('../logScanner')

/** @param {string} root Trusted source root. @returns {Promise<string|null>} Canonical directory, or missing. */
async function realDirectory(root) {
  try {
    const info = await fs.stat(root)
    if (!info.isDirectory()) throw Error('SOURCE_NOT_DIRECTORY')
    return await fs.realpath(root)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

/** @param {string} root Source directory. @returns {Promise<string[]>} Files; enumeration failures propagate. */
async function listStrict(root) {
  const files = []
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...await listStrict(file))
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(file)
  }
  return files
}

/** @param {object} options Trusted overrides for isolated tests. @returns {object} Shared-statistics source adapter. */
function createBackgroundUsageService({ homeDir = os.homedir(), env = process.env } = {}) {
  const root = backgroundProjectsDir({ homeDir, env })
  const primaryRoot = path.join(homeDir, '.claude', 'projects')
  async function roots() {
    const background = await realDirectory(root)
    if (!background) return { background: null, primary: null }
    const primary = await realDirectory(primaryRoot)
    return { background: background === primary ? null : background, primary }
  }
  return {
    async status() {
      return (await roots()).background ? 'present' : 'missing'
    },
    async scan(start, end, options = {}) {
      const { background, primary } = await roots()
      if (!background) return []
      const deps = {
        homeDir,
        windowContext: options.windowContext || createLogScanWindowContext(start),
        strictScan: true,
        pathExistsFn: async () => true,
      }
      const records = await scanClaudeLogs(start, end, { ...deps, claudeProjectsDir: background })
      if (!primary || !records.some(record => record.messageId)) return records
      const ordinary = await scanClaudeLogs(start, end, { ...deps, claudeProjectsDir: primary })
      const seen = new Set(ordinary.map(record => record.messageId).filter(Boolean))
      return records.filter(record => !record.messageId || !seen.has(record.messageId))
    },
    async earliest() {
      const { background } = await roots()
      if (!background) return null
      return findEarliestClaudeDate(background, { listJsonlFilesRecursiveFn: listStrict })
    },
  }
}

module.exports = { createBackgroundUsageService }
