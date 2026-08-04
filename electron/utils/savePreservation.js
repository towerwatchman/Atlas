'use strict'

const fs = require('fs')
const fsp = fs.promises
const path = require('path')

const SAVE_FOLDER_NAMES = ['save', 'saves', 'savedata']
const SAVE_FILE_EXTENSIONS = ['.rpgsave', '.rvdata2', '.rvdata', '.rxdata', '.dat', '.sav', '.save']
const SAVE_FILE_NAME_REGEX = /^(save\d*|system|config|global|common|game\.sav)/i

async function pathExists(targetPath) {
  try {
    await fsp.access(targetPath)
    return true
  } catch {
    return false
  }
}

/**
 * Scans a game folder for potential save directories and files.
 * Returns an array of relative paths found within gamePath.
 */
async function detectSaveArtifacts(gamePath) {
  if (!gamePath || typeof gamePath !== 'string') return []
  const resolvedBase = path.resolve(gamePath)
  if (!(await pathExists(resolvedBase))) return []

  const detected = new Set()

  async function scanDirectory(currentDir, relativePrefix = '') {
    let entries = []
    try {
      entries = await fsp.readdir(currentDir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const relPath = relativePrefix ? path.join(relativePrefix, entry.name) : entry.name
      const lowerName = entry.name.toLowerCase()

      if (entry.isDirectory()) {
        // If directory is a save folder (e.g. "save", "www/save", "SaveData")
        if (SAVE_FOLDER_NAMES.includes(lowerName)) {
          detected.add(relPath)
          // Also include all files inside the save directory recursively
          await scanSaveSubfolder(path.join(currentDir, entry.name), relPath)
        } else if (lowerName === 'www' && !relativePrefix) {
          // Check inside www/ for save folders
          await scanDirectory(path.join(currentDir, entry.name), relPath)
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        const isSaveExt = SAVE_FILE_EXTENSIONS.includes(ext)
        const isSaveName = SAVE_FILE_NAME_REGEX.test(entry.name)

        if (isSaveExt || isSaveName) {
          detected.add(relPath)
        }
      }
    }
  }

  async function scanSaveSubfolder(subDir, relativePrefix) {
    let entries = []
    try {
      entries = await fsp.readdir(subDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const relPath = path.join(relativePrefix, entry.name)
      if (entry.isDirectory()) {
        detected.add(relPath)
        await scanSaveSubfolder(path.join(subDir, entry.name), relPath)
      } else if (entry.isFile()) {
        detected.add(relPath)
      }
    }
  }

  await scanDirectory(resolvedBase)
  return Array.from(detected).sort()
}

/**
 * Copies detected save files to a persistent AppData folder AND a staging folder.
 */
async function backupSaveArtifacts({ oldGamePath, recordId, appDataDir }) {
  if (!oldGamePath || !(await pathExists(oldGamePath))) {
    return { success: false, artifacts: [], backupDir: null }
  }

  const resolvedOldPath = path.resolve(oldGamePath)
  const artifacts = await detectSaveArtifacts(resolvedOldPath)

  if (artifacts.length === 0) {
    return { success: true, artifacts: [], backupDir: null }
  }

  const timestamp = Date.now()
  const safeRecordId = String(recordId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_')
  const backupDir = path.join(
    appDataDir || process.cwd(),
    'save-backups',
    safeRecordId,
    String(timestamp)
  )

  await fsp.mkdir(backupDir, { recursive: true })

  const copiedArtifacts = []

  for (const relPath of artifacts) {
    const srcPath = path.join(resolvedOldPath, relPath)
    const destPath = path.join(backupDir, relPath)

    try {
      const stat = await fsp.stat(srcPath)
      if (stat.isDirectory()) {
        await fsp.mkdir(destPath, { recursive: true })
        copiedArtifacts.push({ relPath, isDir: true })
      } else if (stat.isFile()) {
        await fsp.mkdir(path.dirname(destPath), { recursive: true })
        await fsp.copyFile(srcPath, destPath)
        copiedArtifacts.push({ relPath, isDir: false })
      }
    } catch (err) {
      console.warn(`[savePreservation] Failed to backup save file ${relPath}:`, err.message)
    }
  }

  return {
    success: true,
    artifacts: copiedArtifacts,
    backupDir,
    timestamp,
  }
}

/**
 * Restores save files from backupDir into newGamePath.
 * Handles layout adaptation (e.g. www/save -> save if www/ does not exist in newGamePath).
 */
async function restoreSaveArtifacts({ backupManifest, newGamePath }) {
  if (!backupManifest || !backupManifest.backupDir || !newGamePath) {
    return { restored: false, count: 0 }
  }

  const backupDir = backupManifest.backupDir
  if (!(await pathExists(backupDir)) || !(await pathExists(newGamePath))) {
    return { restored: false, count: 0 }
  }

  const resolvedNewPath = path.resolve(newGamePath)
  const hasWwwDir = await pathExists(path.join(resolvedNewPath, 'www'))

  let restoredCount = 0

  for (const item of backupManifest.artifacts || []) {
    const relPath = item.relPath
    let targetRelPath = relPath

    // If original save was in www/save/ but new version does not have www/ subfolder
    if (!hasWwwDir && (relPath.startsWith('www\\') || relPath.startsWith('www/'))) {
      targetRelPath = relPath.replace(/^www[/\\]/, '')
    }

    const srcPath = path.join(backupDir, relPath)
    const destPath = path.join(resolvedNewPath, targetRelPath)

    try {
      if (item.isDir) {
        await fsp.mkdir(destPath, { recursive: true })
      } else {
        await fsp.mkdir(path.dirname(destPath), { recursive: true })
        await fsp.copyFile(srcPath, destPath)
        restoredCount += 1
      }
    } catch (err) {
      console.warn(`[savePreservation] Failed to restore save file ${relPath}:`, err.message)
    }
  }

  return { restored: true, count: restoredCount }
}

module.exports = {
  detectSaveArtifacts,
  backupSaveArtifacts,
  restoreSaveArtifacts,
}
