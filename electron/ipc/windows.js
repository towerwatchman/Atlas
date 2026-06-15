'use strict'

const { ipcMain, BrowserWindow, dialog, shell, app } = require('electron')
const path = require('path')
const fs = require('fs')

module.exports = function registerWindowsHandlers(ctx) {
  const { mainWindow, settingsWindow, createImporterWindow, contextMenuData } = ctx

  ipcMain.handle('minimize-window', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win) win.minimize()
  })

  ipcMain.handle('maximize-window', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  ipcMain.handle('close-window', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) win.close()
  })

  ipcMain.handle('select-file', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('delete-folder-recursive', async (event, { recordId, folderPath }) => {
    const { isAllowedDeletionPath, removeEmptyParentDirectories, appConfig } = ctx
    try {
      const resolvedPath = path.resolve(folderPath)
      if (!(await isAllowedDeletionPath(recordId, resolvedPath))) {
        return { success: false, error: 'Folder is not linked to this game' }
      }
      await fs.promises.rm(resolvedPath, { recursive: true, force: true })
      await removeEmptyParentDirectories(resolvedPath, appConfig?.Library?.gameFolder)
      return { success: true }
    } catch (err) {
      console.error('delete-folder-recursive error:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('get-version', () => app.getVersion())

  ipcMain.handle('log', async (event, message) => {
    console.log('[Renderer]', message)
  })

  ipcMain.handle('update-progress', async (event, progress) => {
    if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
      ctx.mainWindow.webContents.send('import-progress', progress)
    }
  })

  ipcMain.handle('open-importer', async () => {
    createImporterWindow()
  })

  ipcMain.handle('show-context-menu', (event, template) => {
    const { Menu } = require('electron')
    const id = ctx.contextMenuId++
    contextMenuData.set(id, template)
    const menu = Menu.buildFromTemplate(
      template.map((item, index) => ({
        ...item,
        click: () => {
          event.sender.send('context-menu-action', { id, index })
        },
      }))
    )
    const win = BrowserWindow.fromWebContents(event.sender)
    menu.popup({ window: win })
    return id
  })

  ipcMain.handle('open-external-url', async (event, url) => {
    await shell.openExternal(url)
  })
}
