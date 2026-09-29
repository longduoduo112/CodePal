/**
 * Skill 管理页左栏
 *
 * 负责：
 * - 栏头搜索框（⌘F 聚焦、Esc 清空由页面处理）
 * - 第一条「装载总览」，下面按分组列 Skill：名字、一句话用途、每个工具的状态点、次数、问题标签
 * - 读取中骨架、整体读取失败、资产库为空、搜索无结果
 * - ↑↓ 在列表里换选中
 *
 * @module pages/skills/SkillList
 */

import React, { useEffect, useRef } from 'react'
import Button from '../../components/Button/Button'
import StateView from '../../components/StateView/StateView'
import { OVERVIEW_ID, TOOLS, hasDuplicate, hasMissingFolder, isReadOnly, readOnlyKind, splitHits, toolStatus } from './skillsModel'

function Highlight({ text, query }) {
  return splitHits(text, query).map((part, index) => (part.hit
    ? <mark key={index} className="np-hit">{part.text}</mark>
    : <React.Fragment key={index}>{part.text}</React.Fragment>))
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="5" cy="5" r="3.6" /><path d="M7.8 7.8 10.5 10.5" /></svg>
  )
}

/**
 * 一条 Skill
 * @returns {JSX.Element}
 */
function SkillItem({ skill, selected, onSelect, onKeyDown, snapshot, usage, usageFailed, query }) {
  const readOnly = isReadOnly(skill)
  const dots = TOOLS.filter((tool) => toolStatus(snapshot, tool.id) !== 'missing')
    .filter((tool) => !readOnly || skill.tools?.[tool.id]?.enabled === true)
    .filter((tool) => skill.managed || skill.tools?.[tool.id]?.state !== 'disabled' || skill.tools?.[tool.id]?.enabled)
  const total = usage?.total || 0
  let end = null
  if (readOnly) {
    end = readOnlyKind(skill).list
  } else if (usageFailed) {
    end = <><span className="n">—</span> 次</>
  } else if (total > 0) {
    end = <><span className="n">{total}</span> 次</>
  }
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      data-id={skill.name}
      className={`np-li${selected ? ' on' : ''}`}
      onClick={() => onSelect(skill.name)}
      onKeyDown={onKeyDown}
    >
      <b><Highlight text={skill.displayName || skill.name} query={query} /></b>
      {skill.description && <span className="d"><Highlight text={skill.description} query={query} /></span>}
      <span className="m">
        {dots.map((tool) => (
          <span key={tool.id} className={`dot${skill.tools?.[tool.id]?.enabled === true ? '' : ' off'}`}>{tool.short}</span>
        ))}
        {hasDuplicate(skill) && <span className="np-tag np-tag--orange">两份</span>}
        {hasMissingFolder(skill) && <span className="np-tag np-tag--orange">找不到</span>}
        {end && <span className="end">{end}</span>}
      </span>
    </div>
  )
}

/**
 * @param {object} props
 * @param {'loading'|'error'|'ready'} props.status - 快照读取状态
 * @param {object|null} props.snapshot
 * @param {Array} props.groups - buildGroups 的结果
 * @param {string} props.selectedId - 选中的 Skill 名或 OVERVIEW_ID
 * @param {(id: string) => void} props.onSelect
 * @param {string} props.query
 * @param {(value: string) => void} props.onQueryChange
 * @param {Map} props.usageMap
 * @param {boolean} props.usageFailed
 * @param {() => void} props.onRetry - 整体读取失败时重试
 * @param {object} props.searchRef - 搜索框 ref（⌘F 用）
 * @returns {JSX.Element}
 */
