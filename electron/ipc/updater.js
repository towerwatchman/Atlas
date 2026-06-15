'use strict'

const { ipcMain } = require('electron')

module.exports = function registerUpdaterHandlers(ctx) {
  const { autoUpdater, checkDbUpdates } = ctx

  ipcMain.handle('check-updates', async () => {
    return await checkDbUpdates()
  })

  ipcMain.handle('check-app-update', async () => {
    try {
      await autoUpdater.checkForUpdates()
      return { success: true }
    } catch (err) {
      console.error('check-app-update error:', err)
      return { success: false, error: err.message }
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
      console.error('download-app-update error:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('download-and-install-app-update', async () => {
    try {
      if (ctx.updateDownloaded) {
        autoUpdater.quitAndInstall()
      } else {
        ctx.installAfterDownload = true
        await autoUpdater.downloadUpdate()
      }
      return { success: true }
    } catch (err) {
      console.error('download-and-install-app-update error:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('install-app-update', async () => {
    try {
      autoUpdater.quitAndInstall()
      return { success: true }
    } catch (err) {
      console.error('install-app-update error:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('check-db-updates', async () => {
    return await checkDbUpdates()
  })
}
