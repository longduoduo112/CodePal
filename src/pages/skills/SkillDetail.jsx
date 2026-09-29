/**
 * Skill 管理页右栏：一个 Skill 的详情
 *
 * 负责：
 * - 栏头：名字（折行显示全）+ 来源 · 近 30 天次数；外部 Skill 右上「收进资产库」（两个工具各有一份时禁用并说明）
 * - 启用：每个工具一个开关（只读的是状态点 + 去哪关；外部的 Codex 禁用；工具读不出 / 没找到禁用）；隶属插件；装了两份
 * - 近 30 天调用记录、说明、位置（名字一行、完整路径一行）、删除
 *
 * @module pages/skills/SkillDetail
 */

import React from 'react'
import Button from '../../components/Button/Button'
import Toggle from '../../components/Toggle'
import { TOOLS, formatRecordTime, isExternal, isReadOnly, readOnlyKind, recordProject, sourceLabel, toolStatus } from './skillsModel'

const TOOL_ICON = {
  'claude-code': { className: 'sk-ic-claude', path: 'M3 4.5 6.5 8 3 11.5M8 12h5' },
  codex: { className: 'sk-ic-codex', path: 'M5.5 4.5 2.5 8l3 3.5M10.5 4.5l3 3.5-3 3.5' },
}

/**
 * 工具的 20px 图标方块
 * @param {{toolId: string}} props
 * @returns {JSX.Element}
 */
export function ToolIcon({ toolId }) {
  const icon = TOOL_ICON[toolId]
  return (
    <span className={`np-ic np-ic--s20 ${icon.className}`} aria-hidden="true">
      <svg viewBox="0 0 16 16"><path d={icon.path} /></svg>
    </span>
  )
}

const LOCATION_LABEL = { central: '资产库', 'claude-code': 'Claude Code', codex: 'Codex' }

/**
 * 启用卡里一个工具的一行
 * @returns {JSX.Element|null}
 */
function ToolRow({ tool, skill, snapshot, pending, onToggle }) {
  const state = skill.tools?.[tool.id]
  const status = toolStatus(snapshot, tool.id)
  const readOnly = isReadOnly(skill)
  if (readOnly) {
    if (state?.enabled !== true) return null
    const where = readOnlyKind(skill).where
    return (
      <div className="np-row">
        <div className="lf sk-tool">
          <ToolIcon toolId={tool.id} />
          <div className="lf"><div className="lb">{tool.label}</div><div className="ds">{where}</div></div>
        </div>
        <span className="np-st"><i />装载中</span>
      </div>
    )
  }
  let note = ''
  let disabled = pending
  if (status === 'missing') {
    note = '没找到 Codex'
    disabled = true
  } else if (status === 'unreadable' || state?.state === 'unavailable') {
    note = `${tool.label} 状态读不出`
    disabled = true
  } else if (isExternal(skill) && state?.state !== 'external') {
    note = `收进资产库后才能装到 ${tool.label}`
    disabled = true
  }
  return (
    <div className="np-row">
      <div className="lf sk-tool">
        <ToolIcon toolId={tool.id} />
        <div className="lf"><div className="lb">{tool.label}</div>{note && <div className="ds">{note}</div>}</div>
      </div>
      <Toggle checked={state?.enabled === true} disabled={disabled} onChange={(next) => onToggle(tool.id, next)} />
    </div>
  )
}

/**
 * @param {object} props
 * @param {object} props.skill
 * @param {object|null} props.snapshot
 * @param {object|undefined} props.usage - { total, claude, codex }
 * @param {boolean} props.usageFailed
 * @param {() => void} props.onRetryUsage
 * @param {{status: string, records: Array}} props.records
 * @param {string[]} props.pluginNames - 同名的插件
 * @param {Set<string>} props.pendingKeys
 * @param {(toolId: string, enabled: boolean) => void} props.onToggle
 * @param {() => void} props.onAdopt
 * @param {boolean} props.adoptConflict - 两个工具里各有一份外部的，分不出从哪份收
 * @param {boolean} props.adopting
 * @param {() => void} props.onDelete
 * @returns {JSX.Element}
 */
