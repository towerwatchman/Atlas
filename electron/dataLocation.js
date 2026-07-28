'use strict'

// ── Where Atlas keeps its data ───────────────────────────────────────────────
//
// Data ALWAYS lives beside the executable, in <installDir>/data. There is no
// AppData fallback: silently relocating to %APPDATA%\Atlas is what made the
// cache failures so hard to pin down, because the app would run from one root
// on one boot and a different root on the next with nothing saying so.
//
// A Program Files install is not user-writable by default, so the installer
// elevates once and grants the Users group modify rights on <installDir>/data
// (see build/installer.nsh). The app itself then runs unelevated. If that grant
// is missing — a manual copy, a hand-dropped portable.txt, a folder the
// installer never touched — we can repair it by relaunching elevated ONCE
// rather than running the whole app as administrator forever. That matters
// because Atlas spawns game executables, and a child process inherits its
// parent's elevation.

const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const { execFile } = require('child_process')

// Well-known SID for the local Users group. Used instead of the name because
// that group is localised ("Utilisateurs", "Benutzer", ...) and a name-based
// icacls grant fails on non-English Windows.
const USERS_GROUP_SID = '*S-1-5-32-545'

const PROBE_FILENAME = '.atlas-write-probe'

/**
 * Is `dir` writable by this process?
 *
 * Deliberately tolerant about cleanup. The previous version treated a failed
 * unlink as "not writable", but antivirus routinely holds a freshly created
 * file open for scanning, so the delete throws EPERM/EBUSY on a directory we
 * had just successfully written to. That produced an intermittent, machine-
 * dependent demotion to AppData. Only the WRITE decides.
 */
function probeWritable(dir) {
  const probe = path.join(dir, PROBE_FILENAME)
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch (err) {
    return { writable: false, error: `Cannot create ${dir}: ${err.message}` }
  }
  try {
    // Fixed filename, truncating write: a leftover probe from a previous crash
    // is overwritten rather than colliding.
    fs.writeFileSync(probe, String(Date.now()))
  } catch (err) {
    return { writable: false, error: `Cannot write to ${dir}: ${err.message}` }
  }
  // Best effort only — see above.
  try { fs.unlinkSync(probe) } catch { /* ignore */ }
  return { writable: true, error: null }
}

/**
 * Resolve the data root. Returns diagnostics alongside the path so startup can
 * report exactly what happened instead of failing opaquely.
 */
function resolveDataRoot({ installDir, isDev }) {
  if (isDev) {
    return { root: installDir, writable: true, error: null, isDev: true }
  }
  const dataDir = path.join(installDir, 'data')
  const { writable, error } = probeWritable(dataDir)
  return { root: installDir, dataDir, writable, error, isDev: false }
}

/**
 * Grant the Users group modify rights on `dir`, recursively, via icacls.
 * Requires the current process to be elevated; resolves false otherwise.
 *
 * Scoped to the data folder alone. Granting write access inside Program Files
 * is a real if modest trade-off — it is why this must never be applied to the
 * install root, which holds the executables.
 */
function grantUsersModify(dir) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve({ ok: true, skipped: true })
    try {
      fs.mkdirSync(dir, { recursive: true })
    } catch (err) {
      return resolve({ ok: false, error: err.message })
    }
    // (OI)(CI) => inherited by files and subfolders; M => modify.
    execFile(
      'icacls',
      [dir, '/grant', `${USERS_GROUP_SID}:(OI)(CI)M`, '/T', '/C', '/Q'],
      { windowsHide: true },
      (err, stdout, stderr) => {
        if (err) return resolve({ ok: false, error: stderr || err.message })
        resolve({ ok: true })
      },
    )
  })
}

function isElevated() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(false)
    // `net session` fails for non-elevated tokens. Cheap and dependency-free.
    execFile('net', ['session'], { windowsHide: true }, (err) => resolve(!err))
  })
}

// ── Legacy AppData migration ────────────────────────────────────────────────

/**
 * Candidate legacy roots: the Electron default userData folder, which is where
 * the old AppData fallback put everything.
 */
function getLegacyDataDirs(app) {
  const candidates = []
  try {
    // app.setPath('userData', ...) may already have run, so derive the OS
    // default from appData + the product name rather than reading userData.
    const appData = app.getPath('appData')
    if (appData) candidates.push(path.join(appData, 'Atlas', 'data'))
  } catch { /* ignore */ }
  return candidates.filter((dir) => {
    try {
      return fs.existsSync(dir) && fs.statSync(dir).isDirectory()
    } catch {
      return false
    }
  })
}

async function directorySize(dir) {
  let total = 0
  let files = 0
  const walk = async (current) => {
    let entries = []
    try {
      entries = await fsp.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else {
        try {
          const stat = await fsp.stat(full)
          total += stat.size
          files += 1
        } catch { /* ignore */ }
      }
    }
  }
  await walk(dir)
  return { bytes: total, files }
}

/**
 * Copy `from` into `to`, then verify, then delete the source — in that order,
 * per the requirement. A partial copy leaves the original untouched, so an
 * interrupted migration is recoverable by simply running it again.
 *
 * Verification compares file count and total bytes rather than hashing: this
 * can reach many GB of artwork, and a full rehash would take far longer than
 * the copy itself.
 */
async function migrateLegacyData(fromDir, toDir, { onProgress } = {}) {
  const before = await directorySize(fromDir)
  if (before.files === 0) {
    return { success: false, error: 'Nothing to migrate' }
  }

  let copied = 0
  const copyTree = async (src, dest) => {
    await fsp.mkdir(dest, { recursive: true })
    const entries = await fsp.readdir(src, { withFileTypes: true })
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name)
      const destPath = path.join(dest, entry.name)
      if (entry.isDirectory()) {
        await copyTree(srcPath, destPath)
        continue
      }
      if (!entry.isFile()) continue // skip sockets/symlinks
      // Never clobber data already in the destination: an existing install's
      // own files win over the legacy copy.
      try {
        await fsp.access(destPath)
        copied += 1
        continue
      } catch { /* destination absent, proceed */ }
      await fsp.copyFile(srcPath, destPath)
      copied += 1
      if (copied % 50 === 0) onProgress?.({ copied, total: before.files })
    }
  }

  try {
    await copyTree(fromDir, toDir)
  } catch (err) {
    return { success: false, error: `Copy failed: ${err.message}`, sourceKept: true }
  }

  // Verify before deleting anything.
  const after = await directorySize(toDir)
  if (after.files < before.files) {
    return {
      success: false,
      error: `Verification failed: expected at least ${before.files} files, found ${after.files}`,
      sourceKept: true,
    }
  }

  try {
    await fsp.rm(fromDir, { recursive: true, force: true })
  } catch (err) {
    // The copy is verified, so this is not a data-loss failure — just clutter.
    return {
      success: true,
      files: before.files,
      bytes: before.bytes,
      sourceKept: true,
      warning: `Copied successfully but could not remove the old folder: ${err.message}`,
    }
  }

  return { success: true, files: before.files, bytes: before.bytes, sourceKept: false }
}

module.exports = {
  PROBE_FILENAME,
  USERS_GROUP_SID,
  probeWritable,
  resolveDataRoot,
  grantUsersModify,
  isElevated,
  getLegacyDataDirs,
  directorySize,
  migrateLegacyData,
}
