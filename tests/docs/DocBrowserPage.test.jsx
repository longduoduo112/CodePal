/**
 * 文档查阅页组件测试（Native+，照签收的定稿包）
 *
 * 负责：
 * - 按 specs/docs-browser-redesign-dev/1-plan.md 测试清单断言页面可观察结果（TC-021 在 DocBrowserPage.visual.test.js）
 * - 外壳、双栏、目录树、搜索、右栏栏头与正文、各种状态、拖动调宽、键盘、样式回流
 * - electronAPI 全部是假的，不读真实文件夹
 *
 * @module tests/docs/DocBrowserPage.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import DocBrowserPage from '../../src/pages/DocBrowserPage'
import ComponentPreviewPage from '../../src/pages/ComponentPreviewPage'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const ALPHA = '/x/docs/Alpha'
const BETA = '/x/docs/Beta'
const GONE = '/x/docs/Gone'

const file = (folder, relativePath, size = 1234) => {
  const parts = relativePath.split('/')
  return { name: parts[parts.length - 1], relativePath, dir: parts.slice(0, -1).join('/'), fullPath: `${folder}/${relativePath}`, size }
}
const ALPHA_FILES = [file(ALPHA, 'readme.md'), file(ALPHA, 'sub/guide.md'), file(ALPHA, 'sub/deep/x.md')]
const BETA_FILES = [file(BETA, 'Readme-B.md'), file(BETA, 'notes.md')]
const FOLDERS = [
  { name: 'Alpha', path: ALPHA, fileCount: 3, valid: true },
  { name: 'Beta', path: BETA, fileCount: 2, valid: true },
  { name: 'Gone', path: GONE, fileCount: 0, valid: false },
]
const FILES_BY_FOLDER = { [ALPHA]: ALPHA_FILES, [BETA]: BETA_FILES }
const never = () => new Promise(() => {})

function makeApi(overrides = {}) {
  return {
    docListFolders: vi.fn(async () => ({ success: true, data: FOLDERS })),
    docListFiles: vi.fn(async (p) => ({ success: true, data: FILES_BY_FOLDER[p] || [] })),
    docReadFile: vi.fn(async () => ({ success: true, data: { content: '# 标题\n\n正文内容', size: 1234 } })),
    docSelectFolder: vi.fn(async () => ({ success: true, data: null })),
    docAddFolder: vi.fn(async () => ({ success: false, error: 'not used' })),
    docRemoveFolder: vi.fn(async () => ({ success: true })),
    ...overrides,
  }
}

let api
async function renderPage(overrides) {
  api = makeApi(overrides)
  window.electronAPI = api
  const utils = render(<DocBrowserPage />)
  await waitFor(() => expect(api.docListFolders).toHaveBeenCalled())
  return utils
}

const listPane = () => document.querySelector('.np-pane--list')
const detailPane = () => document.querySelector('.np-pane--detail')
const toastText = () => Array.from(document.querySelectorAll('.toast')).map((t) => t.textContent).join('|')
const treeRows = () => Array.from(document.querySelectorAll('.np-tr:not(.np-tr--root)'))
const rootRow = (name) => Array.from(document.querySelectorAll('.np-tr--root')).find((r) => r.querySelector('.nm')?.textContent === name)
const rowName = (r) => r.querySelector('.nm')?.textContent
const rowByText = (t) => treeRows().find((r) => rowName(r) === t)
const searchInput = () => screen.getByPlaceholderText('搜索文件名...')

/** 点开一个文件夹（点名字），等它的文件列表读回来 */
async function expandFolder(name, folderPath) {
  fireEvent.click(await screen.findByText(name))
  await waitFor(() => expect(api.docListFiles).toHaveBeenCalledWith(folderPath))
}

afterEach(() => {
  cleanup()
  delete window.electronAPI
})