export default function SkillDetail({ skill, snapshot, usage, usageFailed, onRetryUsage, records, pluginNames, pendingKeys, onToggle, onAdopt, adoptConflict = false, adopting, onDelete }) {
  const readOnly = isReadOnly(skill)
  const external = isExternal(skill)
  const total = usage?.total || 0
  const countText = usageFailed ? <>近 30 天 <span className="num">—</span> 次</> : total > 0 ? <>近 30 天 <span className="num">{total}</span> 次</> : '近 30 天没用'
  const duplicateTool = TOOLS.find((tool) => skill.tools?.[tool.id]?.duplicate)
  const recordList = records?.records || []

  return (
    <div className="np-pane np-pane--detail">
      <div className="np-pane-hd">
        <h2 className="ttl">{skill.displayName || skill.name}</h2>
        <div className="meta">
          <span>{sourceLabel(skill)}{readOnly ? '' : <> · {countText}</>}</span>
          {external && (
            <span className="acts">
              <Button size="sm" variant="primary" className="np-btn" onClick={onAdopt} disabled={adopting || adoptConflict}>{adopting ? '收进中…' : '收进资产库'}</Button>
            </span>
          )}
        </div>
      </div>
      <div className="np-pane-body">
        <div className="np-glabel">启用</div>
        <div className="np-card np-card--form">
          {TOOLS.map((tool) => (
            <ToolRow
              key={tool.id}
              tool={tool}
              skill={skill}
              snapshot={snapshot}
              pending={pendingKeys.has(`${skill.name}:${tool.id}`)}
              onToggle={onToggle}
            />
          ))}
          {pluginNames.length > 0 && (
            <div className="np-row np-kv"><span className="lb">隶属插件</span><span className="v">{pluginNames.join('、')}</span></div>
          )}
          {external && adoptConflict && (
            <div className="np-row">
              <div className="lf">
                <div className="lb">两个工具里各有一份</div>
                <div className="ds warn">分不出该收哪一份，先在工具目录里删掉其中一份再收进资产库</div>
              </div>
            </div>
          )}
          {duplicateTool && (
            <div className="np-row">
              <div className="lf">
                <div className="lb">{duplicateTool.label} 里有两份</div>
                <div className="ds warn">一份来自资产库，一份是旧目录里的副本，内容不一样，两份都在装载</div>
              </div>
            </div>
          )}
        </div>

        {!readOnly && (
          <>
            <div className="np-glabel">近 30 天调用{!usageFailed && total > 0 && <span className="cnt">{total} 次</span>}</div>
            <div className="np-card np-card--form">
              {usageFailed ? (
                <div className="np-row">
                  <span className="np-errline">调用数据读取失败</span>
                  <Button size="sm" className="np-btn" onClick={onRetryUsage}>重试</Button>
                </div>
              ) : recordList.length === 0 ? (
                <div className="np-row"><span className="np-empty">{records?.status === 'loading' ? '读取中…' : '近 30 天没有记录到调用'}</span></div>
              ) : recordList.map((record) => (
                <div key={record.invocationId} className="np-lrow">
                  <span className="t">{formatRecordTime(record.triggeredAt)}</span>
                  <span>{record.tool === 'codex' ? 'Codex' : 'Claude Code'}</span>
                  <span className="e">{recordProject(record)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="np-glabel">说明</div>
        <div className="np-read sk-desc"><p>{skill.description || '暂无说明'}</p></div>

        <div className="np-glabel">位置</div>
        <div className="np-card np-card--form">
          {(skill.locations || []).map((location, index) => (
            <div key={`${location.toolId}-${index}`} className="np-row sk-prow">
              <div className="lf">
                <div className="lb">{LOCATION_LABEL[location.toolId] || location.toolId}</div>
                <div className="sk-p">{location.path}</div>
                {location.target && <div className="sk-p sk-to">→ {location.target}</div>}
                {location.missing && <div className="sk-p sk-bad">找不到这个文件夹</div>}
              </div>
            </div>
          ))}
        </div>

        {skill.managed && (
          <>
            <div className="np-glabel">删除</div>
            <div className="np-card np-card--form">
              <div className="np-row">
                <div className="lf"><div className="lb">从资产库删除</div><div className="ds">资产库和各工具里的都会删掉</div></div>
                <Button size="sm" variant="danger" className="np-btn" onClick={onDelete}>删除</Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
