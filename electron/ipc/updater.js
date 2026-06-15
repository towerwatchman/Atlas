'use strict'

const path = require('path')
const { ipcMain } = require('electron')

module.exports = function registerUpdaterHandlers(ctx) {
  const {
    autoUpdater,
    checkDbUpdates,
    dataDir,
    mainWindow,
    refreshAtlasMappingsFromSources,
  } = ctx

  ipcMain.handle('check-updates', async () => {
    return await checkDbUpdates(path.join(dataDir, 'updates'), mainWindow)
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
    return await checkDbUpdates(path.join(dataDir, 'updates'), mainWindow)
  })

  ipcMain.handle('refresh-metadata-mappings', async () => {
    try {
      const dbUpdate = await checkDbUpdates(path.join(dataDir, 'updates'), mainWindow)
      if (!dbUpdate?.success) {
        return {
          success: false,
          dbUpdate,
          remap: null,
          error: dbUpdate?.error || 'Database update failed',
        }
      }

      const remap = await refreshAtlasMappingsFromSources()
      return {
        success: remap?.success !== false,
        dbUpdate,
        remap,
      }
    } catch (err) {
      console.error('refresh-metadata-mappings error:', err)
      return {
        success: false,
        dbUpdate: null,
        remap: null,
        error: err.message,
      }
    }
  })
}
