'use strict'

const { ipcMain, BrowserWindow, dialog, shell, app, Menu } = require('electron')
const path = require('path')
const fs = require('fs')
const { launchGame } = require('./games')


function handleContextAction(data, sender, ctx) {
  if (!data || typeof data.action === "undefined") {
    console.error("handleContextAction: Invalid or missing data object", data);
    return;
  }

  switch (data.action) {
    case "launch":
      ctx.getTrustedVersion(data.recordId, data.version)
        .then((selectedVersion) => {
          const execPath = selectedVersion.exec_path || "";
          const extension = execPath.includes(".")
            ? execPath.split(".").pop().toLowerCase()
            : "";
          return launchGame({
            execPath,
            extension,
            recordId: data.recordId,
            version: selectedVersion.version,
          });
        })
        .catch((err) => console.error("Context launch failed:", err));
      break;
    case "openFolder":
      ctx.getTrustedVersion(data.recordId, data.version)
        .then((selectedVersion) => shell.openPath(selectedVersion.game_path))
        .catch((err) => console.error("Context open folder failed:", err));
      break;
    case "openUrl":
      shell.openExternal(data.url);
      break;
    case "properties":
      console.log("Creating GameDetailsWindow for recordId:", data.recordId);
      ctx.createGameDetailsWindow(data.recordId);
      break;
    case "removeTitleFromLibrary": {
      const senderWindow = BrowserWindow.fromWebContents(sender);
      dialog
        .showMessageBox(senderWindow || mainWindow, {
          type: "warning",
          buttons: ["Remove from Library", "Cancel"],
          defaultId: 1,
          cancelId: 1,
          title: "Remove Title from Library",
          message: `Remove "${data.title || "this title"}" from the local library?`,
          detail: "Game files will be kept on disk.",
        })
        .then(async ({ response }) => {
          if (response !== 0) return;
          const result = await ctx.deleteTitleRecord(data.recordId, {
            deleteFiles: false,
          });
          if (!result.success) {
            console.error("Context remove title failed:", result.error);
          }
        })
        .catch((err) => console.error("Context remove title failed:", err));
      break;
    }
    case "deleteTitleAndFiles": {
      const senderWindow = BrowserWindow.fromWebContents(sender);
      dialog
        .showMessageBox(senderWindow || mainWindow, {
          type: "warning",
          buttons: ["Delete Files", "Cancel"],
          defaultId: 1,
          cancelId: 1,
          title: "Delete Title and Files",
          message: `Delete "${data.title || "this title"}" and all linked files from disk?`,
          detail:
            "This removes the title from the library and deletes all linked version folders.\nThis cannot be undone.",
        })
        .then(async ({ response }) => {
          if (response !== 0) return;
          const result = await ctx.deleteTitleRecord(data.recordId, {
            deleteFiles: true,
          });
          if (!result.success) {
            console.error("Context delete title failed:", result.error);
          }
        })
        .catch((err) => console.error("Context delete title failed:", err));
      break;
    }
    default:
      console.error(`Unknown action: ${data.action}`);
  }
}

function processTemplate(items, sender, ctx) {
  return items.map((item) => {
    const newItem = { ...item };
    if (newItem.submenu) {
      newItem.submenu = processTemplate(newItem.submenu, sender, ctx);
    }
    if (newItem.data) {
      const id = ctx.contextMenuId++;
      ctx.contextMenuData.set(id, newItem.data);
      newItem.click = () => {
        const data = ctx.contextMenuData.get(id);
        handleContextAction(data, sender, ctx);
        ctx.contextMenuData.delete(id);
      };
      delete newItem.data;
    }
    return newItem;
  });
}

// ────────────────────────────────────────────────
// STEAM FUNCTIONS
// ────────────────────────────────────────────────

module.exports = function registerWindowsHandlers(ctx) {
  const { mainWindow, settingsWindow, createImporterWindow, contextMenuData } = ctx

  const isMainWindowCloseRequest = (win, sender) => {
    if (!win) return false
    if (ctx.mainWindow && !ctx.mainWindow.isDestroyed() && win === ctx.mainWindow) return true
    try {
      const url = String(sender?.getURL?.() || win.webContents?.getURL?.() || '')
      return /(?:^|[/\\])index\.html(?:[?#].*)?$/i.test(url) || /\/$/.test(url)
    } catch {
      return false
    }
  }

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
    if (!win) return { success: false, error: 'No sender window found' }
    if (isMainWindowCloseRequest(win, event.sender)) {
      ctx.quitFromMainWindow()
      return { success: true, quitting: true }
    }
    console.log('Secondary window close requested; closing sender only')
    win.close()
    return { success: true, quitting: false }
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
    const { isAllowedDeletionPath, removeEmptyParentDirectories, appConfig, deletePathWithElevationFallback } = ctx
    try {
      const resolvedPath = path.resolve(folderPath)
      if (!(await isAllowedDeletionPath(recordId, resolvedPath))) {
        return { success: false, error: 'Folder is not linked to this game' }
      }
      const deleteResult = await deletePathWithElevationFallback(resolvedPath, {
        recursive: true,
        force: true,
        description: 'Delete game folder',
        window: BrowserWindow.fromWebContents(event.sender),
        validatePath: async (candidatePath) => {
          if (candidatePath === path.parse(candidatePath).root) throw new Error('Refusing to delete a drive root')
          if (!(await isAllowedDeletionPath(recordId, candidatePath))) {
            throw new Error('Folder is not linked to this game')
          }
        },
      })
      if (!deleteResult.success) {
        return {
          success: false,
          canceled: deleteResult.canceled,
          error: deleteResult.error || 'Delete skipped',
        }
      }
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
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (!senderWindow) {
      console.error('No sender window found for context menu')
      return
    }
    const processedTemplate = processTemplate(template, event.sender, ctx)
    const menu = Menu.buildFromTemplate(processedTemplate)
    menu.popup({ window: senderWindow })
  })

  ipcMain.handle('open-external-url', async (event, url) => {
    const value = String(url || '').trim()
    if (!/^https?:\/\//i.test(value)) {
      throw new Error('External URL must start with http or https')
    }
    await shell.openExternal(value)
  })
}
