'use strict'

const fs = require('fs')
const path = require('path')

const SAVE_FILE_PATTERNS = [
  /\.save$/i,
  /\.bak$/i,
  /^persistent$/i,
  /^auto-/i,
  /^quick-/i,
]

const getDefaultRenpySaveRoot = () => {
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'RenPy')
  }
  return null
}

const isPathInside = (candidate, root) => {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

const inferRenpyTitle = (saveId) => {
  let title = String(saveId || '').trim()
  title = title
    .replace(/[_./]+/g, ' ')
    .replace(/\s*[-]+\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  title = title
    .replace(/\s+[a-f0-9]{12,}$/i, '')
    .replace(/\s+\d{9,}$/i, '')
    .replace(/\s+v?\d+(?:\.\d+){1,4}$/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  return title || String(saveId || 'Unknown').trim() || 'Unknown'
}

const isSaveLikeFile = (name) => SAVE_FILE_PATTERNS.some((pattern) => pattern.test(name))

const inspectSaveFolder = async (savePath) => {
  let saveCount = 0
  let latestSaveMtime = 0
  const entries = await fs.promises.readdir(savePath, { withFileTypes: true }).catch(() => [])

  for (const entry of entries) {
    if (!entry.isFile() && !entry.isDirectory()) continue
    if (!isSaveLikeFile(entry.name)) continue
    saveCount += 1
    const stat = await fs.promises.stat(path.join(savePath, entry.name)).catch(() => null)
    if (stat) latestSaveMtime = Math.max(latestSaveMtime, Math.floor(stat.mtimeMs))
  }

  return { saveCount, latestSaveMtime }
}

const scanRenpySaveFolders = async (rootPath) => {
  const root = path.resolve(String(rootPath || ''))
  const rootStat = await fs.promises.stat(root).catch(() => null)
  if (!rootStat || !rootStat.isDirectory()) {
    throw new Error("Ren'Py save folder was not found. Select it manually.")
  }

  const entries = await fs.promises.readdir(root, { withFileTypes: true })
  const rows = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const savePath = path.join(root, entry.name)
    if (!isPathInside(savePath, root)) continue
    const details = await inspectSaveFolder(savePath)
    rows.push({
      sourceType: 'renpySave',
      saveId: entry.name,
      savePath,
      folder: savePath,
      inferredTitle: inferRenpyTitle(entry.name),
      saveCount: details.saveCount,
      latestSaveMtime: details.latestSaveMtime,
    })
  }
  return rows
}

module.exports = {
  getDefaultRenpySaveRoot,
  inferRenpyTitle,
  scanRenpySaveFolders,
}