export default function SkillList({ status, snapshot, groups, selectedId, onSelect, query, onQueryChange, usageMap, usageFailed, onRetry, searchRef }) {
  const bodyRef = useRef(null)
  const searching = Boolean(query.trim())
  const hasLibrary = (snapshot?.skills || []).some((skill) => skill.managed)
  const order = [
    ...(searching ? [] : [OVERVIEW_ID]),
    ...groups.flatMap((group) => group.skills.map((skill) => skill.name)),
  ]

  // 选中项变了（↑↓、点总览里的一行）：滚到它并把焦点给它
  useEffect(() => {
    const body = bodyRef.current
    const node = body?.querySelector(`[data-id="${CSS.escape(selectedId)}"]`)
    if (!node) return
    if (typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  const handleKeyDown = (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const index = order.indexOf(selectedId)
    const next = order[Math.min(order.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))]
    if (!next || next === selectedId) return
    onSelect(next)
    requestAnimationFrame(() => bodyRef.current?.querySelector(`[data-id="${CSS.escape(next)}"]`)?.focus())
  }

  let body
  if (status === 'loading' && !snapshot) {
    body = (
      <>
        <div className="np-lg"><span className="np-sk np-sk--pulse sk-sk-60" /></div>
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="np-li">
            <b><span className="np-sk np-sk--pulse sk-sk-120" /></b>
            <span className="d"><span className="np-sk np-sk--pulse sk-sk-160" /></span>
          </div>
        ))}
      </>
    )
  } else if (status === 'error' && !snapshot) {
    body = <StateView error="没有修改任何目录" errorTitle="Skill 状态读取失败" onRetry={onRetry} />
  } else if (searching && groups.length === 0) {
    body = (
      <div className="np-hstack sk-search-empty">
        <span className="np-empty">没有符合条件的 Skill</span>
        <Button variant="ghost" className="np-btn-text" onClick={() => onQueryChange('')}>清除搜索</Button>
      </div>
    )
  } else {
    const loadOf = (toolId) => (toolStatus(snapshot, toolId) === 'ok' && snapshot?.tools?.[toolId]?.load ? snapshot.tools[toolId].load.total : '—')
    body = (
      <>
        {!searching && (
          <div
            role="option"
            aria-selected={selectedId === OVERVIEW_ID}
            tabIndex={selectedId === OVERVIEW_ID ? 0 : -1}
            data-id={OVERVIEW_ID}
            className={`np-li${selectedId === OVERVIEW_ID ? ' on' : ''}`}
            onClick={() => onSelect(OVERVIEW_ID)}
            onKeyDown={handleKeyDown}
          >
            <b>装载总览</b>
            <span className="m">
              {TOOLS.map((tool) => <span key={tool.id}>{tool.short} <span className="n">{loadOf(tool.id)}</span></span>)}
            </span>
          </div>
        )}
        {!searching && !hasLibrary && <div className="np-empty sk-list-note">资产库还没有 Skill</div>}
        {groups.map((group) => (
          <React.Fragment key={group.id}>
            <div className="np-lg"><span>{group.title}</span><span className="cnt">{group.skills.length}</span></div>
            {group.skills.map((skill) => (
              <SkillItem
                key={skill.name}
                skill={skill}
                selected={selectedId === skill.name}
                onSelect={onSelect}
                onKeyDown={handleKeyDown}
                snapshot={snapshot}
                usage={usageMap.get(skill.name)}
                usageFailed={usageFailed}
                query={query.trim()}
              />
            ))}
          </React.Fragment>
        ))}
      </>
    )
  }

  return (
    <div className="np-pane np-pane--list">
      <div className="np-pane-hd">
        <label className="np-sf">
          <SearchIcon />
          <input
            ref={searchRef}
            value={query}
            placeholder="搜索名称和用途"
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape') onQueryChange('') }}
          />
          {query && <button type="button" className="np-sf-clear" aria-label="清空搜索框" onClick={() => onQueryChange('')}>×</button>}
        </label>
      </div>
      <div className="np-pane-body" ref={bodyRef} role="listbox" aria-label="Skill 列表">
        {body}
      </div>
    </div>
  )
}
