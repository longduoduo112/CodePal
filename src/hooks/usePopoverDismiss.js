/**
 * 锚定弹层的「点外面 / Esc 关闭」
 *
 * 负责：
 * - 捕获阶段监听，点外面先取消，再轮到失焦保存之类的逻辑
 * - 锚点（默认是弹层的父元素）算作里面，再点一次触发按钮能正常开合
 * - 订阅管理页的价格弹层、模型接入页的 Key / 添加弹层共用
 *
 * @module hooks/usePopoverDismiss
 */
import { useEffect, useRef } from 'react';

/**
 * @param {object} root - 弹层元素的 ref
 * @param {Function} onClose - 关闭回调
 * @param {object} [anchor] - 锚点元素的 ref；不传时用弹层的父元素
 * @returns {object} 关闭过一次后变成 true 的 ref
 */
export default function usePopoverDismiss(root, onClose, anchor) {
  const dismissed = useRef(false);
  useEffect(() => {
    const cancel = () => {
      if (dismissed.current) return;
      dismissed.current = true;
      onClose();
    };
    const outside = e => {
      if (!root.current) return;
      const anchorEl = anchor ? anchor.current : root.current.parentElement;
      if (root.current.contains(e.target) || (anchorEl && anchorEl.contains(e.target))) return;
      cancel();
    };
    const esc = e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', esc, true);
    };
  }, [root, onClose, anchor]);
  return dismissed;
}
