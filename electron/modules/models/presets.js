/**
 * 第三方模型接入 · 供应商预设
 *
 * 负责：
 * - 每家供应商的 Anthropic 兼容地址、认证环境变量、Key 前缀、默认模型与参数
 * - 已知模型的上限；用户新加的未知模型用这家的默认值
 *
 * 数值来源：DeepSeek 官方定价页（2026-09-26 取数：deepseek-flash 上下文 1M、输出 384K）；
 * 自动压缩窗口沿用 Nexus 实测值（Nexus internal/domain/claude_profile.go:65-67）。
 *
 * @module electron/modules/models/presets
 */

const DEEPSEEK_DEFAULTS = Object.freeze({
  effort: 'max',
  contextTokens: 1000000,
  maxOutputTokens: 384000,
  autoCompactWindow: 786432,
})

const PRESETS = Object.freeze({
  deepseek: Object.freeze({
    id: 'deepseek',
    name: 'DeepSeek',
    type: '按量',
    baseUrl: 'https://api.deepseek.com/anthropic',
    authEnv: 'ANTHROPIC_AUTH_TOKEN',
    keyPrefix: 'sk-',
    defaultModel: 'deepseek-flash',
    defaults: DEEPSEEK_DEFAULTS,
    models: Object.freeze({
      'deepseek-flash': DEEPSEEK_DEFAULTS,
      'deepseek-v4-pro': DEEPSEEK_DEFAULTS,
    }),
  }),
})

/** 思考强度可选值（照 Claude Code 原值，不翻译） */
const EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max'])

/**
 * 取某个模型的默认参数：预设里有就用它自己的，没有用这家的默认
 * @param {object} preset - PRESETS 里的一家
 * @param {string} name - 模型名
 * @returns {{effort: string, contextTokens: number, maxOutputTokens: number, autoCompactWindow: number}}
 */
function modelDefaults(preset, name) {
  const known = Object.keys(preset.models).find((k) => k.toLowerCase() === String(name).toLowerCase())
  return { ...(known ? preset.models[known] : preset.defaults) }
}

module.exports = { PRESETS, EFFORTS, modelDefaults }