describe('外壳与栏', () => {
  it('TC-001 新样式外壳：页名在工具栏，没有副标题，进页面不自动打开文档', async () => {
    await renderPage()
    expect(document.querySelector('.page-shell--native'), 'NATIVE_SHELL').not.toBeNull()
    expect(document.querySelector('.page-shell__title')?.textContent, 'NATIVE_SHELL').toBe('文档查阅')
    expect(screen.queryByText('浏览项目中的 Markdown 文档'), 'NATIVE_SHELL').toBeNull()
    await screen.findByText('Alpha')
    expect(detailPane()?.querySelector('.np-pane-empty')?.textContent, 'NATIVE_SHELL').toBe('选择一个文档查看内容')
    expect(api.docReadFile).not.toHaveBeenCalled()
  })

  it('TC-002 页面文字里没有 emoji', async () => {
    const hasEmoji = () => /\p{Extended_Pictographic}/u.test(document.body.textContent)
    await renderPage()
    await screen.findByText('Alpha')
    expect(hasEmoji(), 'NO_EMOJI 文件夹列表').toBe(false)
    await expandFolder('Alpha', ALPHA)
    await screen.findByText('readme.md')
    expect(hasEmoji(), 'NO_EMOJI 展开后').toBe(false)
    fireEvent.change(searchInput(), { target: { value: 'zzz' } })
    expect(hasEmoji(), 'NO_EMOJI 搜索无结果').toBe(false)
    cleanup()
    await renderPage({ docListFolders: vi.fn(async () => ({ success: true, data: [] })) })
    await screen.findByText('还没有添加文件夹')
    expect(hasEmoji(), 'NO_EMOJI 没有文件夹').toBe(false)
  })

  it('TC-003 栏头只有搜索框，栏底是「＋ 添加文件夹」', async () => {
    await renderPage()
    await screen.findByText('Alpha')
    const hd = listPane()?.querySelector('.np-pane-hd')
    expect(hd?.querySelector('.np-sf input[placeholder="搜索文件名..."]'), 'PANE_LAYOUT').toBeTruthy()
    expect(within(hd).queryAllByRole('button').filter((b) => b.textContent.includes('添加')), 'PANE_LAYOUT').toHaveLength(0)
    const ft = listPane().querySelector('.np-pane-ft')
    expect(ft, 'PANE_LAYOUT').toBeTruthy()
    const add = within(ft).getByRole('button', { name: '＋ 添加文件夹' })
    fireEvent.click(add)
    await waitFor(() => expect(api.docSelectFolder).toHaveBeenCalled())
    // 在系统的选择窗口里取消：什么都不发生
    await act(async () => {})
    expect(api.docAddFolder).not.toHaveBeenCalled()
  })
})

describe('目录树', () => {
  it('TC-004 根行带图标和数量；子目录在前、按级缩进、有文件数；文件行带图标；点中的选中', async () => {
    let finish
    await renderPage({ docListFiles: vi.fn((p) => new Promise((r) => { finish = () => r({ success: true, data: FILES_BY_FOLDER[p] || [] }) })) })
    await waitFor(() => expect(rootRow('Alpha'), 'TREE_ROWS').toBeTruthy())
    const alpha = rootRow('Alpha')
    expect(alpha.querySelector('.np-ti'), 'TREE_ROWS').not.toBeNull()
    expect(alpha.querySelector('.cnt')?.textContent, 'TREE_ROWS').toBe('3')
    fireEvent.click(alpha)
    await screen.findByText('扫描中...')
    await act(async () => finish())
    await waitFor(() => expect(treeRows().map(rowName)).toEqual(['sub', 'readme.md']))
    const sub = rowByText('sub')
    expect(sub.querySelector('.cnt')?.textContent, 'TREE_ROWS').toBe('2')
    fireEvent.click(sub)
    await waitFor(() => expect(treeRows().map(rowName)).toEqual(['sub', 'deep', 'guide.md', 'readme.md']))
    expect(rowByText('sub').style.getPropertyValue('--lv')).toBe('0')
    expect(rowByText('guide.md').style.getPropertyValue('--lv')).toBe('1')
    expect(rowByText('guide.md').querySelector('.np-ti')).not.toBeNull()
    fireEvent.click(rowByText('guide.md'))
    await waitFor(() => expect(rowByText('guide.md').classList.contains('on')).toBe(true))
    expect(rowByText('readme.md').classList.contains('on')).toBe(false)
  })

  it('TC-005 根行的「移除」只调用移除接口并提示', async () => {
    await renderPage()
    await waitFor(() => expect(rootRow('Alpha'), 'REMOVE_TEXT_BUTTON').toBeTruthy())
    const remove = within(rootRow('Alpha')).getByRole('button', { name: '移除' })
    fireEvent.click(remove)
    await waitFor(() => expect(api.docRemoveFolder).toHaveBeenCalledWith(ALPHA))
    expect(api.docRemoveFolder).toHaveBeenCalledTimes(1)
    expect(api.docListFiles).not.toHaveBeenCalled()
    expect(api.docAddFolder).not.toHaveBeenCalled()
    await waitFor(() => expect(api.docListFolders).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(toastText()).toContain('文件夹「Alpha」已移除'))
  })

  it('TC-011 路径失效：不画箭头，橙标签「找不到」，点了不展开', async () => {
    await renderPage()
    await waitFor(() => expect(rootRow('Gone'), 'INVALID_TAG').toBeTruthy())
    const gone = rootRow('Gone')
    expect(gone.querySelector('.np-tag--orange')?.textContent, 'INVALID_TAG').toBe('找不到')
    expect(gone.querySelector('.chev'), 'INVALID_TAG').toBeNull()
    fireEvent.click(gone)
    await act(async () => {})
    expect(api.docListFiles).not.toHaveBeenCalledWith(GONE)
  })
})

