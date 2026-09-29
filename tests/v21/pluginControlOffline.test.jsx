/**
 * Plugins 管理下线回归守护（plugin-control-offline-2）
 *
 * 本任务把「Plugins 管理 / Plugin 控制中心」从 CodePal 断线下线：
 * 接线与引用全部清掉，模块文件与旧测试暂留（插件不支持任务内删文件，
 * 照「文档查阅」先例由合并后的收尾提交物理删除）。
 *
 * 负责：
 * - TC-001 侧栏、模块白名单与图标不再有插件管理
 * - TC-002 主进程与 preload 断线
 * - TC-003 生产入口不再引用暂留模块（暂留文件仍在）
 * - TC-004 测试与文档无悬空引用、接线已加新测试
 * - TC-005 写网关测试重做且锁语义保留
 * - TC-006 Skill 链路、共享网关与导航保持现状（guard）
 * - TC-007 旧导航记忆回落（行为级）
 *
 * @module tests/v21/pluginControlOffline
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = path.resolve(__dirname, '..', '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf-8')
const SELF = path.resolve(__dirname, 'pluginControlOffline.test.jsx')
const DEAD_CODE_GUARD = path.join(root, 'tests', 'safety', 'deadCode.test.js')

/** 下线十个标记：只允许出现在暂留文件自身与 deadCode 防复活清单里 */
const PLUGIN_TOKENS = [
  'PluginControlPage',
  'usePluginControl',
  'pluginControlService',
  'registerPluginControlHandlers',
  'setCodexPluginEnabled',
  'getPluginControlSnapshot',
  'executePluginCommand',
  'plugin-control',
  'Plugins 管理',
  'Plugin 控制中心'
]

/** 暂留的模块文件（本任务只断引用，收尾提交物理删除） */
const PARKED_MODULE_FILES = [
  'src/pages/PluginControlPage.jsx',
  'src/hooks/usePluginControl.js',
  'src/styles/plugin-control.css',
  'electron/services/pluginControlService.js',
  'electron/handlers/registerPluginControlHandlers.js'
]

/** 暂留的旧测试文件（随收尾提交一起退） */
const PARKED_TEST_FILES = [
  'tests/v21/pluginControlService.test.js',
  'tests/v21/PluginControlPage.test.jsx',
  'tests/v21/pluginExplainability.test.jsx'
]

/**
 * 递归收集要扫描的源码文本文件
 * @param {string} dir - 起始目录
 * @param {Set<string>} skipNames - 跳过的子目录名
 * @param {string[]} list - 收集结果
 * @returns {string[]} 文件绝对路径列表
 */
function collectSourceFiles(dir, skipNames = new Set(), list = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || skipNames.has(entry.name)) continue
      collectSourceFiles(full, skipNames, list)
    } else if (/\.(js|jsx|json|md)$/.test(entry.name)) {
      list.push(full)
    }
  }
  return list
}

/**
 * 扫描一组文件里的下线标记
 * @param {string[]} files - 文件绝对路径
 * @returns {string[]} 形如 "相对路径: 标记1, 标记2" 的命中列表
 */
function scanTokens(files) {
  const hits = []
  for (const file of files) {
    const text = readFileSync(file, 'utf-8')
    const found = PLUGIN_TOKENS.filter((token) => text.includes(token))
    if (found.length > 0) hits.push(`${path.relative(root, file)}: ${found.join(', ')}`)
  }
  return hits
}

beforeEach(() => {
  localStorage.clear()
})

