/**
 * 会话任务摘要输入回归（#52）。
 * - 在临时 HOME 真跑钩子，验证系统注入不覆盖任务、粘贴包装先清理。
 * - 验证回顾详情/搜索和模板安装路径，不读取真实用户配置。
 * @module tests/sessionPromptFilter
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { L, makeProjectsDir, stamp } from './sessions/fixtures.js'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const templateDir = path.join(root, 'templates/k28-status-light')
const script = path.join(templateDir, 'k28_status.sh')
const service = require('../electron/services/sessionBrowserService')
const systemMessages = [
  '<task-notification> <task-id>b123</task-id> 后台审核已完成</task-notification>',
  '<local-command-stdout>命令输出</local-command-stdout>',
  '<command-name>/clear</command-name>',
  '<command-message>clear</command-message>',
  '<command-args>参数</command-args>',
  '<system-reminder>内部提醒</system-reminder>',
  'Base directory for this skill: /tmp/skill',
]
let home
let hookDir
let projects

/** @param {string} state 钩子状态 @param {object} payload 钩子输入 @param {string} target 实际脚本 @returns {void} */
function run(state, payload = {}, target = script) {
  execFileSync('bash', [target, state], {
    input: JSON.stringify({ session_id: 'sess-1', cwd: '/tmp/work/demo', ...payload }),
    env: { PATH: process.env.PATH, HOME: home },
  })
}
const read = (ext) => {
  const file = path.join(hookDir, 'states', `sess_1.${ext}`)
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'codepal-prompt-filter-'))
  hookDir = path.join(home, '.claude/k28-status-light')
  fs.mkdirSync(hookDir, { recursive: true })
  fs.writeFileSync(path.join(hookDir, 'tts.conf'), 'STATUS_LIGHT_ENABLED=1\n')
  projects = makeProjectsDir()
})
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true })
  projects.cleanup()
})