describe('搜索', () => {
  it('TC-007 搜索无结果：一句话 + 清除搜索，右栏文档不清空', async () => {
    await renderPage()
    await expandFolder('Alpha', ALPHA)
    fireEvent.click(await screen.findByText('readme.md'))
    await screen.findByText('正文内容')
    fireEvent.change(searchInput(), { target: { value: 'zzz' } })
    await waitFor(() => expect(listPane()?.textContent, 'SEARCH_EMPTY').toContain('无匹配文件'))
    const clear = within(listPane()).getByRole('button', { name: '清除搜索' })
    expect(screen.getByText('正文内容')).toBeTruthy()
    fireEvent.click(clear)
    expect(searchInput().value).toBe('')
    await waitFor(() => expect(within(listPane()).getByText('readme.md')).toBeTruthy())
  })

  it('TC-008 搜索结果：「N 个匹配文件」+ 列表项（文件名 / 所在路径）', async () => {
    await renderPage()
    await expandFolder('Alpha', ALPHA)
    await screen.findByText('readme.md')
    fireEvent.change(searchInput(), { target: { value: 'guide' } })
    await waitFor(() => expect(listPane()?.querySelector('.np-lg')?.textContent, 'SEARCH_LIST').toContain('1 个匹配文件'))
    const items = Array.from(listPane().querySelectorAll('.np-li'))
    expect(items.length, 'SEARCH_LIST').toBe(1)
    expect(items[0].querySelector('b')?.textContent, 'SEARCH_LIST').toBe('guide.md')
    expect(items[0].querySelector('.d')?.textContent, 'SEARCH_LIST').toBe('Alpha / sub')
    fireEvent.click(items[0])
    await waitFor(() => expect(api.docReadFile).toHaveBeenCalledWith(`${ALPHA}/sub/guide.md`))
    await waitFor(() => expect(listPane().querySelector('.np-li').classList.contains('on')).toBe(true))
  })

  it('TC-037 展开子目录后搜索再清除，子目录仍展开', async () => {
    await renderPage()
    await expandFolder('Alpha', ALPHA)
    fireEvent.click(await screen.findByText('sub'))
    await screen.findByText('guide.md')
    fireEvent.change(searchInput(), { target: { value: 'read' } })
    await waitFor(() => expect(screen.queryByText('guide.md')).toBeNull())
    fireEvent.change(searchInput(), { target: { value: '' } })
    await waitFor(() => expect(screen.queryByText('guide.md'), 'KEEP_EXPANDED').not.toBeNull())
  })
})

