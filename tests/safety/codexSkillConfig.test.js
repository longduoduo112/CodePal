/**
 * 已退役（2026-09-29，specs/skills-redesign-dev2）：Skills 管理页换成 Native+ 双栏、Codex 开关改走官方接口。
 * 接替：CodePal 自己改 config.toml 文字的写法已换成 Codex 官方接口：配置读不出时不可用 → TC-007，启用失败不留半截 → TC-037（tests/skills/codexSkillApi.test.js）；其余文字编辑细节随写法一起退役。
 * 这个文件只是占位：dev-workflow 不支持在任务里删文件，合并后单独删掉它，并从 package.json 的脚本里去掉。
 *
 * @module tests/safety/codexSkillConfig.test
 */

import { describe, it } from 'vitest'

describe.skip('已退役，见 tests/skills', () => {
  it('由 tests/skills 接替', () => {})
})