describe('#52 会话摘要过滤', () => {
  it('TC-001 系统消息保留上句，无旧摘要不创造任务', () => {
    run('busy', { prompt: '就这个 A' })
    const original = read('task')
    for (const prompt of systemMessages) {
      run('done')
      run('busy', { prompt: ` \n\t${prompt}` })
      expect(read('task'), 'SYSTEM_PROMPT_OVERWRITE').toBe(original)
      expect(read('txt').split('\t')[0]).toBe('busy')
    }
    run('clear')
    run('busy', { prompt: systemMessages[0] })
    expect(read('task'), 'SYSTEM_PROMPT_OVERWRITE').toBeNull()
  })

  it('TC-002 粘贴包装去除后截30字，保留其他标签和前后文字', () => {
    const cases = [
      ['<pasted_content id="example"><task-notification>样例</task-notification></pasted_content>', '<task-notification>样例</task-notification>'],
      ['<pasted_content id="unicode">' + '字'.repeat(29) + '😊尾</pasted_content>', '字'.repeat(29) + '😊尾'],
      ['<pasted_content id="b588">\nIssue 池盘点结果：\n' + '中文'.repeat(30) + '\n</pasted_content>', 'Issue 池盘点结果： ' + '中文'.repeat(30)],
      ['看看：<pasted_content id="1">内容</pasted_content> 然后解释', '看看：内容 然后解释'],
      ['<pasted_content\nid="2">甲</pasted_content><pasted_content id="3">乙</pasted_content>', '甲乙'],
      ['<pasted_content id="4"><div>内容</div></pasted_content>', '<div>内容</div>'],
      ['<pasted_content_extra>保留</pasted_content_extra>', '<pasted_content_extra>保留</pasted_content_extra>'],
    ]
    for (const [prompt, clean] of cases) {
      run('busy', { prompt })
      expect(read('task'), 'PASTE_WRAPPER_PREVIEW').toBe(Array.from(clean).slice(0, 30).join(''))
    }
    run('busy', { prompt: '保留真实输入' })
    run('busy', { prompt: '<pasted_content id="empty"> \n </pasted_content>' })
    expect(read('task'), 'PASTE_WRAPPER_PREVIEW').toBe('保留真实输入')
  })

  it('TC-003 回顾详情、标题和全文搜索忽略通知而保留真实消息', async () => {
    const notification = systemMessages[0]
    expect(service.toMessage(L.user(notification)), 'REVIEW_SYSTEM_NOTIFICATION').toBeNull()
    expect(service.toMessage(L.userBlocks([{ type: 'text', text: `\n${notification}` }])), 'REVIEW_SYSTEM_NOTIFICATION').toBeNull()
    const genuine = '请解释 <task-notification> 这个标签'
    expect(service.toMessage(L.user(genuine))).toMatchObject({ kind: 'ask', text: genuine })
    projects.write('-demo', 's1', stamp([L.user(notification), L.user('就这个 A'), L.user(notification), L.answer('好的')], { cwd: '/tmp/demo' }))
    const options = { projectsDir: projects.dir }
    const page = await service.readSessionPage('-demo', 's1', options)
    expect(page.messages.filter((m) => m.kind === 'ask').map((m) => m.text), 'REVIEW_SYSTEM_NOTIFICATION').toEqual(['就这个 A'])
    expect((await service.listRecent(options)).sessions[0].title, 'REVIEW_SYSTEM_NOTIFICATION').toBe('就这个 A')
    expect(await service.searchSessions('后台审核已完成', options), 'REVIEW_SYSTEM_NOTIFICATION').toEqual([])
    expect(await service.searchSessions('就这个 A', options)).toHaveLength(1)
  })

  it('TC-004 安装更新旧模板、清单同装、真实执行且保留用户配置', () => {
    fs.writeFileSync(path.join(home, '.claude/settings.json'), '{"model":"opus"}')
    fs.writeFileSync(path.join(hookDir, 'k28_status.sh'), '#!/bin/bash\nexit 0\n')
    const conf = '# [CodePal 会话状态] 已有托管说明\nSTATUS_LIGHT_ENABLED=1\nUSER_SETTING=keep\n'
    fs.writeFileSync(path.join(hookDir, 'tts.conf'), conf)
    const env = { ...process.env, HOME: home, CODEPAL_MODELS_HOME: path.join(home, 'models') }
    delete env.CLAUDE_CONFIG_DIR
    delete env.CODEX_HOME
    execFileSync(process.execPath, ['-e', `
      const service = require('./electron/services/sessionStatusService')
      service.installSessionStatus({ trustHooks: async () => ({ trusted: 0, alreadyTrusted: 0 }) })
        .then(result => { if (!result.success) throw new Error(JSON.stringify(result)); })
        .catch(error => { console.error(error); process.exitCode = 1; })
    `], { cwd: root, env })
    expect(fs.readFileSync(path.join(hookDir, 'k28_status.sh'), 'utf8')).toBe(fs.readFileSync(script, 'utf8'))
    const rules = path.join(hookDir, 'system-message-prefixes.json')
    expect(fs.existsSync(rules), 'INSTALLED_FILTER_RULES').toBe(true)
    expect(fs.readFileSync(rules, 'utf8')).toBe(fs.readFileSync(path.join(templateDir, 'system-message-prefixes.json'), 'utf8'))
    expect(fs.readFileSync(path.join(hookDir, 'tts.conf'), 'utf8')).toBe(conf)
    run('busy', { prompt: '安装后仍保留这一句' }, path.join(hookDir, 'k28_status.sh'))
    run('busy', { prompt: systemMessages[0] }, path.join(hookDir, 'k28_status.sh'))
    expect(read('task'), 'INSTALLED_FILTER_RULES').toBe('安装后仍保留这一句')
  })

  it('TC-005 普通提问、斜杠命令、Codex带文件和原有过滤保持', () => {
    for (const prompt of ['普通中文提问 '.repeat(9), '/help', '解释 <system-reminder> 标签']) {
      run('busy', { prompt })
      expect(read('task')).toBe(prompt.trim().slice(0, 30))
    }
    run('busy', { prompt: '# Files mentioned by the user:\n## file.txt: /tmp/file.txt\n## My request for Codex:\n检查这个文件' })
    expect(read('task')).toBe('检查这个文件')
    run('attention', { tool_input: { questions: [{ question: '删吗？' }] } })
    expect(read('ask')).toBe('删吗？')
    run('busy')
    expect(read('task')).toBe('检查这个文件')
    expect(read('ask')).toBeNull()
    expect(service.toMessage(L.user('/help'))).toMatchObject({ kind: 'ask', text: '/help' })
    for (const prompt of systemMessages.slice(1)) expect(service.toMessage(L.user(prompt))).toBeNull()
    const pasted = '<pasted_content id="guard">原有粘贴展示</pasted_content>'
    expect(service.toMessage(L.user(pasted))).toMatchObject({ kind: 'ask', text: pasted })
  })

  it('TC-006 产品与lock根版本同步，不改依赖版本', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
    expect(pkg.version.localeCompare('2.1.4', undefined, { numeric: true }), 'TASK_PRODUCT_VERSION').toBeGreaterThanOrEqual(0)
    expect(lock.version, 'TASK_PRODUCT_VERSION').toBe(pkg.version)
    expect(lock.packages[''].version, 'TASK_PRODUCT_VERSION').toBe(pkg.version)
    expect(fs.readFileSync(path.join(root, 'README.md'), 'utf8')).toContain(`version-v${pkg.version}-blue`)
    const original = JSON.parse(execFileSync('git', ['show', 'HEAD:package-lock.json'], { cwd: root, encoding: 'utf8' }))
    const dependencies = (data) => Object.fromEntries(Object.entries(data.packages).filter(([key]) => key !== ''))
    expect(dependencies(lock)).toEqual(dependencies(original))
  })
})
