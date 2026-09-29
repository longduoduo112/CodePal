/**
 * Skill 管理页（Native+ 双栏，照签收定稿 specs/skills-redesign/Skill管理-定稿/）
 *
 * 负责：
 * - 读快照（useSkillControl）与近 30 天次数（useSkillUsage），编排左栏列表与右栏总览 / 详情
 * - 开关、收进资产库（单个 / 全部）、删除、重新读取；结果一律走全局 toast，删除确认走 confirmDialog
 * - 开关失败的三种结局：已保留原状态 / 已按实际状态显示 / 当前状态读不出
 * - 键盘：左栏 ↑↓（在 SkillList）、⌘F 聚焦搜索、Esc 清除搜索
 *
 * @module pages/skills/SkillsPage
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PageShell from '../../components/PageShell'
import { toast, notifyToast } from '../../components/Toast'
import { confirmDialog } from '../../components/Modal/confirmDialog'
import useSkillControl from '../../hooks/useSkillControl'
import useSkillUsage from '../../hooks/useSkillUsage'
import SkillList from './SkillList'
import SkillOverview from './SkillOverview'
import SkillDetail from './SkillDetail'
import { OVERVIEW_ID, TOOLS, buildGroups, isExternal, toolStatus } from './skillsModel'
import './skills.css'

const TOOL_LABEL = Object.fromEntries(TOOLS.map((tool) => [tool.id, tool.label]))

/** 外部 Skill 从哪个工具收进来：唯一一个标成外部、可写的工具 */
function adoptSourceTool(skill) {
  const tools = Object.entries(skill.tools || {}).filter(([, state]) => state?.state === 'external' && state.mutable !== false)
  return tools.length === 1 ? tools[0][0] : null
}

/** 调用记录：选中一个 Skill 时读它近 30 天的记录 */
function useRecords(skillName, refreshToken) {
  const [records, setRecords] = useState({ status: 'idle', records: [] })
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI : null
    if (!skillName || !api?.listSkillRunSamples) {
      setRecords({ status: 'idle', records: [] })
      return undefined
    }
    let cancelled = false
    setRecords((previous) => ({ status: 'loading', records: previous.records }))
    api.listSkillRunSamples({ skillName, windowDays: 30 })
      .then((result) => {
        if (cancelled) return
        setRecords(result?.success ? { status: 'ready', records: result.data?.records || [] } : { status: 'error', records: [] })
      })
      .catch(() => { if (!cancelled) setRecords({ status: 'error', records: [] }) })
    return () => { cancelled = true }
  }, [skillName, refreshToken])
  return records
}

