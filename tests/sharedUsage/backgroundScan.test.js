/* @vitest-environment node */
/** Background JSONL scanning without credentials or production data. @module tests/sharedUsage/backgroundScan */
import { afterEach, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const homes = []
const start = new Date('2026-09-27T00:00:00+08:00')
const end = new Date('2026-09-28T00:00:00+08:00')
const row = (id, input, timestamp = '2026-09-27T03:00:00Z') => ({
  type: 'assistant', timestamp, cwd: '/tmp/demo',
  message: { id, model: 'deepseek-flash', usage: { input_tokens: input, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 } },
})
function setup() {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'background-usage-'))
  homes.push(homeDir)
  const models = path.join(homeDir, 'models-override')
  const bg = path.join(models, 'claude-home', 'projects')
  const main = path.join(homeDir, '.claude', 'projects')
  const filename = path.resolve('electron/services/backgroundUsageService.js')
  expect(fs.existsSync(filename), 'BACKGROUND_SCAN service exists').toBe(true)
  const { createBackgroundUsageService } = require(filename)
  return { homeDir, bg, main, service: createBackgroundUsageService({ homeDir, env: { CODEPAL_MODELS_HOME: models } }) }
}
function write(root, name, lines) {
  const p = path.join(root, '-demo', name + '.jsonl')
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, lines.map(JSON.stringify).join('\n') + '\n')
}
afterEach(() => homes.splice(0).forEach(p => fs.rmSync(p, { recursive: true, force: true })))
it('TC-001 BACKGROUND_SCAN uses override, latest usage snapshot, skips missing usage and keeps independent ID-less rows', async () => {
  const d = setup()
  write(d.bg, 'a', [row('one', 1), row('one', 10, '2026-09-27T03:01:00Z'), row(undefined, 20), { type: 'assistant', message: { model: 'deepseek-flash' } }])
  write(d.bg, 'b', [row(undefined, 20), row('duplicate', 900)])
  write(d.main, 'primary', [row('duplicate', 100)])
  const records = await d.service.scan(start, end)
  expect(records.map(r => r.input).sort((a,b) => a-b)).toEqual([10, 20, 20])
  expect(records.every(r => r.model === 'deepseek-flash' && r.output === 2 && r.cacheRead === 3 && r.cacheCreate === 4 && r.project === 'demo')).toBe(true)
  expect(await d.service.earliest()).toBe('2026-09-27')
  expect(await d.service.status()).toBe('present')
  expect(await d.service.scan(end, new Date('2026-09-29T00:00:00+08:00'))).toEqual([])
})
it('TC-001 BACKGROUND_SCAN missing directory is zero, realpath alias counts once, invalid root fails', async () => {
  const d = setup()
  expect(await d.service.status()).toBe('missing')
  expect(await d.service.scan(start, end)).toEqual([])
  expect(await d.service.earliest()).toBeNull()
  write(d.main, 'a', [row('one', 10)])
  fs.mkdirSync(path.dirname(d.bg), { recursive: true })
  fs.symlinkSync(d.main, d.bg)
  expect(await d.service.scan(start, end)).toEqual([])
  fs.unlinkSync(d.bg)
  fs.writeFileSync(d.bg, 'not a directory')
  await expect(d.service.status()).rejects.toThrow()
  await expect(d.service.scan(start, end)).rejects.toThrow()
})
