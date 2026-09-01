'use strict'

const { dialog } = require('electron')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

// ── Deletion safety model ────────────────────────────────────────────────────
//
// Two invariants, both learned the hard way from a user who lost an entire
// archive drive to a single import:
//
//   1. CONTAINMENT. Every delete must name a containment root, and the target
//      must be STRICTLY inside it. "Strictly" is the whole point: path.relative
//      returns "" for a path compared against itself, so an isPathInside() that
//      accepts "" happily authorises deleting the library root itself. A caller
//      that genuinely has no root has to say so out loud via
//      allowUnconfinedDelete; there is no silent default.
//
//   2. NOTHING IS DESTROYED BEFORE CONSENT. The previous implementation ran
//      fs.rm(recursive, force) FIRST and showed the "administrator approval
//      required" dialog in the catch block. Node's recursive rm walks children
//      in parallel and only rejects for the entries it could not remove, so by
//      the time that dialog appeared the tree was already gone and "Skip"
//      protected nothing. Now the target is first RENAMED to a sibling staging
//      path -- atomic, instant, and non-destructive. A lock or a permission
//      problem fails the rename with nothing lost, and only then do we ask.
//      Recursive removal happens after staging, so a partial failure leaves
//      remnants in the staging folder we can report instead of a hole.

const STAGING_PREFIX = '.__atlas_trash__'

function normalizeForCompare(targetPath) {
  return path.resolve(targetPath).toLowerCase()
}

// Accepts the parent itself. Kept for callers that mean "at or below".
function isPathInside(parentPath, childPath) {
  const relative = path.relative(normalizeForCompare(parentPath), normalizeForCompare(childPath))
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

// Rejects the parent itself. This is the one deletion is allowed to use.
function isStrictlyInside(parentPath, childPath) {
  const relative = path.relative(normalizeForCompare(parentPath), normalizeForCompare(childPath))
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative)
}

// A drive root (C:\, /) or a bare UNC share root (\\server\share). Neither is
// ever a legitimate delete target, whatever the database says.
function isFilesystemRoot(resolvedPath) {
  if (resolvedPath === path.parse(resolvedPath).root) return true
  if (/^\\\\[^\\/]+[\\/][^\\/]+[\\/]?$/.test(resolvedPath)) return true
  return false
}

function assertDeletionContainment(resolvedPath, containmentRoots) {
  const roots = (Array.isArray(containmentRoots) ? containmentRoots : [containmentRoots])
    .filter((root) => typeof root === 'string' && root.trim() !== '')

  if (roots.length === 0) {
    throw new Error(`Refusing to delete ${resolvedPath}: no containment root was supplied`)
  }

  for (const root of roots) {
    const resolvedRoot = path.resolve(root)
    if (normalizeForCompare(resolvedPath) === normalizeForCompare(resolvedRoot)) {
      throw new Error(`Refusing to delete the containment root itself: ${resolvedPath}`)
    }
    if (isStrictlyInside(resolvedRoot, resolvedPath)) return resolvedRoot
  }

  throw new Error(
    `Refusing to delete ${resolvedPath}: outside every allowed root (${roots.map((r) => path.resolve(r)).join(', ')})`
  )
}

function isPermissionDeleteError(err) {
  const code = String(err?.code || '').toUpperCase()
  const message = String(err?.message || '').toLowerCase()
  return (
    code === 'EPERM' ||
    code === 'EACCES' ||
    (process.platform === 'win32' && code === 'EBUSY') ||
    message.includes('access is denied') ||
    message.includes('permission denied') ||
    message.includes('operation not permitted')
  )
}

function encodePowerShell(command) {
  return Buffer.from(command, 'utf16le').toString('base64')
}

function encodeUtf8(value) {
  return Buffer.from(String(value), 'utf8').toString('base64')
}

async function pathExists(targetPath) {
  return fs.promises.access(targetPath).then(() => true).catch(() => false)
}

function buildStagingPath(resolvedPath) {
  const parent = path.dirname(resolvedPath)
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  return path.join(parent, `${STAGING_PREFIX}${path.basename(resolvedPath)}.${suffix}`)
}