describe('右栏', () => {
  it('TC-009 栏头：文件名 + 所在文件夹路径与大小，正文带 np-read np-doc', async () => {
    await renderPage()
    await expandFolder('Alpha', ALPHA)
    fireEvent.click(await screen.findByText('sub'))
    fireEvent.click(await screen.findByText('guide.md'))
    await screen.findByText('正文内容')
    const hd = detailPane()?.querySelector('.np-pane-hd')
    expect(hd?.querySelector('.ttl')?.textContent, 'DETAIL_HEADER').toBe('guide.md')
    const meta = hd.querySelector('.meta')
    expect(meta?.textContent, 'DETAIL_HEADER').toContain('Alpha / sub')
    expect(meta.querySelector('.num')?.textContent, 'DETAIL_HEADER').toBe('1.2 KB')
    expect(detailPane().querySelector('.np-read.np-doc'), 'DETAIL_HEADER').not.toBeNull()
  })

  it('TC-040 路径超过三级时中间省略，悬停是完整路径', async () => {
    const deep = [file(ALPHA, 'a/b/c/deep.md')]
    await renderPage({ docListFiles: vi.fn(async () => ({ success: true, data: deep })) })
    await expandFolder('Alpha', ALPHA)
    for (const d of ['a', 'b', 'c']) fireEvent.click(await screen.findByText(d))
    fireEvent.click(await screen.findByText('deep.md'))
    await screen.findByText('正文内容')
    const where = detailPane().querySelector('.np-pane-hd .meta > span')
    expect(where?.textContent, 'PATH_SHORT').toBe('Alpha / … / c')
    expect(where.getAttribute('title'), 'PATH_SHORT').toBe('Alpha / a / b / c')
  })

  it('TC-010 读取失败：右栏整块错误 + 重试', async () => {
    await renderPage({ docReadFile: vi.fn(async () => ({ success: false, error: 'ENOENT' })) })
    await expandFolder('Alpha', ALPHA)
    fireEvent.click(await screen.findByText('readme.md'))
    await waitFor(() => expect(detailPane()?.querySelector('.state-view--error'), 'READ_ERROR').toBeTruthy())
    const err = detailPane().querySelector('.state-view--error')
    expect(err.textContent, 'READ_ERROR').toContain('无法读取文件')
    expect(err.textContent, 'READ_ERROR').toContain('文件可能已被删除或移动')
    fireEvent.click(within(err).getByRole('button', { name: '重试' }))
    await waitFor(() => expect(api.docReadFile).toHaveBeenCalledTimes(2))
  })

  it('TC-016 文档读取中：栏头有文件名和路径、没有大小，正文是骨架', async () => {
    await renderPage({ docReadFile: vi.fn(never) })
    await expandFolder('Alpha', ALPHA)
    fireEvent.click(await screen.findByText('readme.md'))
    await waitFor(() => expect(detailPane()?.querySelector('.np-pane-hd .ttl')?.textContent, 'DOC_SKELETON').toBe('readme.md'))
    expect(detailPane().querySelector('.np-pane-hd .meta')?.textContent, 'DOC_SKELETON').toContain('Alpha')
    expect(detailPane().querySelector('.np-pane-hd .num'), 'DOC_SKELETON').toBeNull()
    expect(detailPane().querySelector('.np-sk'), 'DOC_SKELETON').not.toBeNull()
    expect(detailPane().querySelector('.state-view--loading'), 'DOC_SKELETON').toBeNull()
  })

  it('TC-035 开头元数据和 HTML 注释不显示', async () => {
    const content = '---\ntitle: 元数据标题\nsummary: 元数据摘要\n---\n\n<!-- 注释文字：生成日期 -->\n# 正式标题\n\n正文内容'
    await renderPage({ docReadFile: vi.fn(async () => ({ success: true, data: { content, size: 200 } })) })
    await expandFolder('Alpha', ALPHA)
    fireEvent.click(await screen.findByText('readme.md'))
    await screen.findByText('正文内容')
    const text = detailPane().textContent
    expect(text, 'HIDE_META').not.toContain('元数据摘要')
    expect(text, 'HIDE_META').not.toContain('title:')
    expect(text, 'HIDE_META').not.toContain('注释文字')
    expect(screen.getByText('正式标题').tagName).toBe('H1')
  })
})

