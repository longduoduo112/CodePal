// @vitest-environment node
/**
 * 文档查阅页真实渲染检查（TC-021）
 *
 * 负责：
 * - 起一个真实的 CodePal 窗口（临时 HOME + 临时用户数据，不碰你正在用的配置），前端走本测试自己起的 vite
 * - 放一个带子目录的样例文件夹，量真实渲染出来的尺寸和字号，对照签收的定稿（specs/docs-browser-redesign/文档查阅-定稿/）
 * - 按定稿状态目录的窗口号截图，存到 DOCS_SHOTS_DIR（默认系统临时目录下 codepal-docs-shots），给验收页和定稿图并排
 * - 只在 macOS 本机跑；CI 没有桌面环境，跳过
 *
 * @module tests/docs/DocBrowserPage.visual.test
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SKIP = Boolean(process.env.CI) || process.platform !== 'darwin'
const SHOTS = process.env.DOCS_SHOTS_DIR || path.join(os.tmpdir(), 'codepal-docs-shots')

// 样例文档：元数据、一级标题、引用、列表、代码块、带数字的表格、勾选清单
const SAMPLE_README = [
  '---',
  'title: 样例元数据标题',
  'summary: 这段元数据不应该出现在页面上',
  '---',
  '',
  '<!-- 这段注释不应该出现在页面上 -->',
  '# 样例一级标题',
  '',
  '> 引用块里的一句话。',
  '',
  '正文第一段，带一个 `行内代码`。',
  '',
  '## 二级标题',
  '',
  '- 列表第一项',
  '- 列表第二项',
  '',
  '```js',
  'const answer = 42 // 注释',
  'function hello() { return "world" }',
  '```',
  '',
  '| 标题 | 阅读 | 分享 | 分享率 | 打开率 | 涨粉 |',
  '|---|---|---|---|---|---|',
  '| 装上这个 Skills，让整个 GitHub 为你打工 | 3645 | 546 | 15.0% | 9.5% | 59 |',
  '| 写文章找配图太麻烦，于是我给自己捏了个配图助手 | 1957 | 267 | 13.6% | 7.1% | 44 |',
  '',
  '- [x] 已完成的一项',
  '- [ ] 还没做的一项，文字比较长会折到第二行，看折行后是不是和第一行文字对齐',
  '',
].join('\n')

/**
 * 在临时目录里建样例文件夹：根下 readme.md，子目录 指南/ 下两篇
 * @param {string} dir - 样例文件夹路径
 */
function writeSampleDocs(dir) {
  fs.mkdirSync(path.join(dir, '指南'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'readme.md'), SAMPLE_README)
  fs.writeFileSync(path.join(dir, '指南', '上手.md'), '# 上手\n\n第一步。\n')
  fs.writeFileSync(path.join(dir, '指南', '进阶.md'), '# 进阶\n\n第二步。\n')
}

