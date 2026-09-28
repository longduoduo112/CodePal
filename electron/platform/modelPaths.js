/**
 * Trusted CodePal model paths shared by storage and read-only consumers.
 * - Resolve directories without loading model configuration or credentials.
 * @module platform/modelPaths
 */
const path = require('node:path')
// The standalone model CLI must remain self-contained outside Electron's asar archive.
// Reuse its pure resolver; importing the store performs no configuration or credential reads.
const { resolveModelsHome } = require('../modules/models/store')

/** @param {object} options Trusted home/environment overrides. @returns {string} Isolated Claude projects root. */
function backgroundProjectsDir(options) {
  return path.join(resolveModelsHome(options), 'claude-home', 'projects')
}

module.exports = { resolveModelsHome, backgroundProjectsDir }