describe('整栏状态与动作', () => {
  it('TC-006 没有文件夹：左栏整块空态 + 主按钮，栏底那行不显示', async () => {
    await renderPage({ docListFolders: vi.fn(async () => ({ success: true, data: [] })) })
    await waitFor(() => expect(listPane()?.querySelector('.state-view--empty'), 'EMPTY_SIDEBAR').toBeTruthy())
    const empty = listPane().querySelector('.state-view--empty')
    expect(empty.textContent).toContain('还没有添加文件夹')
    expect(empty.textContent).toContain('添加文件夹后即可浏览其中的 Markdown 文档')
    expect(within(empty).getByRole('button', { name: '添加文件夹' }).className, 'EMPTY_SIDEBAR').toContain('btn--primary')
    expect(listPane().querySelector('.np-pane-ft'), 'EMPTY_SIDEBAR').toBeNull()
    expect(detailPane()?.querySelector('.np-pane-empty')?.textContent).toBe('选择一个文档查看内容')
  })

  it('TC-015 文件夹列表首次读取：左栏整块转圈，右栏一句话', async () => {
    api = makeApi({ docListFolders: vi.fn(never) })
    window.electronAPI = api
    render(<DocBrowserPage />)
    await waitFor(() => expect(listPane()?.querySelector('.state-view--loading'), 'FIRST_LOAD').toBeTruthy())
    expect(listPane().textContent).toContain('加载中...')
    expect(detailPane()?.querySelector('.np-pane-empty')?.textContent, 'FIRST_LOAD').toBe('选择一个文档查看内容')
  })

  it('TC-036 添加文件夹扫描期间，栏底按钮禁用「添加中…」', async () => {
    let finish
    await renderPage({
      docSelectFolder: vi.fn(async () => ({ success: true, data: '/x/docs/New' })),
      docAddFolder: vi.fn(() => new Promise((r) => { finish = () => r({ success: true, data: { name: 'New', fileCount: 1, files: [file('/x/docs/New', 'a.md')] } }) })),
    })
    await screen.findByText('Alpha')
    const ft = () => listPane()?.querySelector('.np-pane-ft')
    fireEvent.click(within(ft()).getByRole('button'))
    await waitFor(() => expect(within(ft()).getByRole('button').textContent, 'ADDING_STATE').toBe('添加中…'))
    expect(within(ft()).getByRole('button').disabled, 'ADDING_STATE').toBe(true)
    await act(async () => finish())
    await waitFor(() => expect(within(ft()).getByRole('button').textContent).toBe('＋ 添加文件夹'))
  })

  it('TC-038 键盘：行能 Tab 选到，回车展开和打开', async () => {
    await renderPage()
    await waitFor(() => expect(rootRow('Alpha'), 'KEYBOARD').toBeTruthy())
    const alpha = rootRow('Alpha')
    expect(alpha.getAttribute('tabindex'), 'KEYBOARD').toBe('0')
    fireEvent.keyDown(alpha, { key: 'Enter' })
    await waitFor(() => expect(api.docListFiles, 'KEYBOARD').toHaveBeenCalledWith(ALPHA))
    await waitFor(() => expect(rowByText('readme.md')).toBeTruthy())
    expect(rowByText('readme.md').getAttribute('tabindex')).toBe('0')
    fireEvent.keyDown(rowByText('readme.md'), { key: 'Enter' })
    await waitFor(() => expect(api.docReadFile).toHaveBeenCalledWith(`${ALPHA}/readme.md`))
  })
})

