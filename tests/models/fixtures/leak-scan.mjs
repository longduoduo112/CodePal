#!/usr/bin/env node
/**
 * Key 泄漏扫描（TC-S03）
 *
 * 负责：
 * - 自己读 Key 文件，在内存里和各文件内容比对 Key 前 12 个字符；不用 grep，Key 不进命令行
 * - 递归扫描给定的文件 / 目录（跳过 secrets 目录），输出扫描文件数与命中文件（只给路径，不给内容）
 *
 * 用法：node leak-scan.mjs --key-file <Key 文件> <路径>...
 *
 * @module tests/models/fixtures/leak-scan
 */
import fs from 'node:fs'
import path from 'node:path'

const i = process.argv.indexOf('--key-file')
const needle = fs.readFileSync(process.argv[i + 1], 'utf8').trim().slice(0, 12)
const roots = process.argv.slice(2).filter((_, j) => j !== i - 2 && j !== i - 1)
let files = 0
const hits = []

function scan(p) {
  let st
  try { st = fs.lstatSync(p) } catch { return }
  if (st.isSymbolicLink()) return
  if (st.isDirectory()) {
    if (path.basename(p) === 'secrets') return
    for (const name of fs.readdirSync(p)) scan(path.join(p, name))
    return
  }
  if (!st.isFile()) return
  files++
  if (fs.readFileSync(p).includes(needle)) hits.push(p)
}

for (const r of roots) scan(r)
console.log(JSON.stringify({ files, hits: hits.length, hitFiles: hits }))
process.exit(hits.length ? 1 : 0)
