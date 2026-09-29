/**
 * Skills 管理页入口
 *
 * 负责：
 * - SkillManagerModule 的「manage」子页，渲染 Native+ 双栏的 Skill 管理页（src/pages/skills/）
 * - 旧页面（推送矩阵、5 个数字格、标签筛选、配置入口）已随 2026-09 重做拿掉；配置页本身保留，暂无入口
 *
 * @module ManagePage
 */

import React from 'react'
import SkillsPage from './skills/SkillsPage'

/**
 * @param {object} props
 * @param {number} [props.refreshSignal=0] - 自动刷新信号（新增 Skill 后触发）
 * @returns {JSX.Element}
 */
export default function ManagePage({ refreshSignal = 0 }) {
  return <SkillsPage refreshSignal={refreshSignal} />
}
