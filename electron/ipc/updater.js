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
        // MUST stay silent. Three separate attempts at showing the installer
        // all broke updates on this configuration (perMachine + elevation):
        //
        //   1. non-silent + empty customFinishPage, relaunch hand-rolled here:
        //      installed, never reopened (removing the finish page also removes
        //      MUI_FINISHPAGE_RUN and Function StartApp).
        //   2. silent + SpiderBanner: banner never appeared.
        //   3. non-silent + the stock finish page: UAC prompt, then no installer
        //      window at all, and no relaunch.
        //
        // Silent is the only configuration observed to actually work end to end.
        // It also matches what the templates expect: installSection.nsh's
        // assisted-installer branch auto-starts the app only when ${isForceRun}
        // AND ${Silent}, and installer.nsi's own elevation-for-upgrade block is
        // guarded by ${Silent} too — its comment says a non-silent install
        // elevates "when the install mode is selected in the UI", but that page
        // is not compiled in under perMachine:true, so nothing in the script
        // elevates and it depends entirely on RequestExecutionLevel admin plus
        // electron-updater's elevate.exe fallback.
        //
        // Do not switch this to false without testing a real packaged build; the
        // failure mode is a successful install that never reopens the app.
        //
        // Silent also keeps the mode/directory pages from running and lets /D=
        // place the update in the current folder.
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
