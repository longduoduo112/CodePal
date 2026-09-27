/**
 * @vitest-environment node
 *
 * 模型接入 · 打包配置（TC-P01 的静态部分）
 *
 * 负责：
 * - 模型模块整体解包出 asar：终端命令用 CodePal 自带的 Node 直接跑 cli.cjs，读不了 asar 里的文件
 * - 模型模块只依赖 Node 内置库和同目录文件，解包这一个目录就够
 *
 * 真实打包后的端到端检查见 4-test-cases.md TC-P01（打包产物跑命令，不进 npm test）。
 *
 * @module tests/models/packaging.test
 */

import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { REPO } from './helpers'

const BUILTINS = new Set(['fs', 'os', 'path', 'crypto', 'child_process'])

describe('打包配置', () => {
  it('electron/modules/models 整体解包', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'))
    expect(pkg.build.asarUnpack).toContain('electron/modules/models/**')
  })

  it('模型模块只 require Node 内置库与同目录文件', () => {
    const dir = path.join(REPO, 'electron/modules/models')
    const outside = []
    for (const name of fs.readdirSync(dir).filter((n) => /\.c?js$/.test(n))) {
      const text = fs.readFileSync(path.join(dir, name), 'utf8')
      for (const [, spec] of text.matchAll(/require\('([^']+)'\)/g)) {
        if (!spec.startsWith('./') && !BUILTINS.has(spec)) outside.push(`${name}: ${spec}`)
      }
    }
    expect(outside).toEqual([])
  })
})
