/**
 * 模型接入页 · 添加模型弹层
 *
 * 负责：
 * - 锚在「＋ 添加模型」下的提交类弹层：模型名输入 + 取消 / 添加
 * - 边输边校验：重名、和供应商同名、非法字符时红边 + 红字，「添加」禁用；空值只禁用不出红字
 * - 回车 = 添加；Esc、点外面 = 取消
 *
 * @module features/models/AddModelPopover
 */

import { useRef, useState } from 'react'
import Button from '../../components/Button/Button'
import usePopoverDismiss from '../../hooks/usePopoverDismiss'
import { modelNameError } from './modelsView'

/**
 * @param {Object} props
 * @param {string[]} props.names - 这家已有的模型名
 * @param {object} props.anchorRef - 「＋ 添加模型」按钮的 ref
 * @param {() => void} props.onCancel
 * @param {(name: string) => Promise<{ok: boolean, message?: string}>} props.onAdd
 * @returns {JSX.Element}
 */
export default function AddModelPopover({ names, anchorRef, onCancel, onAdd }) {
  const [value, setValue] = useState('')
  // 主进程拒绝时的原因（校验以主进程为准）
  const [serverError, setServerError] = useState(null)
  const [saving, setSaving] = useState(false)
  const root = useRef(null)
  usePopoverDismiss(root, onCancel, anchorRef)

  const name = value.trim()
  const error = name ? (modelNameError(name, names) || serverError) : null

  const submit = async () => {
    if (!name || error || saving) return
    setSaving(true)
    const res = await onAdd(name)
    if (!res.ok) {
      setServerError(res.message)
      setSaving(false)
    }
  }

  return (
    <div ref={root} className="np-pop np-pop--arrow mj-pop mj-pop-l" role="dialog" aria-label="添加模型">
      <div className="np-pop-title">添加模型</div>
      <span className="np-in np-in--text">
        <input
          aria-label="模型名"
          placeholder="模型名，例如 deepseek-v4-pro"
          autoFocus
          value={value}
          disabled={saving}
          aria-invalid={Boolean(error)}
          onChange={(e) => { setValue(e.target.value); setServerError(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        />
      </span>
      {error && <div className="np-pop-hint bad">{error}</div>}
      <div className="mj-pop-ft">
        <Button size="sm" className="np-btn" disabled={saving} onClick={onCancel}>取消</Button>
        <Button size="sm" className="np-btn" variant="primary" disabled={saving || !name || Boolean(error)} onClick={submit}>添加</Button>
      </div>
    </div>
  )
}