/** 已启用插件里的 Skill 名 → 插件名（只用来写「隶属插件」，读不到就不写） */
function usePluginSiblings() {
  const [siblings, setSiblings] = useState(() => new Map())
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI : null
    if (!api?.getPluginControlSnapshot) return undefined
    let cancelled = false
    api.getPluginControlSnapshot({})
      .then((result) => {
        if (cancelled || !result?.success) return
        const map = new Map()
        for (const plugin of result.data?.plugins || []) {
          if (plugin.installed === false || plugin.enabled === false) continue
          for (const child of plugin.childSkills || []) {
            const names = map.get(child.name) || []
            if (!names.includes(plugin.name)) map.set(child.name, [...names, plugin.name])
          }
        }
        setSiblings(map)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  return siblings
}

/**
 * @param {object} props
 * @param {number} [props.refreshSignal=0] - 外部触发的重读
 * @returns {JSX.Element}
 */
export default function SkillsPage({ refreshSignal = 0 }) {
  const {
    status,
    snapshot,
    pendingKeys,
    refresh,
    execute,
    setActivation,
    adoptExternalSkill,
    adoptExternalSkills,
  } = useSkillControl(refreshSignal)
  const [selectedId, setSelectedId] = useState(OVERVIEW_ID)
  const [query, setQuery] = useState('')
  const [refreshState, setRefreshState] = useState('idle')
  const [usageToken, setUsageToken] = useState(0)
  const [adoptingAll, setAdoptingAll] = useState(false)
  const searchRef = useRef(null)

  const skills = snapshot?.skills || []
  const usageNames = useMemo(
    () => skills.filter((skill) => skill.managed || isExternal(skill)).map((skill) => skill.name).sort(),
    [skills],
  )
  const { status: usageStatus, usageMap } = useSkillUsage(usageNames, 30, usageToken)
  const usageFailed = usageStatus === 'error'
  const groups = useMemo(() => buildGroups(skills, { usageMap, usageFailed, query: query.trim() }), [skills, usageMap, usageFailed, query])
  const selectedSkill = selectedId === OVERVIEW_ID ? null : skills.find((skill) => skill.name === selectedId) || null
  const records = useRecords(selectedSkill && (selectedSkill.managed || isExternal(selectedSkill)) ? selectedSkill.name : null, usageToken)
  const siblings = usePluginSiblings()

  // 选中的 Skill 没了（删了）：回到总览
  useEffect(() => {
    if (snapshot && selectedId !== OVERVIEW_ID && !skills.some((skill) => skill.name === selectedId)) setSelectedId(OVERVIEW_ID)
  }, [snapshot, skills, selectedId])

  // ⌘F / Ctrl+F 聚焦搜索框
  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleRefresh = useCallback(async () => {
    setRefreshState('busy')
    setUsageToken((token) => token + 1)
    const result = await refresh({ silent: true })
    setRefreshState(result.success ? 'idle' : 'error')
  }, [refresh])

  const handleToggle = useCallback(async (skill, toolId, enabled) => {
    const label = TOOL_LABEL[toolId]
    const source = skill.origins?.find((origin) => origin.toolId === toolId && origin.mutable)
    const result = await setActivation({ skillName: skill.name, toolId, enabled, source })
    if (result.success) {
      toast.success(`已在 ${label} ${enabled ? '启用' : '停用'} ${skill.displayName || skill.name}`)
      return
    }
    if (result.error === 'STATE_UNKNOWN') {
      // 状态不确定：按重新读到的实际显示；这个工具还是读不出就明说
      let latest = result.snapshot || null
      if (!latest) {
        const reread = await refresh({ silent: true })
        latest = reread.success ? reread.data : null
      }
      const readable = latest && toolStatus(latest, toolId) === 'ok'
        && latest.skills?.find((item) => item.name === skill.name)?.tools?.[toolId]?.state !== 'unavailable'
      toast.error(readable ? '操作失败，已按实际状态显示' : '操作失败，当前状态读不出')
      return
    }
    toast.error(result.error === 'PERMISSION_DENIED' ? '操作失败，请检查工具目录权限' : '操作失败，已保留原状态')
  }, [setActivation, refresh])

  const handleAdopt = useCallback(async (skill) => {
    const toolId = adoptSourceTool(skill)
    const result = toolId ? await adoptExternalSkill({ skillName: skill.name, toolId }) : { success: false }
    if (result.success) {
      toast.success(`已从 ${TOOL_LABEL[toolId]} 收进资产库：${skill.displayName || skill.name}`)
      return
    }
    toast.error('收进资产库失败，原外部 Skill 已保留')
  }, [adoptExternalSkill])

  const handleAdoptAll = useCallback(async () => {
    const operations = []
    let conflicts = 0
    for (const skill of skills.filter(isExternal)) {
      const toolId = adoptSourceTool(skill)
      if (toolId) operations.push({ skillName: skill.name, toolId })
      else conflicts += 1
    }
    setAdoptingAll(true)
    const result = await adoptExternalSkills(operations)
    setAdoptingAll(false)
    const adopted = result.adopted?.length || 0
    const failed = result.failed?.length || 0
    if (failed === 0 && conflicts === 0) {
      toast.success(`已将 ${adopted} 个外部 Skill 收进资产库`)
      return
    }
    notifyToast({ message: `已收进 ${adopted} 个，${conflicts} 个来源冲突、${failed} 个失败`, type: failed > 0 ? 'error' : 'warning' })
  }, [skills, adoptExternalSkills])

  const handleDelete = useCallback(async (skill) => {
    const tools = TOOLS.filter((tool) => (skill.locations || []).some((location) => location.toolId === tool.id)).map((tool) => tool.label)
    const description = tools.length > 0
      ? `资产库里的和 ${tools.join(' 和 ')} 里的都会删掉，不能撤销。`
      : '资产库里的会被删掉，不能撤销。'
    let outcome = null
    const confirmed = await confirmDialog({
      title: `删除 ${skill.name}？`,
      description,
      confirmText: '删除',
      danger: true,
      busyText: '删除中…',
      onConfirm: async () => {
        outcome = await execute({ skillName: skill.name, toolId: 'all', action: 'delete' })
        return true
      },
    })
    if (!confirmed || !outcome) return
    if (outcome.success) {
      setSelectedId(OVERVIEW_ID)
      toast.success(`已删除 ${skill.name}`)
      return
    }
    toast.error('删除失败，什么都没改')
  }, [execute])

  const loading = status === 'loading' && !snapshot
  const failed = status === 'error' && !snapshot

  let detail
  if (failed) {
    detail = <div className="np-pane np-pane--detail"><div className="np-pane-empty">选一个 Skill 查看</div></div>
  } else if (selectedSkill) {
    const adoptTool = adoptSourceTool(selectedSkill)
    detail = (
      <SkillDetail
        skill={selectedSkill}
        snapshot={snapshot}
        usage={usageMap.get(selectedSkill.name)}
        usageFailed={usageFailed}
        onRetryUsage={() => setUsageToken((token) => token + 1)}
        records={records}
        pluginNames={selectedSkill.managed ? siblings.get(selectedSkill.name) || [] : []}
        pendingKeys={pendingKeys}
        onToggle={(toolId, enabled) => handleToggle(selectedSkill, toolId, enabled)}
        onAdopt={() => handleAdopt(selectedSkill)}
        adoptConflict={isExternal(selectedSkill) && !adoptTool}
        adopting={Boolean(adoptTool && pendingKeys.has(`${selectedSkill.name}:${adoptTool}`))}
        onDelete={() => handleDelete(selectedSkill)}
      />
    )
  } else {
    detail = (
      <SkillOverview
        snapshot={snapshot}
        loading={loading}
        refreshState={refreshState}
        onRefresh={handleRefresh}
        onSelect={setSelectedId}
        onAdoptAll={handleAdoptAll}
        adoptingAll={adoptingAll}
      />
    )
  }

  return (
    <PageShell title="Skills" native className="sk-page">
      <div className="np-split">
        <SkillList
          status={status}
          snapshot={snapshot}
          groups={groups}
          selectedId={selectedId}
          onSelect={setSelectedId}
          query={query}
          onQueryChange={setQuery}
          usageMap={usageMap}
          usageFailed={usageFailed}
          onRetry={() => refresh()}
          searchRef={searchRef}
        />
        {detail}
      </div>
    </PageShell>
  )
}
