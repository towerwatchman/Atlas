'use strict'

const { dialog } = require('electron')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

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

async function askForElevatedDelete({ targetPath, description, window }) {
  const ownerWindow = window && !window.isDestroyed?.() ? window : undefined
  const result = await dialog.showMessageBox(ownerWindow, {
    type: 'warning',
    buttons: ['Retry as administrator', 'Skip'],
    defaultId: 0,
    cancelId: 1,
    title: 'Administrator approval required',
    message: 'Atlas could not delete this file or folder because Windows denied permission.',
    detail: `${description || 'Delete item'}\n\n${targetPath}\n\nYou can retry once with administrator approval.`,
    noLink: true,
  })
  return result.response === 0
}

function runElevatedWindowsDelete(targetPath, { recursive = true, force = true } = {}) {
  return new Promise((resolve) => {
    const targetBase64 = encodeUtf8(targetPath)
    const innerCommand = [
      `$target = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${targetBase64}'))`,
      `$recurse = ${recursive ? '$true' : '$false'}`,
      `$force = ${force ? '$true' : '$false'}`,
      '$params = @{ LiteralPath = $target; ErrorAction = "Stop" }',
      'if ($recurse) { $params.Recurse = $true }',
      'if ($force) { $params.Force = $true }',
      'Remove-Item @params',
    ].join('; ')
    const innerEncoded = encodePowerShell(innerCommand)
    const outerCommand = [
      '$ErrorActionPreference = "Stop"',
      `$argsList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', '${innerEncoded}')`,
      'Start-Process -FilePath "powershell.exe" -ArgumentList $argsList -Verb RunAs -Wait',
    ].join('; ')
    const outerEncoded = encodePowerShell(outerCommand)
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', outerEncoded],
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

async function deletePathWithElevationFallback(targetPath, options = {}) {
  const {
    recursive = true,
    force = true,
    description = 'Delete item',
    window,
    allowElevatedRetry = true,
    validatePath,
    onProgress,
  } = options

  if (!targetPath || typeof targetPath !== 'string') {
    throw new Error('Missing delete path')
  }

  const resolvedPath = path.resolve(targetPath)
  if (resolvedPath === path.parse(resolvedPath).root) {
    throw new Error('Refusing to delete a drive root')
  }

  if (validatePath) await validatePath(resolvedPath)

  try {
    await fs.promises.rm(resolvedPath, { recursive, force })
    return { success: true, elevated: false }
  } catch (err) {
    if (!isPermissionDeleteError(err) || !allowElevatedRetry) throw err
    if (process.platform !== 'win32') {
      throw new Error(`Permission denied while deleting ${resolvedPath}. Delete it manually or adjust file permissions.`)
    }

    const shouldRetry = await askForElevatedDelete({ targetPath: resolvedPath, description, window })
    if (!shouldRetry) {
      return { success: false, canceled: true, error: 'Skipped administrator retry' }
    }

    if (validatePath) await validatePath(resolvedPath)
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
}

module.exports = {
  deletePathWithElevationFallback,
  isPermissionDeleteError,
}