describe.skipIf(SKIP)('文档查阅真实渲染', () => {
  let server
  let app
  let win
  let tmp
  let home
  let docsDir

  beforeAll(async () => {
    const { createServer } = await import('vite')
    const { _electron } = await import('playwright')
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codepal-docs-visual-'))
    home = path.join(tmp, 'home')
    docsDir = path.join(home, '样例文档')
    fs.mkdirSync(home, { recursive: true })
    writeSampleDocs(docsDir)
    fs.rmSync(SHOTS, { recursive: true, force: true })
    fs.mkdirSync(SHOTS, { recursive: true })

    server = await createServer({ root, logLevel: 'silent', server: { port: 0, strictPort: false } })
    await server.listen()
    const url = server.resolvedUrls.local[0]

    app = await _electron.launch({
      executablePath: path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
      args: ['.', `--user-data-dir=${path.join(tmp, 'userData')}`],
      cwd: root,
      env: { ...process.env, HOME: home, ELECTRON_DEV_ALLOW_MULTI: '1', VITE_DEV_SERVER_URL: url },
    })
    win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    await win.waitForTimeout(1500)
    await setSize(800, 600)
  }, 120000)

  afterAll(async () => {
    await app?.close().catch(() => {})
    await server?.close().catch(() => {})
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
  })

  /** 窗口定尺寸（刚启动时主进程上下文可能在重建，重试几次） */
  async function setSize(w, h) {
    for (let i = 0; i < 5; i++) {
      try {
        await app.evaluate(({ BrowserWindow }, s) => {
          const bw = BrowserWindow.getAllWindows()[0]
          bw.setSize(s.w, s.h)
          bw.center()
        }, { w, h })
        break
      } catch {
        await win.waitForTimeout(500)
      }
    }
    await win.waitForTimeout(300)
  }

  /** 量一个元素的实际渲染：宽高、字号、字重、背景色 */
  const measure = (sel) => win.evaluate((s) => {
    const el = document.querySelector(s)
    if (!el) return null
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return { w: r.width, h: r.height, fontSize: cs.fontSize, fontWeight: cs.fontWeight, bg: cs.backgroundColor }
  }, sel)
  const hasEmoji = () => win.evaluate(() => /\p{Extended_Pictographic}/u.test(document.body.innerText))
  const shot = (name) => win.screenshot({ path: path.join(SHOTS, `${name}.png`) })
  const openPage = async () => {
    await win.getByText('文档查阅', { exact: true }).first().click()
    await win.waitForTimeout(600)
  }
  const reload = async () => {
    await win.reload()
    await win.waitForLoadState('domcontentloaded')
    await win.waitForTimeout(800)
    await openPage()
  }

  it('TC-021 真实渲染对照签收的定稿，并按状态目录窗口号截图', async () => {
    // W7 还没有文件夹
    await openPage()
    expect(await win.locator('.np-split').count(), 'VISUAL_CHECK 没有双栏').toBe(1)
    await win.locator('.np-pane--list .state-view--empty').waitFor()
    await shot('W7')

    // 经真实 IPC 加样例文件夹（和点「添加文件夹」走同一个登记入口）
    const added = await win.evaluate((dir) => window.electronAPI.docAddFolder(dir), docsDir)
    expect(added.success, 'VISUAL_CHECK 添加样例文件夹').toBe(true)
    await reload()

    // W1 进入页面
    const title = await measure('.page-shell--native .page-shell__title')
    expect(title?.fontSize, 'VISUAL_CHECK 页名 15').toBe('15px')
    expect(Math.round((await measure('.np-pane--list')).w), 'VISUAL_CHECK 左栏 220').toBe(220)
    expect(Math.round((await measure('.np-pane--list .np-sf')).h), 'VISUAL_CHECK 搜索框高 24').toBe(24)
    const rootRow = await measure('.np-tr--root')
    expect(Math.round(rootRow.h), 'VISUAL_CHECK 根行高 28').toBe(28)
    expect(rootRow.fontSize, 'VISUAL_CHECK 根行字 13').toBe('13px')
    await shot('W1')

    // W4 悬停根行
    await win.locator('.np-tr--root').first().hover()
    await win.waitForTimeout(200)
    await shot('W4')

    // W2 展开并打开 readme.md
    await win.locator('.np-tr--root').first().click()
    await win.getByText('指南', { exact: true }).click()
    await win.getByText('readme.md', { exact: true }).click()
    await win.locator('.np-doc h1').waitFor()
    const tr = await measure('.np-tr:not(.np-tr--root)')
    expect(Math.round(tr.h), 'VISUAL_CHECK 树行高 24').toBe(24)
    expect(tr.fontSize, 'VISUAL_CHECK 树行字 12.5').toBe('12.5px')
    const ttl = await measure('.np-pane--detail .np-pane-hd .ttl')
    expect(ttl.fontSize, 'VISUAL_CHECK 右栏标题 14').toBe('14px')
    expect(ttl.fontWeight, 'VISUAL_CHECK 右栏标题 700').toBe('700')
    expect((await measure('.np-doc h1')).fontSize, 'VISUAL_CHECK 正文一级标题 22').toBe('22px')
    const bodyText = await win.locator('.np-pane--detail').innerText()
    expect(bodyText, 'VISUAL_CHECK 元数据不显示').not.toContain('样例元数据标题')
    expect(bodyText, 'VISUAL_CHECK 注释不显示').not.toContain('这段注释')
    const [r, g, b] = (await measure('.np-doc pre')).bg.match(/\d+/g).map(Number)
    expect(Math.min(r, g, b), 'VISUAL_CHECK 代码块不是暗底').toBeGreaterThan(200)
    const tokenColors = await win.evaluate(() => {
      const code = document.querySelector('.np-doc pre code')
      const base = getComputedStyle(code).color
      return [...code.querySelectorAll('span')].map((s) => getComputedStyle(s).color).filter((c) => c !== base)
    })
    expect(tokenColors, 'VISUAL_CHECK 代码块有语法高亮').toEqual([])
    expect(await hasEmoji(), 'VISUAL_CHECK 正文画面有 emoji').toBe(false)
    await shot('W2')

    // W3 往下滚到表格：数字不折行
    await win.evaluate(() => { const b = document.querySelector('.np-pane--detail .np-pane-body'); const t = b.querySelector('table'); b.scrollTop = t.offsetTop - 16 })
    // 数一数数字那段文字实际排成几行（单元格高度跟着同一行最高的那格走，不能拿来判断）
    const numLines = await win.evaluate(() => {
      const count = (text) => {
        const td = [...document.querySelectorAll('.np-doc td')].find((c) => c.textContent.trim() === text)
        if (!td) return null
        const range = document.createRange()
        range.selectNodeContents(td)
        return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size
      }
      return [count('3645'), count('15.0%')]
    })
    expect(numLines, 'VISUAL_CHECK 表格数字折行了').toEqual([1, 1])
    await shot('W3')

    // W12 搜索有结果、W13 搜索无结果
    await win.locator('.np-sf input').fill('md')
    await win.locator('.np-li').first().waitFor()
    await shot('W12')
    await win.locator('.np-sf input').fill('不存在的文件名')
    await win.getByText('无匹配文件').waitFor()
    expect(await win.locator('.np-doc h1').count(), 'VISUAL_CHECK 搜索无结果清掉了右栏').toBe(1)
    await shot('W13')
    await win.getByRole('button', { name: '清除搜索' }).click()

    // W11 文档读不出：删掉 进阶.md 再点它
    fs.rmSync(path.join(docsDir, '指南', '进阶.md'))
    await win.getByText('进阶.md', { exact: true }).click()
    await win.locator('.np-pane--detail .state-view--error').waitFor()
    await shot('W11')

    // W5 最小窗口
    await win.getByText('readme.md', { exact: true }).click()
    await win.locator('.np-doc h1').waitFor()
    await setSize(720, 500)
    await shot('W5')
    await setSize(800, 600)

    // W14 路径失效：把样例文件夹挪走再进页面
    fs.renameSync(docsDir, `${docsDir}-挪走`)
    await reload()
    await win.locator('.np-tag--orange').waitFor()
    expect(await hasEmoji(), 'VISUAL_CHECK 路径失效画面有 emoji').toBe(false)
    await shot('W14')
  }, 120000)
})
