/**
 * Skill 管理页右栏：装载总览
 *
 * 负责：
 * - 栏头「HH:MM 读取」+「重新读取」（读取中 / 失败原位换字）
 * - 每个工具一张卡：装载的 Skill 数、约多少 tokens、来源色条与来源行（插件不算）
 * - 工具没找到 / 读不出 / 同步目录读不出的就地表达
 * - 「要处理」：外部 Skill 没收进（全部收进资产库）、同一工具装了两份（点了跳到它）
 *
 * @module pages/skills/SkillOverview
 */

import React from 'react'
import Button from '../../components/Button/Button'
import { formatTokens, hasDuplicate, isExternal, syncedUnreadable, toolStatus } from './skillsModel'
import { ToolIcon } from './SkillDetail'

const pad = (value) => String(value).padStart(2, '0')

function ChevronIcon() {
  return <svg className="sk-chev" viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2 6.5 5l-3 3" /></svg>
}

/**
 * 一张工具卡
 * @returns {JSX.Element}
 */
function ToolCard({ toolId, label, snapshot, loading, onRetry }) {
  const status = toolStatus(snapshot, toolId)
  const load = snapshot?.tools?.[toolId]?.load
  const header = (right) => (
    <div className="np-card-hd">
      <span className="np-card-title"><ToolIcon toolId={toolId} />{label}</span>
      {right}
    </div>
  )
  if (loading) {
    return (
      <div className="np-card sk-tool-card">
        {header(<span className="np-sk np-sk--pulse sk-sk-90" />)}
        <div className="sk-stack"><i className="sk-seg-empty" /></div>
      </div>
    )
  }
  if (status === 'missing') {
    return <div className="np-card sk-tool-card">{header(<span className="np-st off"><i />没找到 Codex</span>)}</div>
  }
  if (status === 'unreadable' || !load) {
    return (
      <div className="np-card sk-tool-card">
        {header(<span className="sk-count sk-count--na">—</span>)}
        <div className="np-errline">
          <span className="sk-grow">{label} 状态无法读取，其他数据仍可使用</span>
          <Button size="sm" className="np-btn" onClick={onRetry}>重试</Button>
        </div>
      </div>
    )
  }
  const readOnlyKey = toolId === 'claude-code' ? 'synced' : 'system'
  const readOnlyCount = load[readOnlyKey]
  const syncedBroken = toolId === 'claude-code' && syncedUnreadable(snapshot)
  const rows = [
    { key: 'personal', label: '个人', ds: '在这页开关', value: load.personal, seg: 'sk-seg-personal' },
    toolId === 'claude-code'
      ? { key: 'synced', label: 'claude.ai 同步', ds: syncedBroken ? 'claude.ai 同步的 Skill 读不出' : '在 claude.ai 的设置里关', bad: syncedBroken, value: syncedBroken ? '—' : readOnlyCount, seg: 'sk-seg-readonly' }
      : { key: 'system', label: '系统自带', ds: 'Codex 自带，关不了', value: readOnlyCount, seg: 'sk-seg-readonly' },
  ]
  const numeric = rows.filter((row) => typeof row.value === 'number' && row.value > 0)
  return (
    <div className="np-card sk-tool-card">
      {header(
        <span className="sk-load">
          <span className="sk-count">{load.total}</span>
          <span className="sk-load-unit">个 Skill · 约 <span className="sk-num">{formatTokens(load.tokens)}</span> tokens</span>
        </span>
      )}
      <div className="sk-stack">
        {numeric.length === 0
          ? <i className="sk-seg-empty" />
          : numeric.map((row) => <i key={row.key} className={row.seg} style={{ flexGrow: row.value }} />)}
      </div>
      <div className="sk-rows">
        {rows.map((row) => (
          <div key={row.key} className="np-row">
            <div className="lf">
              <div className="lb"><span className={`sk-key ${row.seg}`} />{row.label}</div>
              <div className={`ds${row.bad ? ' bad' : ''}`}>{row.ds}</div>
            </div>
            <span className="sk-n">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * @param {object} props
 * @param {object|null} props.snapshot
 * @param {boolean} props.loading - 首次读取中
 * @param {'idle'|'busy'|'error'} props.refreshState
 * @param {() => void} props.onRefresh
 * @param {(name: string) => void} props.onSelect
 * @param {() => void} props.onAdoptAll
 * @param {boolean} props.adoptingAll
 * @returns {JSX.Element}
 */
export default function SkillOverview({ snapshot, loading, refreshState, onRefresh, onSelect, onAdoptAll, adoptingAll }) {
  const readAt = snapshot?.generatedAt ? new Date(snapshot.generatedAt) : null
  const externals = (snapshot?.skills || []).filter(isExternal)
  const duplicates = (snapshot?.skills || []).filter(hasDuplicate)
  const todoCount = (externals.length > 0 ? 1 : 0) + duplicates.length
  const describeDuplicate = (skill) => {
    const toolId = Object.entries(skill.tools || {}).find(([, state]) => state?.duplicate)?.[0]
    return `${toolId === 'codex' ? 'Codex' : 'Claude Code'} 里有两份，内容不一样`
  }

  return (
    <div className="np-pane np-pane--detail">
      <div className="np-pane-hd">
        <h2 className="ttl">装载总览</h2>
        <div className="meta">
          <span>{readAt ? <><span className="num">{pad(readAt.getHours())}:{pad(readAt.getMinutes())}</span> 读取</> : '读取中'}</span>
          <span className="acts">
            {refreshState === 'busy'
              ? <Button size="sm" className="np-btn" disabled>读取中…</Button>
              : <Button size="sm" className="np-btn" onClick={onRefresh} disabled={loading}>{refreshState === 'error' ? '重试' : '重新读取'}</Button>}
          </span>
        </div>
      </div>
      <div className="np-pane-body">
        {refreshState === 'error' && <div className="np-errline sk-block">读取失败，下面是上次读到的结果</div>}
        <ToolCard toolId="claude-code" label="Claude Code" snapshot={snapshot} loading={loading} onRetry={onRefresh} />
        <ToolCard toolId="codex" label="Codex" snapshot={snapshot} loading={loading} onRetry={onRefresh} />
        {!loading && todoCount > 0 && (
          <>
            <div className="np-glabel">要处理<span className="cnt">{todoCount}</span></div>
            <div className="np-card np-card--form">
              {externals.length > 0 && (
                <div className="np-row">
                  <div className="lf">
                    <div className="lb">{externals.length} 个外部 Skill 不在资产库</div>
                    <div className="ds">{externals.map((skill) => skill.name).join('、')}</div>
                  </div>
                  <Button size="sm" className="np-btn" onClick={onAdoptAll} disabled={adoptingAll}>{adoptingAll ? '收进中…' : '全部收进资产库'}</Button>
                </div>
              )}
              {duplicates.map((skill) => (
                <div
                  key={skill.name}
                  className="np-row np-row--rec"
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(skill.name)}
                  onKeyDown={(event) => { if (event.key === 'Enter') onSelect(skill.name) }}
                >
                  <div className="lf">
                    <div className="lb">{skill.name}</div>
                    <div className="ds">{describeDuplicate(skill)}</div>
                  </div>
                  <span className="np-rec-end"><span className="np-st warn"><i />装了两份</span><ChevronIcon /></span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