// Move the target aside before removing it. Returns { staged, stagedPath } on
// success, or { staged: false, error } with the target completely untouched.
async function stagePathForDeletion(resolvedPath) {
  const stagedPath = buildStagingPath(resolvedPath)
  try {
    await fs.promises.rename(resolvedPath, stagedPath)
    return { staged: true, stagedPath }
  } catch (err) {
    if (err?.code === 'ENOENT') return { staged: true, stagedPath: null, missing: true }
    return { staged: false, error: err }
  }
}

async function askForElevatedDelete({ targetPath, description, window }) {
  const ownerWindow = window && !window.isDestroyed?.() ? window : undefined
  const result = await dialog.showMessageBox(ownerWindow, {
    type: 'warning',
    buttons: ['Retry as administrator', 'Skip'],
    defaultId: 1,
    cancelId: 1,
    title: 'Administrator approval required',
    message: 'Atlas could not delete this file or folder because Windows denied permission.',
    detail:
      `${description || 'Delete item'}\n\n${targetPath}\n\n` +
      'Nothing has been deleted yet. You can retry once with administrator approval, ' +
      'or skip and leave this item exactly as it is.',
    noLink: true,
  })
  return result.response === 0
}

// Elevated path mirrors the staged strategy: Move-Item first so a failure to
// remove cannot leave a half-deleted tree at the original location.
function runElevatedWindowsDelete(targetPath, { recursive = true, force = true } = {}) {
  return new Promise((resolve) => {
    const targetBase64 = encodeUtf8(targetPath)
    const stagedBase64 = encodeUtf8(buildStagingPath(path.resolve(targetPath)))
    const innerCommand = [
      `$target = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${targetBase64}'))`,
      `$staged = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${stagedBase64}'))`,
      `$recurse = ${recursive ? '$true' : '$false'}`,
      `$force = ${force ? '$true' : '$false'}`,
      '$doomed = $target',
      'try { Move-Item -LiteralPath $target -Destination $staged -Force -ErrorAction Stop; $doomed = $staged } catch { $doomed = $target }',
      '$params = @{ LiteralPath = $doomed; ErrorAction = "Stop" }',
      'if ($recurse) { $params.Recurse = $true }',
      'if ($force) { $params.Force = $true }',
      'Remove-Item @params',
    ].join('; ')
    const innerEncoded = encodePowerShell(innerCommand)
    const outerCommand = [
      '$ErrorActionPreference = "Stop"',
      `$argsList = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', '${innerEncoded}')`,
      'Start-Process -FilePath "powershell.exe" -ArgumentList $argsList -Verb RunAs -WindowStyle Hidden -Wait',
    ].join('; ')
    const outerEncoded = encodePowerShell(outerCommand)
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand', outerEncoded],
      { windowsHide: true },
    )

    let stderr = ''
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', (err) => resolve({ success: false, error: err.message }))
    child.on('close', (code) => {
      if (code === 0) resolve({ success: true })
      else resolve({ success: false, canceled: true, error: stderr.trim() || `Elevated delete exited with code ${code}` })
    })
  })
}

/**
 * Delete a file or directory.
 *
 * @param {string} targetPath
 * @param {object} options
 * @param {string|string[]} options.containmentRoot  REQUIRED unless
 *   allowUnconfinedDelete is true. targetPath must be strictly below one of these.
 * @param {boolean} [options.allowUnconfinedDelete=false]  Explicit opt-out.
 * @param {(p: string) => any} [options.validatePath]  Extra caller-side check,
 *   run before anything is touched and again before any elevated retry.
 */