describe('Plugins 管理下线', () => {
  it('TC-001 侧栏、模块白名单与图标不再有插件管理', async () => {
    const layout = read('src/components/WorkbenchLayout.jsx')
    expect(!/id:\s*'plugins'/.test(layout), 'NO_PLUGINS_NAV 侧栏仍有 plugins 导航项').toBe(true)
    expect(layout.includes('技能中心') && layout.includes("id: 'skills'"), 'NO_PLUGINS_NAV 技能中心分组异常').toBe(true)

    const icons = read('src/components/sidebarIcons.js')
    expect(!/^\s*plugins:/m.test(icons), 'NO_PLUGINS_NAV 图标表仍有 plugins').toBe(true)

    const mod = await import('../../src/App.jsx')
    const ids = [...mod.VALID_ACTIVE_MODULES]
    expect(!ids.includes('plugins'), 'NO_PLUGINS_NAV 白名单仍含 plugins').toBe(true)
    const expected = ['skills', 'usage', 'claude-usage', 'project-init', 'permission', 'models', 'network', 'session-status', 'sessions', 'doc-browser']
    expect(
      ids.length === expected.length && expected.every((id) => ids.includes(id)),
      `NO_PLUGINS_NAV 白名单异常: ${ids.join(',')}`
    ).toBe(true)

    const app = read('src/App.jsx')
    expect(!app.includes("'plugins'"), 'NO_PLUGINS_NAV App.jsx 仍出现 plugins 字面量').toBe(true)
  })

  it('TC-002 主进程与 preload 断线', () => {
    const main = read('electron/main.js')
    expect(!main.includes('registerPluginControlHandlers'), 'MAIN_PRELOAD_CUT main.js 仍接线').toBe(true)

    const preload = read('electron/preload.js')
    const leftover = ['plugin-control:', 'getPluginControlSnapshot', 'executePluginCommand']
      .filter((token) => preload.includes(token))
    expect(leftover, `MAIN_PRELOAD_CUT preload 仍含 ${leftover.join(', ')}`).toEqual([])
  })

  it('TC-003 生产入口不再引用暂留模块', () => {
    const skip = new Set(PARKED_MODULE_FILES.map((rel) => path.resolve(root, rel)))
    const files = [
      ...collectSourceFiles(path.join(root, 'src')),
      ...collectSourceFiles(path.join(root, 'electron'))
    ].filter((file) => !skip.has(path.resolve(file)))

    const hits = scanTokens(files)
    expect(hits, `PARKED_NOT_REFERENCED 生产入口仍有引用 -> ${JSON.stringify(hits)}`).toEqual([])

    const missing = PARKED_MODULE_FILES.filter((rel) => !existsSync(path.join(root, rel)))
    expect(missing, `PARKED_NOT_REFERENCED 暂留文件缺失: ${missing.join(', ')}`).toEqual([])
  })

  it('TC-004 测试与文档无悬空引用、接线已加新测试', () => {
    const skip = new Set([
      SELF,
      DEAD_CODE_GUARD,
      ...PARKED_TEST_FILES.map((rel) => path.resolve(root, rel))
    ])
    const files = [
      ...collectSourceFiles(path.join(root, 'tests'), new Set(['report'])),
      path.join(root, 'README.md')
    ].filter((file) => !skip.has(path.resolve(file)))

    const hits = scanTokens(files)
    expect(hits, `NO_DANGLING_REFS 仍有引用 -> ${JSON.stringify(hits)}`).toEqual([])

    const pkg = JSON.parse(read('package.json'))
    expect(
      pkg.scripts['test:v21'].includes('tests/v21/pluginControlOffline.test.jsx'),
      'NO_DANGLING_REFS test:v21 未接新测试'
    ).toBe(true)
  })

  it('TC-005 写网关测试重做且锁语义保留', () => {
    const wg = read('tests/safety/writeGateway.test.js')
    const leftover = ['pluginControlService', 'setCodexPluginEnabled', 'docs@official']
      .filter((token) => wg.includes(token))
    expect(leftover, `GATEWAY_REWORK 仍含 ${leftover.join(', ')}`).toEqual([])
    expect(
      wg.includes('Promise.all') && wg.includes('applyCodexCommand') && wg.includes('installSessionStatus'),
      'GATEWAY_REWORK 跨写方并发保留断言缺失'
    ).toBe(true)
    expect(
      wg.includes('codexConfigOwner') && wg.includes('codexSkillAdapter'),
      'GATEWAY_REWORK 结构检查未覆盖既有写方'
    ).toBe(true)
  })

  it('TC-006 Skill 链路、共享网关与导航保持现状', () => {
    expect(
      read('electron/services/skillControlService.js').includes("origin !== 'plugin'"),
      'TC-006 Skill 来源过滤丢失'
    ).toBe(true)
    expect(read('electron/main.js').includes('registerSkillControlHandlers'), 'TC-006 Skill handlers 未注册').toBe(true)

    const app = read('src/App.jsx')
    expect(/VALID_ACTIVE_MODULES = new Set\(\[[^\]]*'skills'/.test(app), 'TC-006 白名单缺 skills').toBe(true)
    expect(app.includes("'k28-status-light'") && app.includes("'session-status'"), 'TC-006 旧名映射丢失').toBe(true)
    expect(
      app.includes('VALID_ACTIVE_MODULES.has(storedModule) ? storedModule : DEFAULT_ACTIVE_MODULE'),
      'TC-006 回落表达式变化'
    ).toBe(true)

    const mustExist = [
      'electron/services/codexConfigOwner.js',
      'electron/services/tomlSafeEdit.js',
      'electron/services/skillMetadataService.js',
      'electron/services/skillAdapters/codexSkillAdapter.js'
    ]
    const missing = mustExist.filter((rel) => !existsSync(path.join(root, rel)))
    expect(missing, `TC-006 共享模块缺失: ${missing.join(', ')}`).toEqual([])
    require('../../electron/services/codexConfigOwner.js')
    require('../../electron/services/tomlSafeEdit.js')
    require('../../electron/services/skillMetadataService.js')
  })

  it('TC-007 旧导航记忆回落（行为级）', async () => {
    const mod = await import('../../src/App.jsx')
    const getInitialActiveModule = mod.getInitialActiveModule
    expect(typeof getInitialActiveModule, 'NAV_FALLBACK getInitialActiveModule 未导出').toBe('function')
    expect(!mod.VALID_ACTIVE_MODULES.has('plugins'), 'NAV_FALLBACK plugins 仍在白名单').toBe(true)
    localStorage.setItem('codepal-active-module', 'plugins')
    expect(getInitialActiveModule(), 'NAV_FALLBACK 旧 plugins 未回落默认页').toBe('usage')
  })
})
