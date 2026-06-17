'use strict'

const path = require('path')
const { ipcMain } = require('electron')
const { normalizeUpdateError } = require('../utils/updateErrors')

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
    return ctx.lastUpdateStatus
  })

  ipcMain.handle('download-app-update', async () => {
    try {
      ctx.installAfterDownload = false
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (err) {
      const normalizedError = normalizeUpdateError(err)
      console.error('download-app-update error:', err)
      console.error('download-app-update normalized:', normalizedError)
      return { success: false, error: normalizedError.userMessage, code: normalizedError.code, retryable: normalizedError.retryable }
    }
  })

  ipcMain.handle('download-and-install-app-update', async () => {
    try {
      if (ctx.updateDownloaded) {
        // Silent install (no installer UI) so the NSIS mode/directory pages
        // never run. This avoids the stale per-machine prompt and lets the
        // /D= switch (set via autoUpdater.installDirectory) place the update
        // in the current folder. Second arg relaunches the app afterward.
        autoUpdater.quitAndInstall(true, true)
      } else {
        ctx.installAfterDownload = true
        await autoUpdater.downloadUpdate()
      }
      return { success: true }
    } catch (err) {
      const normalizedError = normalizeUpdateError(err)
      console.error('download-and-install-app-update error:', err)
      console.error('download-and-install-app-update normalized:', normalizedError)
      return { success: false, error: normalizedError.userMessage, code: normalizedError.code, retryable: normalizedError.retryable }
    }
  })

  ipcMain.handle('install-app-update', async () => {
    try {
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