describe('双栏与拖动', () => {
  it('TC-018 左栏默认 220，拖动范围 200 到 500', async () => {
    await renderPage()
    const split = document.querySelector('.np-split')
    expect(split?.style.getPropertyValue('--db-list-w'), 'RESIZE_RANGE').toBe('220px')
    const handle = document.querySelector('.resize-handle')
    expect(handle, 'RESIZE_RANGE').not.toBeNull()
    fireEvent.mouseDown(handle, { clientX: 220 })
    fireEvent.mouseMove(document, { clientX: 2000 })
    fireEvent.mouseUp(document)
    expect(split.style.getPropertyValue('--db-list-w'), 'RESIZE_RANGE').toBe('500px')
    fireEvent.mouseDown(handle, { clientX: 500 })
    fireEvent.mouseMove(document, { clientX: -2000 })
    fireEvent.mouseUp(document)
    expect(split.style.getPropertyValue('--db-list-w'), 'RESIZE_RANGE').toBe('200px')
  })

  const nativeCss = () => fs.readFileSync(path.join(root, 'src/styles/native.css'), 'utf8')
  const rule = (css, sel) => {
    const m = css.match(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))
    return m ? m[1] : ''
  }

  it('TC-019 双栏两列网格、栏体自己滚、栏头不滚、中间 0.5px 竖线', () => {
    const css = nativeCss()
    expect(rule(css, '.np-split'), 'SPLIT_SCROLL').toMatch(/display:\s*grid/)
    expect(rule(css, '.np-pane-body'), 'SPLIT_SCROLL').toMatch(/overflow:\s*auto/)
    expect(rule(css, '.np-pane-hd'), 'SPLIT_SCROLL').toMatch(/flex:\s*none/)
    expect(rule(css, '.np-pane--list'), 'SPLIT_SCROLL').toMatch(/box-shadow:\s*inset\s+-\.5px\s+0\s+0/)
  })

  it('TC-039 正文排版：标题三档、表格不断词可横滚、引用灰线、勾选清单', () => {
    const css = nativeCss()
    expect(rule(css, '.np-doc h1'), 'DOC_TYPE').toMatch(/font-size:\s*22px/)
    expect(rule(css, '.np-doc h2'), 'DOC_TYPE').toMatch(/font-size:\s*15px/)
    expect(rule(css, '.np-doc h3'), 'DOC_TYPE').toMatch(/font-size:\s*13px/)
    expect(rule(css, '.np-doc table'), 'DOC_TYPE').toMatch(/overflow-x:\s*auto/)
    expect(rule(css, '.np-doc td'), 'DOC_TYPE').toMatch(/word-break:\s*normal/)
    expect(rule(css, '.np-doc blockquote'), 'DOC_TYPE').toMatch(/box-shadow:\s*inset\s+2px\s+0\s+0/)
    expect(rule(css, '.np-doc ul.contains-task-list'), 'DOC_TYPE').toMatch(/list-style:\s*none/)
    expect(rule(css, '.np-doc input[type="checkbox"]'), 'DOC_TYPE').toMatch(/appearance:\s*none/)
  })
})

describe('样式文件与回流', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]))

  it('TC-013 旧样式表没有引用、新类回流、预览展示、页面样式不带颜色字体、测试接进 npm test', () => {
    const refs = walk(path.join(root, 'src')).filter((f) => /\.(jsx?|css)$/.test(f) && fs.readFileSync(f, 'utf8').includes('doc-browser.css'))
    expect(refs, 'STYLE_REFLOW').toEqual([])
    const native = fs.readFileSync(path.join(root, 'src/styles/native.css'), 'utf8')
    for (const c of ['np-split', 'np-pane', 'np-pane-hd', 'np-pane-body', 'np-pane-empty', 'np-tr', 'np-ti', 'np-li', 'np-lg', 'np-doc']) {
      expect(native, `STYLE_REFLOW ${c}`).toMatch(new RegExp(`\\.${c}(?![\\w-])`))
    }
    const page = fs.readFileSync(path.join(root, 'src/pages/docs/docs.css'), 'utf8')
    expect(page, 'STYLE_REFLOW 页面样式声明了变量').not.toMatch(/--[\w-]+\s*:/)
    expect(page, 'STYLE_REFLOW 页面样式写了颜色').not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)
    expect(page, 'STYLE_REFLOW 页面样式写了字体').not.toMatch(/font-family/)
    expect(page + native, 'STYLE_REFLOW 移除按钮悬停出现').toMatch(/:hover[^{]*np-tr-rm/)
    expect(page + native, 'STYLE_REFLOW 移除按钮键盘聚焦出现').toMatch(/:focus-within[^{]*np-tr-rm/)
    const { container } = render(<ComponentPreviewPage />)
    for (const c of ['np-split', 'np-tr', 'np-li', 'np-lg']) {
      expect(container.querySelector(`.${c}`), `STYLE_REFLOW 预览 ${c}`).not.toBeNull()
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    expect(pkg.scripts['test:docs'], 'STYLE_REFLOW').toMatch(/tests\/docs/)
    expect(pkg.scripts.test, 'STYLE_REFLOW').toContain('npm run test:docs')
  })
})

