'use strict'

const path = require('path')
const { BrowserWindow, ipcMain } = require('electron')
const { normalizeUpdateError } = require('../utils/updateErrors')

const UPDATE_NOT_DOWNLOADED_MESSAGE =
  'The update package has not been downloaded yet. Please check for updates and download the update first.'

function broadcastUpdateStatus(ctx, status, source) {
  ctx.lastUpdateStatus = status
  console.log(`update-state: ${status.status} via ${source}`)
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) window.webContents.send('update-status', status)
  })
}

module.exports = function registerUpdaterHandlers(ctx) {
  const { autoUpdater, checkDbUpdates, dataDir, mainWindow } = ctx

  ipcMain.handle('check-updates', async () => {
    return await checkDbUpdates(path.join(dataDir, 'updates'), mainWindow)
  })

  ipcMain.handle('check-app-update', async () => {
    try {
      await autoUpdater.checkForUpdates()
      return { success: true }
    } catch (err) {
      ctx.installAfterDownload = false
      const normalizedError = normalizeUpdateError(err)
      console.error('check-app-update error:', err)
      console.error('check-app-update normalized:', normalizedError)
      ctx.lastUpdateStatus = {
        status: 'error',
        error: normalizedError.userMessage,
        code: normalizedError.code,
        retryable: normalizedError.retryable,
      }
      return { success: false, error: normalizedError.userMessage, code: normalizedError.code, retryable: normalizedError.retryable }
    }
  })

  ipcMain.handle('get-app-update-state', async () => {
    return {
      ...ctx.lastUpdateStatus,
      branch: ctx.getConfiguredAppUpdateBranch?.(),
    }
  })

  ipcMain.handle('download-app-update', async () => {
    try {
      ctx.installAfterDownload = false
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (err) {
      ctx.installAfterDownload = false
      const normalizedError = normalizeUpdateError(err)
      console.error('download-app-update error:', err)
      console.error('download-app-update normalized:', normalizedError)
      return { success: false, error: normalizedError.userMessage, code: normalizedError.code, retryable: normalizedError.retryable }
    }
  })

  ipcMain.handle('download-and-install-app-update', async () => {
    try {
      if (ctx.updateDownloaded) {
        broadcastUpdateStatus(ctx, {
          ...ctx.lastUpdateStatus,
          status: 'installing',
        }, 'download-and-install-app-update')
        // Non-silent: the installer's own window IS the progress UI, and its
        // finish page is both the "done" signal and the relaunch. This process
        // has to exit for the installer to replace its own files, so nothing we
        // render could cover that gap.
        //
        // No wizard page can appear on an update, so the visible installer is
        // just progress + finish:
        //   * no welcome/license page is configured
        //   * the install-mode page is not compiled in (perMachine:true defines
        //     INSTALL_MODE_PER_ALL_USERS, which assistedInstaller.nsh checks)
        //   * the directory page is wrapped in skipPageIfUpdated, and --updated
        //     is always passed
        //
        // The relaunch comes from MUI_FINISHPAGE_RUN -> StartApp, which exists
        // because runAfterFinish is true (so HIDE_RUN_AFTER_FINISH is undefined)
        // and because build/installer.nsh does NOT define customFinishPage. That
        // costs one click on Finish, which is the point: the user sees it complete
        // rather than guessing.
        //
        // StartApp uses ExecShellAsUser, so Atlas does not inherit the installer's
        // elevated token — important because Atlas launches game executables.
        //
        // /D= is passed either way, so the update still lands in the current
        // folder.
        autoUpdater.quitAndInstall(false, true)
      } else {
        ctx.installAfterDownload = true
        await autoUpdater.downloadUpdate()
      }
      return { success: true }
    } catch (err) {
      ctx.installAfterDownload = false
      const normalizedError = normalizeUpdateError(err)
      console.error('download-and-install-app-update error:', err)
      console.error('download-and-install-app-update normalized:', normalizedError)
      return { success: false, error: normalizedError.userMessage, code: normalizedError.code, retryable: normalizedError.retryable }
    }
  })

  ipcMain.handle('install-app-update', async () => {
    try {
      if (!ctx.updateDownloaded) {
        console.warn('install-app-update ignored: update has not been downloaded')
        return { success: false, error: UPDATE_NOT_DOWNLOADED_MESSAGE, code: 'UPDATE_NOT_DOWNLOADED', retryable: true }
      }
      if (!['downloaded', 'installing'].includes(ctx.lastUpdateStatus?.status)) {
        console.warn(`install-app-update ignored: invalid update state ${ctx.lastUpdateStatus?.status || 'unknown'}`)
        return { success: false, error: UPDATE_NOT_DOWNLOADED_MESSAGE, code: 'UPDATE_NOT_DOWNLOADED', retryable: true }
      }
      broadcastUpdateStatus(ctx, {
        ...ctx.lastUpdateStatus,
        status: 'installing',
      }, 'install-app-update')
      // See download-and-install-app-update above for why this is not silent.
      autoUpdater.quitAndInstall(false, true)
      return { success: true }
    } catch (err) {
      const normalizedError = normalizeUpdateError(err)
      console.error('install-app-update error:', err)
      console.error('install-app-update normalized:', normalizedError)
      return { success: false, error: normalizedError.userMessage, code: normalizedError.code, retryable: normalizedError.retryable }
    }
  })

  ipcMain.handle('check-db-updates', async () => {
    return await checkDbUpdates(path.join(dataDir, 'updates'), mainWindow)
  })
}
