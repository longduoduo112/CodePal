/**
 * 模型接入测试的公共工具
 *
 * 负责：
 * - 建临时 HOME / models 目录 / bin 目录，测试结束整目录删除
 * - 用 Node 直接跑 cli.cjs（等价于 ELECTRON_RUN_AS_NODE=1 的生产启动方式）
 * - 替身 claude 的路径与报告读取
 *
 * @module tests/models/helpers
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const REPO = path.resolve(HERE, '..', '..')
export const CLI = path.join(REPO, 'electron/modules/models/cli.cjs')
export const FAKE = path.join(HERE, 'fixtures/fake-claude.mjs')
export const KEY = 'sk-test-0123456789abcdef'

/**
 * 建一套隔离目录
 * @returns {{ root: string, home: string, models: string, bin: string, report: string, env: object, cleanup: Function }}
 */
export function makeSandbox() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'codepal-models-')))
  const home = path.join(root, 'home')
  fs.mkdirSync(home)
  const models = path.join(root, 'models')
  const bin = path.join(root, 'bin')
  const report = path.join(root, 'report.json')
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    CODEPAL_MODELS_HOME: models,
    CODEPAL_BIN_DIR: bin,
    CODEPAL_CLAUDE_BIN: FAKE,
    FAKE_CLAUDE_REPORT: report,
  }
  return { root, home, models, bin, report, env, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) }
}

/**
 * 同步跑一次命令行
 * @param {string[]} args - cli.cjs 之后的参数
 * @param {{ env: object, input?: string, cwd?: string }} opts
 * @returns {{ status: number|null, stdout: string, stderr: string }}
 */
export function runCli(args, { env, input = '', cwd }) {
  const r = spawnSync(process.execPath, [CLI, ...args], { env, input, cwd, encoding: 'utf8', timeout: 30000 })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, signal: r.signal }
}

/**
 * 异步起一个命令行进程（信号与超时用例）
 * @returns {import('node:child_process').ChildProcess}
 */
export function spawnCli(args, { env, cwd }) {
  return spawn(process.execPath, [CLI, ...args], { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] })
}

/** 读替身报告，不存在返回 null */
export function readReport(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
}

/** 等某个条件成立，最多 ms 毫秒 */
export async function waitFor(fn, ms = 5000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (fn()) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return false
}

/** 进程是否还活着 */
export function alive(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}