describe('保持现状的行为', () => {
  it('TC-012 添加文件夹后提示并自动展开', async () => {
    const added = [file('/x/docs/New', 'hello.md'), file('/x/docs/New', 'world.md')]
    let listed = FOLDERS
    await renderPage({
      docListFolders: vi.fn(async () => ({ success: true, data: listed })),
      docSelectFolder: vi.fn(async () => ({ success: true, data: '/x/docs/New' })),
      docAddFolder: vi.fn(async () => {
        listed = [...FOLDERS, { name: 'New', path: '/x/docs/New', fileCount: 2, valid: true }]
        return { success: true, data: { name: 'New', fileCount: 2, files: added } }
      }),
    })
    await screen.findByText('Alpha')
    fireEvent.click(screen.getAllByRole('button', { name: /添加/ })[0])
    await waitFor(() => expect(api.docAddFolder).toHaveBeenCalledWith('/x/docs/New'))
    await waitFor(() => expect(toastText()).toContain('已添加文件夹「New」，共发现 2 个 .md 文件'))
    await screen.findByText('hello.md')
    expect(screen.getByText('world.md')).toBeTruthy()
  })

  it('TC-014 按文件名搜索覆盖展开过的文件夹、不区分大小写', async () => {
    await renderPage()
    await expandFolder('Alpha', ALPHA)
    await screen.findByText('readme.md')
    await expandFolder('Beta', BETA)
    await screen.findByText('notes.md')
    fireEvent.change(searchInput(), { target: { value: 'READ' } })
    await screen.findByText('readme.md')
    expect(screen.getByText('Readme-B.md')).toBeTruthy()
    expect(screen.queryByText('notes.md')).toBeNull()
    // 只有空格不算搜索：目录树照常
    fireEvent.change(searchInput(), { target: { value: '   ' } })
    await screen.findByText('notes.md')
  })

  it('TC-017 同一时间只展开一个文件夹', async () => {
    await renderPage()
    await expandFolder('Alpha', ALPHA)
    await screen.findByText('readme.md')
    await expandFolder('Beta', BETA)
    await screen.findByText('notes.md')
    expect(screen.queryByText('readme.md')).toBeNull()
  })

  it('TC-020 没展开过的文件夹不进搜索结果', async () => {
    await renderPage({
      docListFiles: vi.fn(async (p) => ({ success: true, data: p === ALPHA ? ALPHA_FILES : [file(BETA, 'readme-beta.md')] })),
    })
    await expandFolder('Alpha', ALPHA)
    await screen.findByText('readme.md')
    fireEvent.change(searchInput(), { target: { value: 'readme' } })
    await screen.findByText('readme.md')
    expect(screen.queryByText('readme-beta.md')).toBeNull()
    expect(api.docListFiles).not.toHaveBeenCalledWith(BETA)
  })

  it('TC-022 点添加按钮调起选择文件夹', async () => {
    await renderPage()
    await screen.findByText('Alpha')
    fireEvent.click(screen.getAllByRole('button', { name: /添加/ })[0])
    await waitFor(() => expect(api.docSelectFolder).toHaveBeenCalledTimes(1))
  })

  it('TC-023 移除第一个文件夹：只传它的路径、重新读列表、提示', async () => {
    await renderPage()
    await screen.findByText('Alpha')
    fireEvent.click(screen.getAllByRole('button', { name: /^(移除|×)$/ })[0])
    await waitFor(() => expect(api.docRemoveFolder).toHaveBeenCalledTimes(1))
    expect(api.docRemoveFolder).toHaveBeenCalledWith(ALPHA)
    await waitFor(() => expect(api.docListFolders).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(toastText()).toContain('文件夹「Alpha」已移除'))
  })

  it('TC-024 搜索后点结果：读这个文件并显示内容', async () => {
    await renderPage()
    await expandFolder('Alpha', ALPHA)
    await screen.findByText('readme.md')
    fireEvent.change(searchInput(), { target: { value: 'guide' } })
    fireEvent.click(await screen.findByText('guide.md'))
    await waitFor(() => expect(api.docReadFile).toHaveBeenCalledWith(`${ALPHA}/sub/guide.md`))
    await screen.findByText('正文内容')
  })

  it('TC-025 Markdown 标题与正文照常渲染', async () => {
    await renderPage()
    await expandFolder('Alpha', ALPHA)
    fireEvent.click(await screen.findByText('readme.md'))
    const heading = await screen.findByText('标题')
    expect(heading.tagName).toBe('H1')
    expect(screen.getByText('正文内容')).toBeTruthy()
  })

  it('TC-026 只按文件名搜：只有子目录名含关键词时没有结果', async () => {
    await renderPage()
    await expandFolder('Alpha', ALPHA)
    await screen.findByText('readme.md')
    fireEvent.change(searchInput(), { target: { value: 'deep' } })
    await screen.findByText('无匹配文件')
    expect(screen.queryByText('x.md')).toBeNull()
  })

  it('TC-027 再点已展开的文件夹根行会收起', async () => {
    await renderPage()
    await expandFolder('Alpha', ALPHA)
    await screen.findByText('readme.md')
    fireEvent.click(screen.getByText('Alpha'))
    await waitFor(() => expect(screen.queryByText('readme.md')).toBeNull())
  })

  it('TC-028 再点已展开的子目录会收起', async () => {
    await renderPage()
    await expandFolder('Alpha', ALPHA)
    fireEvent.click(await screen.findByText('sub'))
    await screen.findByText('guide.md')
    fireEvent.click(screen.getByText('sub'))
    await waitFor(() => expect(screen.queryByText('guide.md')).toBeNull())
  })

  it('TC-029 搜索框清除钮清空关键词、目录树回来', async () => {
    await renderPage()
    await expandFolder('Alpha', ALPHA)
    await screen.findByText('readme.md')
    fireEvent.change(searchInput(), { target: { value: 'guide' } })
    await screen.findByText('guide.md')
    fireEvent.click(screen.getByRole('button', { name: /^(✕|×|清空搜索框)$/ }))
    expect(searchInput().value).toBe('')
    await screen.findByText('readme.md')
  })

  it('TC-030 添加已经加过的文件夹：警告提示接口原因，不重新读列表', async () => {
    await renderPage({
      docSelectFolder: vi.fn(async () => ({ success: true, data: ALPHA })),
      docAddFolder: vi.fn(async () => ({ success: false, errorCode: 'DUPLICATE', error: '该文件夹已添加' })),
    })
    await screen.findByText('Alpha')
    fireEvent.click(screen.getAllByRole('button', { name: /添加/ })[0])
    await waitFor(() => expect(toastText()).toContain('该文件夹已添加'))
    expect(api.docListFolders).toHaveBeenCalledTimes(1)
  })

  it('TC-031 添加的文件夹里没有 .md：警告提示原文', async () => {
    await renderPage({
      docSelectFolder: vi.fn(async () => ({ success: true, data: '/x/docs/Empty' })),
      docAddFolder: vi.fn(async () => ({ success: true, data: { name: 'Empty', fileCount: 0, files: [] } })),
    })
    await screen.findByText('Alpha')
    fireEvent.click(screen.getAllByRole('button', { name: /添加/ })[0])
    await waitFor(() => expect(toastText()).toContain('文件夹下没有找到 .md 文件'))
  })

  it('TC-032 添加文件夹时接口报错：错误提示接口原因', async () => {
    await renderPage({
      docSelectFolder: vi.fn(async () => ({ success: true, data: '/x/docs/Bad' })),
      docAddFolder: vi.fn(async () => ({ success: false, error: '无法读取该文件夹' })),
    })
    await screen.findByText('Alpha')
    fireEvent.click(screen.getAllByRole('button', { name: /添加/ })[0])
    await waitFor(() => expect(toastText()).toContain('无法读取该文件夹'))
  })

  it('TC-033 移除文件夹时接口报错：错误提示接口原因，不重新读列表', async () => {
    await renderPage({ docRemoveFolder: vi.fn(async () => ({ success: false, error: '移除失败了' })) })
    await screen.findByText('Alpha')
    fireEvent.click(screen.getAllByRole('button', { name: /^(移除|×)$/ })[0])
    await waitFor(() => expect(toastText()).toContain('移除失败了'))
    expect(api.docListFolders).toHaveBeenCalledTimes(1)
  })

  it('TC-034 重试仍然失败：错误提示原文', async () => {
    await renderPage({ docReadFile: vi.fn(async () => ({ success: false, error: 'ENOENT' })) })
    await expandFolder('Alpha', ALPHA)
    fireEvent.click(await screen.findByText('readme.md'))
    fireEvent.click(await screen.findByRole('button', { name: '重试' }))
    await waitFor(() => expect(toastText()).toContain('文件读取失败，文件可能已被删除或移动'))
  })
})
