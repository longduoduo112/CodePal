/**
 * 模型接入页 · 数据与动作
 *
 * 负责：
 * - 进页面、窗口重新激活时读 models:list（配置 + Claude Code 检测 + 终端命令状态）
 * - 后台审核 / 终端写回结果时（models:changed）原地更新那一行，不弹 Toast
 * - 存 Key、测一下、加 / 改 / 移除模型、重新检测、安装命令；成功失败的 Toast 在这里统一发
 * - 存 Key、添加、改名成功后自动测一次（AI 补，用户 2026-09-26 认可）
 *
 * @module features/models/useModels
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '../../components/Toast'
import { confirmDialog } from '../../components/Modal/confirmDialog'

const api = () => window.electronAPI

/** 写操作的失败原因：没有 message 时给一句兜底 */
const errMessage = (res) => res?.error?.message || '出错了'

/**
 * 模型接入页的状态与动作
 * @returns {object}
 */
export default function useModels() {
  // null = 首次读取中（卡头照常、模型行出骨架）
  const [data, setData] = useState(null)
  // 配置整体读不出时整块显示「读取失败」
  const [loadFailed, setLoadFailed] = useState(false)
  // 正在测的模型：`${providerId}__${modelId}`
  const [testing, setTesting] = useState(() => new Set())
  // 正在移除的模型，同一个键
  const [removing, setRemoving] = useState(() => new Set())
  const [installing, setInstalling] = useState(false)
  const [rechecking, setRechecking] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const reload = useCallback(async () => {
    const res = await api().modelsList()
    if (!mounted.current) return
    if (res?.success) {
      setData(res.data)
      setLoadFailed(false)
    } else {
      setLoadFailed(true)
    }
  }, [])

  /** 用主进程返回的一家数据替换本地那一家；写操作顺带返回的终端命令状态一起换 */
  const applyProvider = useCallback((providerId, provider, commands) => {
    setData((d) => d && ({
      ...d,
      providers: { ...d.providers, [providerId]: provider },
      commands: commands || d.commands,
    }))
  }, [])

  /** 某个模型的最近结果 */
  const applyResult = useCallback((providerId, modelId, lastResult) => {
    setData((d) => {
      const prov = d?.providers?.[providerId]
      if (!prov || !prov.models.some((m) => m.id === modelId)) return d
      const models = prov.models.map((m) => (m.id === modelId ? { ...m, lastResult } : m))
      return { ...d, providers: { ...d.providers, [providerId]: { ...prov, models } } }
    })
  }, [])

  const mark = (setter, key, on) => setter((s) => {
    const next = new Set(s)
    if (on) next.add(key)
    else next.delete(key)
    return next
  })

  const test = useCallback(async (providerId, modelId) => {
    const key = `${providerId}__${modelId}`
    mark(setTesting, key, true)
    try {
      const res = await api().modelsTest({ providerId, modelId })
      if (!mounted.current) return
      if (res?.success) {
        applyResult(providerId, modelId, res.data.lastResult)
      } else {
        // 没跑到调用那一步（Claude Code 不见了、Key 读不到）：提示原因并重读检测结果
        toast.error(errMessage(res))
        reload()
      }
    } finally {
      if (mounted.current) mark(setTesting, key, false)
    }
  }, [applyResult, reload])

  /**
   * 存 Key；成功后自动测一次这家的模型
   * @returns {Promise<{ok: boolean, message?: string}>} 失败时 message 留在弹层里
   */
  const saveKey = useCallback(async (providerId, key) => {
    const res = await api().modelsSetKey({ providerId, key })
    if (!res?.success) {
      const code = res?.error?.code
      return { ok: false, message: code === 'invalid_input' ? errMessage(res) : `保存失败：${errMessage(res)}` }
    }
    const { provider, commands } = res.data
    applyProvider(providerId, provider, commands)
    toast.success('Key 已保存')
    for (const m of provider.models) test(providerId, m.id)
    return { ok: true }
  }, [applyProvider, test])

  /**
   * 添加模型；成功后自动测一次
   * @returns {Promise<{ok: boolean, message?: string}>}
   */
  const addModel = useCallback(async (providerId, name) => {
    const res = await api().modelsAddModel({ providerId, name })
    if (!res?.success) {
      const code = res?.error?.code
      return { ok: false, message: code === 'invalid_input' || code === 'duplicate' ? errMessage(res) : `添加失败：${errMessage(res)}` }
    }
    const { provider, commands } = res.data
    applyProvider(providerId, provider, commands)
    toast.success(`已添加 ${name}`)
    const added = provider.models.find((m) => m.name === name)
    if (added) test(providerId, added.id)
    return { ok: true }
  }, [applyProvider, test])

  /**
   * 改模型名或参数；改名成功后自动测一次新名字
   * @param {string} providerId
   * @param {string} modelId
   * @param {object} patch - name / effort / contextTokens / maxOutputTokens
   * @param {(newId: string) => void} [onRenamed] - 改名换了 id 时调用，和数据更新同一批渲染（展开状态跟着走）
   * @returns {Promise<{ok: boolean, model?: object, message?: string, inline?: boolean}>}
   *   inline = 校验类失败，红字留在输入框下；其他失败已弹红 Toast
   */
  const updateModel = useCallback(async (providerId, modelId, patch, onRenamed) => {
    const res = await api().modelsUpdateModel({ providerId, modelId, patch })
    if (!res?.success) {
      const code = res?.error?.code
      if (code === 'invalid_input' || code === 'duplicate') return { ok: false, inline: true, message: errMessage(res) }
      toast.error(`保存失败：${errMessage(res)}`)
      return { ok: false }
    }
    const { model, commands } = res.data
    const renamed = model.id !== modelId
    setData((d) => {
      const prov = d?.providers?.[providerId]
      if (!prov) return d
      // 改名即换 id，旧名字的测试结果不再算数
      const models = prov.models.map((m) => (m.id === modelId ? { ...m, ...model, lastResult: renamed ? null : m.lastResult } : m))
      return { ...d, providers: { ...d.providers, [providerId]: { ...prov, models } }, commands: commands || d.commands }
    })
    if (renamed && onRenamed) onRenamed(model.id)
    toast.success('已保存')
    if ('name' in patch) test(providerId, model.id)
    return { ok: true, model }
  }, [test])

  const removeModel = useCallback(async (providerId, model) => {
    const ok = await confirmDialog({
      title: `移除 ${model.name}？`,
      description: '移除后审核和终端都不能再用它，Key 不受影响。',
      confirmText: '移除',
      danger: true,
    })
    if (!ok) return
    const key = `${providerId}__${model.id}`
    mark(setRemoving, key, true)
    try {
      const res = await api().modelsRemoveModel({ providerId, modelId: model.id })
      if (!mounted.current) return
      if (res?.success) {
        applyProvider(providerId, res.data.provider, res.data.commands)
        toast.success(`已移除 ${model.name}`)
      } else {
        toast.error(`移除失败：${errMessage(res)}`)
      }
    } finally {
      if (mounted.current) mark(setRemoving, key, false)
    }
  }, [applyProvider])

  const recheckClaude = useCallback(async () => {
    setRechecking(true)
    try {
      const res = await api().modelsRecheckClaude()
      if (mounted.current && res?.success) setData((d) => d && ({ ...d, claudeCode: res.data }))
    } finally {
      if (mounted.current) setRechecking(false)
    }
  }, [])

  const installCommands = useCallback(async () => {
    setInstalling(true)
    try {
      const res = await api().modelsInstallCommands()
      if (!mounted.current) return
      if (res?.success) {
        toast.success('已安装终端命令')
        await reload()
      } else {
        toast.error(errMessage(res))
      }
    } finally {
      if (mounted.current) setInstalling(false)
    }
  }, [reload])

  // 进页面读一次；窗口重新激活时重读（配置可能被命令行改过、Claude Code 可能刚装好）
  useEffect(() => {
    reload()
    const onFocus = () => { reload() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [reload])

  // 后台审核 / 终端写回结果：原地更新，不弹 Toast
  useEffect(() => {
    const unsubscribe = api().onModelsChanged((change) => {
      applyResult(change.providerId, change.modelId, change.lastResult)
    })
    return () => { if (typeof unsubscribe === 'function') unsubscribe() }
  }, [applyResult])

  return {
    data,
    loadFailed,
    testing,
    removing,
    installing,
    rechecking,
    reload,
    test,
    saveKey,
    addModel,
    updateModel,
    removeModel,
    recheckClaude,
    installCommands,
  }
}
