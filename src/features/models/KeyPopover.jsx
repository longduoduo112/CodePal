/**
 * 模型接入页 · Key 弹层
 *
 * 负责：
 * - 锚在卡头按钮下的提交类弹层：密码输入框（空，不回显旧 Key）+ 取消 / 保存
 * - 前缀不对：红边 + 红字，不调接口；保存失败：弹层不关，红字留在弹层里，「保存」就是重试
 * - 回车 = 保存；Esc、点外面 = 取消
 *
 * @module features/models/KeyPopover
 */

import { useRef, useState } from 'react'
import Button from '../../components/Button/Button'
import usePopoverDismiss from '../../hooks/usePopoverDismiss'

/**
 * @param {Object} props
 * @param {{id: string, name: string, keyPrefix: string}} props.preset - 这家的显示信息
 * @param {object} props.anchorRef - 卡头按钮的 ref（点它不算点外面）
 * @param {() => void} props.onCancel
 * @param {(key: string) => Promise<{ok: boolean, message?: string}>} props.onSave
 * @returns {JSX.Element}
 */
export default function KeyPopover({ preset, anchorRef, onCancel, onSave }) {
  const [value, setValue] = useState('')
  // 前缀不对（提交时判定，改对了随输入消失）或保存失败的红字
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const root = useRef(null)
  usePopoverDismiss(root, onCancel, anchorRef)

  const keyLabel = preset.id === 'deepseek' ? 'DeepSeek API Key' : `${preset.name} Key`
  const prefixError = `${preset.name} 的 Key 以 ${preset.keyPrefix} 开头`
  const key = value.trim()
  const formatError = 'Key 格式不对'
  const invalid = error === prefixError || error === formatError

  const submit = async () => {
    if (!key || saving) return
    if (/\p{Cc}/u.test(value)) {
      setError(formatError)
      return
    }
    if (!key.startsWith(preset.keyPrefix) || key.length <= preset.keyPrefix.length) {
      setError(prefixError)
      return
    }
    setSaving(true)
    const res = await onSave(key)
    if (!res.ok) {
      setError(res.message)
      setSaving(false)
    }
  }

  const onChange = (e) => {
    setValue(e.target.value)
    // 前缀红字只在改对之后消失；保存失败的红字留着，直到再次保存
    const next = e.target.value.trim()
    if (invalid && !/\p{Cc}/u.test(e.target.value) && next.startsWith(preset.keyPrefix) && next.length > preset.keyPrefix.length) setError(null)
  }

  return (
    <div ref={root} className="np-pop np-pop--arrow mj-pop mj-pop-r" role="dialog" aria-label={keyLabel}>
      <div className="np-pop-title">{keyLabel}</div>
      <span className="np-in np-in--text">
        <input
          type="password"
          aria-label={keyLabel}
          placeholder="粘贴 Key"
          autoFocus
          value={value}
          disabled={saving}
          aria-invalid={invalid}
          onChange={onChange}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        />
      </span>
      {error && <div className="np-pop-hint bad">{error}</div>}
      <div className="mj-pop-ft">
        <Button size="sm" className="np-btn" disabled={saving} onClick={onCancel}>取消</Button>
        <Button size="sm" className="np-btn" variant="primary" disabled={saving || !key || invalid} onClick={submit}>
          {saving ? '保存中…' : '保存'}
        </Button>
      </div>
    </div>
  )
}
