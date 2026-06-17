'use strict'

const fs = require('fs')
const path = require('path')

async function calculatePathSize(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') {
    return { sizeBytes: null, missing: true, errors: [] }
  }

  const rootPath = path.resolve(targetPath)
  const errors = []

  const sizeEntry = async (entryPath) => {
    let stat
    try {
      stat = await fs.promises.lstat(entryPath)
    } catch (err) {
      if (err.code === 'ENOENT') return { sizeBytes: 0, missing: true }
      errors.push(`${entryPath}: ${err.message}`)
      return { sizeBytes: 0, missing: false }
    }

    if (stat.isSymbolicLink()) return { sizeBytes: 0, missing: false }
    if (stat.isFile()) return { sizeBytes: stat.size, missing: false }
    if (!stat.isDirectory()) return { sizeBytes: 0, missing: false }

    let entries
    try {
      entries = await fs.promises.readdir(entryPath, { withFileTypes: true })
    } catch (err) {
      errors.push(`${entryPath}: ${err.message}`)
      return { sizeBytes: 0, missing: false }
    }

    let total = 0
    for (const entry of entries) {
      const childPath = path.join(entryPath, entry.name)
      if (entry.isSymbolicLink()) continue
      const child = await sizeEntry(childPath)
      total += child.sizeBytes || 0
    }
    return { sizeBytes: total, missing: false }
  }

  const result = await sizeEntry(rootPath)
  return {
    sizeBytes: result.missing ? null : result.sizeBytes,
    missing: result.missing,
    errors,
  }
}

function formatBytes(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value < 0) return 'Unknown'
  const gb = value / (1024 * 1024 * 1024)
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 1 : 2)} GB`
  const mb = value / (1024 * 1024)
  return `${mb.toFixed(1)} MB`
}

module.exports = {
  calculatePathSize,
  formatBytes,
}
