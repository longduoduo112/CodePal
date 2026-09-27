#!/usr/bin/env node
/**
 * 采样器自检用：带着命令行里的标记参数存活 5 秒后退出（TC-S02 第 1 步）
 *
 * 用法：node argv-marker.mjs <标记>
 *
 * @module tests/models/fixtures/argv-marker
 */
setTimeout(() => process.exit(0), 5000)