async function deletePathWithElevationFallback(targetPath, options = {}) {
  const {
    recursive = true,
    force = true,
    description = 'Delete item',
    window,
    allowElevatedRetry = true,
    validatePath,
    onProgress,
    containmentRoot = null,
    allowUnconfinedDelete = false,
  } = options

  if (!targetPath || typeof targetPath !== 'string') {
    throw new Error('Missing delete path')
  }

  const resolvedPath = path.resolve(targetPath)
  if (isFilesystemRoot(resolvedPath)) {
    throw new Error(`Refusing to delete a filesystem root: ${resolvedPath}`)
  }

  if (!allowUnconfinedDelete) {
    assertDeletionContainment(resolvedPath, containmentRoot)
  } else if (containmentRoot) {
    assertDeletionContainment(resolvedPath, containmentRoot)
  }

  if (validatePath) await validatePath(resolvedPath)

  if (!(await pathExists(resolvedPath))) {
    return { success: true, elevated: false, missing: true }
  }

  // ── Stage (non-destructive) ────────────────────────────────────────────────
  const staging = await stagePathForDeletion(resolvedPath)

  if (!staging.staged) {
    const err = staging.error
    if (!isPermissionDeleteError(err) || !allowElevatedRetry) throw err
    if (process.platform !== 'win32') {
      throw new Error(
        `Permission denied while deleting ${resolvedPath}. Nothing was removed. ` +
        'Delete it manually or adjust file permissions.'
      )
    }

    const shouldRetry = await askForElevatedDelete({ targetPath: resolvedPath, description, window })
    if (!shouldRetry) {
      return { success: false, canceled: true, deleted: false, error: 'Skipped administrator retry' }
    }

    if (validatePath) await validatePath(resolvedPath)
    if (!allowUnconfinedDelete || containmentRoot) {
      assertDeletionContainment(resolvedPath, containmentRoot)
    }
    onProgress?.('Waiting for administrator approval to delete files...')
    const elevatedResult = await runElevatedWindowsDelete(resolvedPath, { recursive, force })
    if (!(await pathExists(resolvedPath))) {
      return { success: true, elevated: true }
    }
    if (elevatedResult.canceled) {
      return { success: false, canceled: true, error: elevatedResult.error || 'Administrator retry was canceled' }
    }
    return {
      success: false,
      error: elevatedResult.error || `Administrator retry did not remove ${resolvedPath}`,
    }
  }

  if (staging.missing) {
    return { success: true, elevated: false, missing: true }
  }

  // ── Remove the staged copy ────────────────────────────────────────────────
  // The original path is already gone at this point, so a failure here is a
  // reportable leftover rather than data loss at the location the user cares
  // about. Surface the staging path so the remnants are findable.
  const { stagedPath } = staging
  try {
    await fs.promises.rm(stagedPath, { recursive, force })
    if (await pathExists(stagedPath)) {
      const err = new Error(`Delete reported success but did not remove ${stagedPath}`)
      err.code = process.platform === 'win32' ? 'EBUSY' : 'EIO'
      throw err
    }
    return { success: true, elevated: false }
  } catch (err) {
    if (!isPermissionDeleteError(err) || !allowElevatedRetry || process.platform !== 'win32') {
      return {
        success: false,
        stagedPath,
        error:
          `${resolvedPath} was moved aside but could not be fully removed ` +
          `(${err.message}). Leftover files are in ${stagedPath}.`,
      }
    }

    const shouldRetry = await askForElevatedDelete({
      targetPath: stagedPath,
      description: `${description} (leftover files)`,
      window,
    })
    if (!shouldRetry) {
      return {
        success: false,
        canceled: true,
        stagedPath,
        error: `Leftover files remain in ${stagedPath}.`,
      }
    }

    onProgress?.('Waiting for administrator approval to delete files...')
    const elevatedResult = await runElevatedWindowsDelete(stagedPath, { recursive, force })
    if (!(await pathExists(stagedPath))) {
      return { success: true, elevated: true }
    }
    return {
      success: false,
      stagedPath,
      error: elevatedResult.error || `Administrator retry did not remove ${stagedPath}`,
    }
  }
}

module.exports = {
  deletePathWithElevationFallback,
  isPermissionDeleteError,
  assertDeletionContainment,
  isStrictlyInside,
  isPathInside,
  isFilesystemRoot,
  STAGING_PREFIX,
}
