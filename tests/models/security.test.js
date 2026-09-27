/**
 * @vitest-environment node
 *
 * 模型接入 · 贯穿安全（替身部分）
 *
 * 负责：
 * - TC-S04 两个模型并发各用各的，测试进程自己的环境不变（开发自检）
 * - 真 Key 用例用到的两个工具自己先证明有效：采样器能从进程参数里抓到标记、扫描器能在文件里找到片段
 *
 * 真 Key 下的 S01–S03、S05 在 4-test-cases.md 按步骤人工驱动，不进 npm test。
 *
 * @module tests/models/security.test
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { makeSandbox, readReport, CLI, KEY } from './helpers'

const require = createRequire(import.meta.url)
const store = require('../../electron/modules/models/store.js')
const FIX = path.join(path.dirname(CLI), '../../../tests/models/fixtures')

let sb
beforeEach(() => {
  sb = makeSandbox()
  process.env.CODEPAL_MODELS_HOME = sb.models
  store.setKey('deepseek', KEY)
  store.addModel('deepseek', 'deepseek-v4-pro')
})
afterEach(() => {
  delete process.env.CODEPAL_MODELS_HOME
  sb.cleanup()
})

/** 起一个命令行进程，等它结束 */
function runAsync(model, report) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, 'launch', 'deepseek', model, '--', '--print'], {
      env: { ...sb.env, ANTHROPIC_MODEL: 'claude-opus-5', FAKE_CLAUDE_MODE: 'success', FAKE_CLAUDE_REPORT: report },
      stdio: ['pipe', 'ignore', 'ignore'],
    })
    child.stdin.end('hi')
    child.on('close', resolve)
  })
}

describe('贯穿 · 安全（替身）', () => {
  it('TC-S04 两个模型并发各用各的', async () => {
    const before = process.env.ANTHROPIC_MODEL
    const r1 = path.join(sb.root, 'r1.json')
    const r2 = path.join(sb.root, 'r2.json')
    await Promise.all([runAsync('deepseek-flash', r1), runAsync('deepseek-v4-pro', r2)])
    expect(readReport(r1).env.ANTHROPIC_MODEL).toBe('deepseek-flash')
    expect(readReport(r2).env.ANTHROPIC_MODEL).toBe('deepseek-v4-pro')
    expect(process.env.ANTHROPIC_MODEL).toBe(before)
  })

  it('采样器自检：能从进程参数里抓到标记，Key 片段不在参数里时命中 0', async () => {
    const keyFile = path.join(sb.models, 'secrets', 'deepseek.key')
    const out = path.join(sb.root, 'sampler.json')
    const marker = `CODEPAL-SAMPLER-SELFTEST-${Math.random().toString(16).slice(2, 10)}`
    const sampler = spawn(process.execPath, [path.join(FIX, 'argv-sampler.mjs'), '--key-file', keyFile, '--out', out, '--selftest', marker, '--seconds', '3'], { stdio: 'ignore' })
    const holder = spawn(process.execPath, [path.join(FIX, 'argv-marker.mjs'), marker], { stdio: 'ignore' })
    await new Promise((resolve) => sampler.on('close', resolve))
    holder.kill()
    const stats = JSON.parse(fs.readFileSync(out, 'utf8'))
    expect(stats.samples).toBeGreaterThan(3)
    expect(stats.selftestHits).toBeGreaterThan(0)
    expect(stats.keyHits).toBe(0)
  }, 15000)

  it('扫描器：能在文件里找到 Key 片段，跳过 secrets 目录', () => {
    const keyFile = path.join(sb.models, 'secrets', 'deepseek.key')
    const clean = spawnSync(process.execPath, [path.join(FIX, 'leak-scan.mjs'), '--key-file', keyFile, sb.models], { encoding: 'utf8' })
    expect(clean.status).toBe(0)
    expect(JSON.parse(clean.stdout)).toMatchObject({ hits: 0 })
    expect(JSON.parse(clean.stdout).files).toBeGreaterThan(0)
    fs.writeFileSync(path.join(sb.root, 'leak.log'), `oops ${KEY.slice(0, 14)}\n`)
    const dirty = spawnSync(process.execPath, [path.join(FIX, 'leak-scan.mjs'), '--key-file', keyFile, sb.root], { encoding: 'utf8' })
    expect(dirty.status).toBe(1)
    expect(JSON.parse(dirty.stdout).hits).toBe(1)
  })
})
