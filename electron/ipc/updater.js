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
        // MUST stay silent. BaseUpdater.quitAndInstall does:
        //   install(isSilent, isSilent ? isForceRunAfter : this.autoRunAppAfterInstall)
        // so the second argument here is only honoured when isSilent is true —
        // but more importantly installSection.nsh's assisted-installer branch
        // only auto-starts the app when ${isForceRun} AND ${Silent}. A
        // non-silent update therefore installs correctly and then leaves Atlas
        // closed, which is exactly what happened when this was tried.
        //
        // Progress feedback comes from the SpiderBanner shown in
        // build/installer.nsh's customInit, which works under /S because it is a
        // plugin window rather than an installer page.
        //
        // Silent also keeps the NSIS mode/directory pages from running and lets
        // /D= place the update in the current folder.
        autoUpdater.quitAndInstall(true, true)
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
      // See download-and-install-app-update above for why this must be silent.
      autoUpdater.quitAndInstall(true, true)
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
