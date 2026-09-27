/**
 * 模型接入页 · 视图推导
 *
 * 负责：
 * - 页面上的各家显示信息与主进程预设一致（名称、类型字、Key 前缀、思考强度档位）
 * - 时间写法、上限解析、命令写法、主按钮优先级
 *
 * @module tests/models/modelsView.test
 */

import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { EFFORTS, PROVIDERS, commandText, modelNameError, parsePositiveInt, primaryAction, testedAtParts } from '../../src/features/models/modelsView'

process.env.TZ = 'Asia/Shanghai'
const require = createRequire(import.meta.url)
const presets = require('../../electron/modules/models/presets.js')

describe('modelsView', () => {
  it('各家显示信息与主进程预设一致，顺序相同', () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual(Object.keys(presets.PRESETS))
    for (const p of PROVIDERS) {
      const main = presets.PRESETS[p.id]
      expect({ name: p.name, type: p.type, keyPrefix: p.keyPrefix }).toEqual({ name: main.name, type: main.type, keyPrefix: main.keyPrefix })
    }
    expect(EFFORTS).toEqual(presets.EFFORTS)
  })

  it('时间写法：今天 / 昨天 / 今年 / 往年', () => {
    const now = new Date('2026-09-26T13:00:00.000Z').getTime()
    expect(testedAtParts('2026-09-26T12:38:00.000Z', now)).toEqual({ prefix: '', clock: '20:38' })
    expect(testedAtParts('2026-09-25T13:48:00.000Z', now)).toEqual({ prefix: '昨天 ', clock: '21:48' })
    expect(testedAtParts('2026-09-17T00:15:00.000Z', now)).toEqual({ prefix: '9月17日 ', clock: '08:15' })
    expect(testedAtParts('2025-12-03T02:00:00.000Z', now)).toEqual({ prefix: '2025年12月3日', clock: null })
  })

  it('上限只收正整数，允许千分位', () => {
    expect(parsePositiveInt('1,048,576')).toBe(1048576)
    expect(parsePositiveInt('0')).toBeNull()
    expect(parsePositiveInt('abc')).toBeNull()
    expect(parsePositiveInt('1.5')).toBeNull()
    expect(parsePositiveInt('-3')).toBeNull()
  })

  it('模型名：空、非法字符、与供应商同名、重名（不区分大小写）', () => {
    expect(modelNameError('', [])).toBe('模型名不能为空')
    expect(modelNameError('a b', [])).toBe('只能用字母、数字和 . - _')
    expect(modelNameError('DeepSeek', [])).toBe('不能和供应商同名')
    expect(modelNameError('DEEPSEEK-FLASH', ['deepseek-flash'])).toBe('已经有这个模型了')
    expect(modelNameError('MiniMax-M2', ['deepseek-flash'])).toBeNull()
  })

  it('命令写法：在 PATH 里写命令名，不在写完整路径', () => {
    expect(commandText('deepseek-flash', { onPath: true, binDir: '~/.local/bin' })).toBe('codepal-deepseek-flash')
    expect(commandText('deepseek-flash', { onPath: false, binDir: '~/.local/bin' })).toBe('~/.local/bin/codepal-deepseek-flash')
  })

  it('主按钮优先级：填写 Key > 重新检测 > 安装命令；弹层开着时没有', () => {
    const data = {
      claudeCode: { found: false },
      commands: { missing: ['deepseek-flash'] },
      providers: { deepseek: { keySet: true, keyReadable: true, models: [{ id: 'deepseek-flash' }] } },
    }
    expect(primaryAction(data, false)).toBe('recheck')
    expect(primaryAction({ ...data, claudeCode: { found: true } }, false)).toBe('install')
    expect(primaryAction({ ...data, providers: { deepseek: { keySet: false, models: [] } } }, false)).toBe('key')
    expect(primaryAction(data, true)).toBeNull()
  })
})
