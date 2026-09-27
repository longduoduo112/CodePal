#!/usr/bin/env node
/**
 * Key 不进进程参数的采样器（TC-S02）
 *
 * 负责：
 * - 每 200 毫秒用 ps 取全部进程参数，在内存里和 Key 前 12 个字符比对（Key 由本脚本自己读文件，不经命令行）
 * - 自检：同样的方法比对 --selftest 给的标记，证明能抓到命令行里的字符串
 * - 覆盖：记下同一次采样里同时看到 cli.cjs 进程和 claude 进程的次数，证明采到了真正在跑的调用
 * - 收到 SIGTERM / SIGINT 或 --seconds 到时，把统计（不含 Key）写到 --out 文件后退出
 *
 * 用法：node argv-sampler.mjs --key-file <Key 文件> --out <统计 json> [--selftest <标记>] [--seconds N]
 *
 * @module tests/models/fixtures/argv-sampler
 */
import fs from 'node:fs'
import { execFile } from 'node:child_process'

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null }
const keyFile = arg('--key-file')
const out = arg('--out')
const selftest = arg('--selftest')
const seconds = Number(arg('--seconds') || 0)
const needle = fs.readFileSync(keyFile, 'utf8').trim().slice(0, 12)
if (needle.length < 12) { console.error('Key 太短，无法比对'); process.exit(2) }

const stats = { samples: 0, keyHits: 0, selftestHits: 0, coverageHits: 0, startedAt: new Date().toISOString() }

function sample() {
  execFile('ps', ['-axww', '-o', 'pid=,args='], { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
    if (err) return
    stats.samples++
    const lines = stdout.split('\n')
    let cli = false
    let claude = false
    for (const line of lines) {
      if (line.includes(needle)) stats.keyHits++
      if (selftest && line.includes(selftest) && !line.includes('argv-sampler')) stats.selftestHits++
      if (line.includes('cli.cjs') && line.includes(' launch ')) cli = true
      if (/^\s*\d+\s+\S*claude(\s|$)/.test(line)) claude = true
    }
    if (cli && claude) stats.coverageHits++
  })
}

const timer = setInterval(sample, 200)
const finish = () => {
  clearInterval(timer)
  stats.endedAt = new Date().toISOString()
  fs.writeFileSync(out, JSON.stringify(stats, null, 1))
  process.exit(0)
}
process.on('SIGTERM', finish)
process.on('SIGINT', finish)
if (seconds > 0) setTimeout(finish, seconds * 1000)
