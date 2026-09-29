/**
 * Skill 控制中心 IPC 注册器
 *
 * IPC 只做参数收敛、服务调用与稳定错误返回；每次写操作完成后重新读取原生状态。
 * 读快照前先补关 Codex 旧写法（只在有需要补关的条目时才写，失败自己恢复备份，不影响读快照）。
 * 写操作失败时也尽量带回一份新快照，让页面按实际状态显示。
 *
 * @module electron/handlers/registerSkillControlHandlers
 */

const { getSkillControlSnapshot, executeSkillCommand } = require('../services/skillControlService')
const { migrateLegacyCodexDisables } = require('../services/skillAdapters/codexSkillAdapter')

function errorCode(error, fallback) {
  return error?.code || error?.message || fallback
}

function registerSkillControlHandlers({ ipcMain, homeDir }, deps = {}) {
  const getSnapshot = deps.getSkillControlSnapshotFn || getSkillControlSnapshot
  const execute = deps.executeSkillCommandFn || executeSkillCommand
  const migrate = deps.migrateLegacyCodexDisablesFn || migrateLegacyCodexDisables

  ipcMain.handle('skill-control:get-snapshot', async (_event, params) => {
    // 补关失败不挡读快照：它自己恢复了备份，下次打开再试
    await migrate({ homeDir }, deps).catch(() => null)
    try {
      const data = await getSnapshot({
        repoPath: params?.repoPath,
        projectRoots: Array.isArray(params?.projectRoots) ? params.projectRoots : [],
        homeDir,
      }, deps)
      return { success: true, data, error: null }
    } catch (error) {
      return { success: false, data: null, error: errorCode(error, 'SKILL_CONTROL_SCAN_FAILED') }
    }
  })

  ipcMain.handle('skill-control:execute', async (_event, params) => {
    try {
      const data = await execute({ ...params, homeDir }, deps)
      const snapshot = await getSnapshot({
        repoPath: params?.repoPath,
        projectRoots: Array.isArray(params?.projectRoots) ? params.projectRoots : [],
        homeDir,
      }, deps)
      return { success: true, data, snapshot, error: null }
    } catch (error) {
      // 失败后重读一次：状态不确定时页面要按实际显示；重读也失败就不带快照
      const snapshot = await getSnapshot({
        repoPath: params?.repoPath,
        projectRoots: Array.isArray(params?.projectRoots) ? params.projectRoots : [],
        homeDir,
      }, deps).catch(() => null)
      return { success: false, data: null, snapshot, error: errorCode(error, 'SKILL_CONTROL_COMMAND_FAILED') }
    }
  })

  ipcMain.handle('skill-control:adopt', async (_event, params) => {
    try {
      const data = await execute({ ...params, action: 'adopt', source: params?.source || { origin: 'user', mutable: true }, homeDir }, deps)
      return { success: true, data, error: null }
    } catch (error) {
      return { success: false, data: null, error: errorCode(error, 'SKILL_CONTROL_ADOPT_FAILED') }
    }
  })
}

module.exports = { registerSkillControlHandlers }
