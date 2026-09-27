/**
 * @vitest-environment node
 *
 * 模型接入 · 结果判定（4-test-cases.md 模块 D 的纯函数部分）
 *
 * 负责：
 * - 成功 / Key 无效 / 余额不足 / 模型不存在 / 连不上 / 其他 / 结构化输出 的判定
 * - 其他错误消息截断并去掉疑似 Key
 *
 * @module tests/models/classify.test
 */

import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { classifyResult } = require('../../electron/modules/models/classify.js')

const ok = { type: 'result', subtype: 'success', is_error: false }
const out = (extra) => ({ exitCode: 0, timedOut: false, stderr: '', stdout: JSON.stringify({ ...ok, ...extra }) })

describe('模块 D · 判定', () => {
  it('TC-D01 成功 JSON 判定为可用', () => {
    expect(classifyResult(out({ result: 'CODEPAL_OK', session_id: 's1' }))).toMatchObject({ ok: true, reason: null })
  })
  it('TC-D02 成功外壳里的 API Error 401 判为 key', () => {
    expect(classifyResult(out({ result: 'API Error: 401 {"error":{"message":"Authentication Fails"}}' }))).toMatchObject({ ok: false, reason: 'key' })
  })
  it('TC-D03 402 判为 balance', () => {
    expect(classifyResult(out({ result: 'API Error: 402 {"error":{"message":"Insufficient Balance"}}' })).reason).toBe('balance')
  })
  it('TC-D04 404 模型不存在判为 model', () => {
    expect(classifyResult(out({ result: 'API Error: 404 {"error":{"message":"Model Not Exist"}}' })).reason).toBe('model')
  })
  it('TC-D05 连接失败判为 net', () => {
    expect(classifyResult({ exitCode: 1, stdout: '', stderr: 'Connection error.', timedOut: false }).reason).toBe('net')
  })
  it('超时判为 net', () => {
    expect(classifyResult({ exitCode: 143, stdout: '', stderr: '', timedOut: true }).reason).toBe('net')
  })
  it('TC-D07 其他错误截断到 60 字并去掉疑似 Key', () => {
    const r = classifyResult(out({ result: 'API Error: 500 upstream said key sk-live-AAAAAAAAAAAAAAAAAAAA is weird and here is a very long explanation that keeps going beyond sixty characters' }))
    expect(r.reason).toBe('other')
    expect(r.message.length).toBeLessThanOrEqual(60)
    expect(r.message).not.toContain('sk-live-')
    expect(r.message).not.toContain('AAAAAAAAAAAA')
  })
  it('TC-H06 实测 401 原文（Failed to authenticate 开头、is_error、退出码 1）判为 key', () => {
    const r = { exitCode: 1, timedOut: false, stderr: '', stdout: JSON.stringify({ ...ok, is_error: true, result: 'Failed to authenticate. API Error: 401 Authentication Fails, Your api key: ****tion is invalid (request_id: x)' }) }
    expect(classifyResult(r)).toMatchObject({ ok: false, reason: 'key' })
  })
  it('TC-H06 实测 400 原文（模型名不支持）判为 model', () => {
    const r = { exitCode: 1, timedOut: false, stderr: '', stdout: JSON.stringify({ ...ok, is_error: true, result: 'API Error: 400 The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed deepseek-not-exist-codepal. (request_id: x)' }) }
    expect(classifyResult(r)).toMatchObject({ ok: false, reason: 'model' })
  })
  it('TC-D16 result 为空但有 structured_output 判为成功', () => {
    expect(classifyResult(out({ result: '', structured_output: { verdict: 'ACK', findings: [], knownGaps: [] } }))).toMatchObject({ ok: true, reason: null })
  })
  it('is_error 为 true 时不算成功', () => {
    expect(classifyResult(out({ is_error: true, result: 'something failed' })).ok).toBe(false)
  })
  it('退出码非 0 且没有 JSON 时判为 other', () => {
    expect(classifyResult({ exitCode: 2, stdout: '', stderr: 'boom', timedOut: false })).toMatchObject({ ok: false, reason: 'other' })
  })
})
