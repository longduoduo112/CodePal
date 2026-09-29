/**
 * 已退役（2026-09-29，specs/skills-redesign-dev2）：Skills 管理页换成 Native+ 双栏、Codex 开关改走官方接口。
 * 接替：旧 Skill 控制中心页面的加载 / 空 / 出错重试 / 旧响应不回写 → tests/skills/SkillsPage.test.jsx 的 TC-026、TC-028、TC-047。
 * 这个文件只是占位：dev-workflow 不支持在任务里删文件，合并后单独删掉它，并从 package.json 的脚本里去掉。
 *
 * @module tests/v2/ManagePage.skillControl.test
 */

import { describe, it } from 'vitest'

describe.skip('已退役，见 tests/skills', () => {
  it('由 tests/skills 接替', () => {})
})
