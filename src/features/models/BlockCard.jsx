/**
 * 模型接入页 · 被挡住卡
 *
 * 负责：
 * - 页面最上面一张普通灰底卡，一个外部条件一行：没找到 Claude Code / 版本太旧（F1）、终端命令未安装（F3）
 * - 每行：名称（可带一句说明）+ 橙点 + 按钮；主按钮由页面按「填写 Key > 重新检测 > 安装命令」决定
 *
 * @module features/models/BlockCard
 */

import Button from '../../components/Button/Button'

/**
 * @param {Object} props
 * @param {{title: string, desc: string|null, status: string}|null} props.claude - Claude Code 那一行；null 不显示
 * @param {boolean} props.showInstall - 显示「终端命令未安装」
 * @param {'key'|'recheck'|'install'|null} props.primary - 这一屏的主按钮
 * @param {boolean} props.rechecking
 * @param {boolean} props.installing
 * @param {() => void} props.onRecheck
 * @param {() => void} props.onInstall
 * @returns {JSX.Element|null}
 */
export default function BlockCard({ claude, showInstall, primary, rechecking, installing, onRecheck, onInstall }) {
  if (!claude && !showInstall) return null
  return (
    <section className="np-card mj-block">
      {claude && (
        <div className="np-hstack mj-bline">
          <div className="lf">
            <div className="mj-bt">{claude.title}</div>
            {claude.desc && <div className="mj-bdesc">{claude.desc}</div>}
          </div>
          <span className="np-st warn push"><i />{claude.status}</span>
          <Button size="sm" className="np-btn" variant={primary === 'recheck' ? 'primary' : 'secondary'} disabled={rechecking} onClick={onRecheck}>
            重新检测
          </Button>
        </div>
      )}
      {showInstall && (
        <div className="np-hstack mj-bline">
          <div className="lf"><div className="mj-bt">终端命令未安装</div></div>
          <span className="np-st warn push"><i />未安装</span>
          <Button size="sm" className="np-btn" variant={primary === 'install' && !installing ? 'primary' : 'secondary'} disabled={installing} onClick={onInstall}>
            {installing ? '安装中…' : '安装命令'}
          </Button>
        </div>
      )}
    </section>
  )
}
