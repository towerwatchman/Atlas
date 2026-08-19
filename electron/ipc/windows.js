'use strict'

const { ipcMain, BrowserWindow, dialog, shell, app, Menu, desktopCapturer, screen } = require('electron')
const path = require('path')
const fs = require('fs')
const { launchGame } = require('./games')


// Async because openFolder REPORTS. Every other action is still fire-and-forget
// and returns nothing, which run-context-action reads as success -- so only the
// case that has something to say has to say it.
async function handleContextAction(data, sender, ctx) {
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
            gamePath: selectedVersion.game_path || "",
            extension,
            recordId: data.recordId,
            version: selectedVersion.version,
            // Forwarded so this matches the launch-game IPC handler in
            // ipc/games.js. Without them launchGame falls back to
            // getSteamIDbyRecord, which resolves the TITLE mapping -- so a
            // title holding two Steam versions launched whichever one that
            // pointed at, regardless of the version clicked.
            source: selectedVersion.source || null,
            sourceAppId: selectedVersion.source_app_id || null,
          });
        })
        .catch((err) => console.error("Context launch failed:", err));
      break;
    case "openFolder":
      // Returned rather than logged. This used to end in a .catch that wrote to
      // a console the user does not have open, so a folder that could not be
      // opened was indistinguishable from a menu item that did nothing.
      return await ctx.openGameFolderForVersion({
        recordId: data.recordId,
        versionId: data.versionId,
        version: data.version,
      });
    case "openUrl":
      shell.openExternal(data.url);
      break;
    case "properties":
      console.log("Creating GameDetailsWindow for recordId:", data.recordId);
      ctx.createGameDetailsWindow(data.recordId);
      break;
    case "setFavorite": {
      ctx.setGameFavorite(data.recordId, data.isFavorite === true)
        .then((result) => {
          if (!result?.success) {
            console.error("Context favorite update failed:", result?.error);
            return;
          }
          BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.isDestroyed()) win.webContents.send("game-updated", result.recordId);
          });
        })
        .catch((err) => console.error("Context favorite update failed:", err));
      break;
    }
    case "removeTitleFromLibrary": {
      const senderWindow = BrowserWindow.fromWebContents(sender);
      dialog
        .showMessageBox(senderWindow || ctx.mainWindow, {
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
        .showMessageBox(senderWindow || ctx.mainWindow, {
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
    case "addToCollection": {
      const { addGameToCollection } = require("../db/collections");
      const { broadcastCollectionsChanged } = require("./collections");
      addGameToCollection(data.collectionId, data.recordId)
        .then((result) => {
          if (!result?.success) {
            console.error("Context add to collection failed:", result?.error);
            return;
          }
          broadcastCollectionsChanged();
        })
        .catch((err) => console.error("Context add to collection failed:", err));
      break;
    }
    case "removeFromCollection": {
      const { removeGameFromCollection } = require("../db/collections");
      const { broadcastCollectionsChanged } = require("./collections");
      removeGameFromCollection(data.collectionId, data.recordId)
        .then((result) => {
          if (!result?.success) {
            console.error("Context remove from collection failed:", result?.error);
            return;
          }
          broadcastCollectionsChanged();
        })
        .catch((err) => console.error("Context remove from collection failed:", err));
      break;
    }
    case "collectionRenameRequested": {
      // Same reason as newCollectionWithGame: native menus can't prompt, so the
      // renderer owns the dialog.
      sender?.send("collection-rename-requested", {
        collectionId: data.collectionId,
        name: data.name,
        color: data.color,
      });
      break;
    }
    case "rateTitleRequested": {
      sender?.send("rate-title-requested", { recordId: data.recordId, title: data.title });
      break;
    }
    case "toggleWishlist": {
      // Context menus cannot prompt, so the same toggle the detail page uses
      // is run here. The success path broadcasts wishlist-updated so the
      // renderer can refresh its identity-key set and filtered lists -- the
      // grid row reflects the new state the next time the menu opens.
      const { toggleWishlistEntry } = require("../db/wishlist");
      const result = await toggleWishlistEntry(data);
      if (result?.success) {
        BrowserWindow.getAllWindows().forEach((win) => {
          if (!win.isDestroyed()) win.webContents.send("wishlist-updated", { source: "context-menu" });
        });
      }
      break;
    }
    case "collectionBulkTagRequested": {
      // Same round-trip as rename/delete: a native menu cannot host a form, so
      // the renderer owns the dialog and already knows which records belong to
      // the collection.
      sender?.send("collection-bulk-tag-requested", {
        collectionId: data.collectionId,
        name: data.name,
      });
      break;
    }
    case "collectionDeleteRequested": {
      sender?.send("collection-delete-requested", {
        collectionId: data.collectionId,
        name: data.name,
      });
      break;
    }
    case "newCollectionWithGame": {
      // The name has to come from the renderer (native menus can't prompt), so
      // this just asks the window that opened the menu to show its create
      // dialog, pre-seeded with the game to add on save.
      sender?.send("collection-create-requested", { recordId: data.recordId });
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
        // A native menu click has nowhere to return a result to, so the outcome
        // is logged here rather than surfaced. Only the collection menus still
        // come through this path; game menus use the React one.
        Promise.resolve(handleContextAction(data, sender, ctx))
          .catch((err) => console.error("Context action failed:", err));
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

  // Entry point for the custom React context menu. It reuses handleContextAction
  // rather than reimplementing a dozen actions in the renderer, so the native
  // menu path and the custom one cannot drift — confirmations, elevation
  // prompts and delete safeguards all still live in one place.
  ipcMain.handle('run-context-action', async (event, data) => {
    try {
      // Actions that report an outcome return one; the rest return undefined and
      // keep the old always-true shape, so no existing caller changes.
      const result = await handleContextAction(data, event.sender, ctx)
      return result || { success: true }
    } catch (err) {
      console.error('run-context-action failed:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('select-file', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('open-banner-editor', () => {
    ctx.createBannerEditorWindow()
  })

  ipcMain.handle('open-importer-help', () => {
    ctx.createImporterHelpWindow?.()
  })

  ipcMain.handle('list-subfolders', async (event, dirPath) => {
    // Returns the immediate subfolder names of dirPath (up to a small cap),
    // used by the importer's live parse-preview. Read-only, best-effort.
    try {
      if (!dirPath || typeof dirPath !== 'string') return { success: true, folders: [] }
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
      const folders = entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .slice(0, 25)
      return { success: true, folders }
    } catch (err) {
      return { success: false, error: String(err?.message || err), folders: [] }
    }
  })

  // Cross-screen color picker support. Captures every display at full
  // resolution and returns each as a PNG data URL along with its logical
  // bounds and scale factor. The renderer overlays these captures fullscreen
  // so the user can sample a pixel from ANY window or monitor — the native
  // EyeDropper API can't see other windows / the desktop in Electron, so we
  // roll our own from a desktopCapturer snapshot instead.
  ipcMain.handle('capture-screens', async () => {
    try {
      const displays = screen.getAllDisplays()
      // Request thumbnails at each display's full pixel size so sampled colors
      // are accurate (no downscale blur). Use the largest display size as the
      // thumbnail ceiling; desktopCapturer maps sources to displays by id.
      const maxW = Math.max(...displays.map((d) => Math.round(d.size.width * d.scaleFactor)))
      const maxH = Math.max(...displays.map((d) => Math.round(d.size.height * d.scaleFactor)))
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: maxW, height: maxH },
      })
      const captures = sources.map((source) => {
        // display_id is a string; match it to the Electron display.
        const display = displays.find((d) => String(d.id) === String(source.display_id)) || null
        const bounds = display ? display.bounds : null
        const scaleFactor = display ? display.scaleFactor : 1
        return {
          id: source.id,
          displayId: source.display_id || (display ? String(display.id) : ''),
          dataUrl: source.thumbnail.toDataURL(),
          bounds,
          scaleFactor,
        }
      })
      return { success: true, captures }
    } catch (err) {
      console.error('capture-screens error:', err)
      return { success: false, error: String(err?.message || err), captures: [] }
    }
  })

  ipcMain.handle('select-directory', async (event, options = {}) => {
    // Attach the dialog to the requesting window so it is window-modal and can't
    // open hidden behind the app (which made it look like the UI was stuck), and
    // pass through a title/message so the user knows what the folder is for.
    const win = BrowserWindow.fromWebContents(event.sender)
    const dialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      ...(options.title ? { title: options.title } : {}),
      ...(options.message ? { message: options.message } : {}),
      ...(options.buttonLabel ? { buttonLabel: options.buttonLabel } : {}),
      ...(options.defaultPath ? { defaultPath: options.defaultPath } : {}),
    }
    const result = win
      ? await dialog.showOpenDialog(win, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)
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
        containmentRoot: appConfig?.Library?.gameFolder || null,
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

  ipcMain.handle('report-update-progress', async (event, progress) => {
    if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
      ctx.mainWindow.webContents.send('import-progress', progress)
    }
  })

  ipcMain.handle('open-importer', async (event, source = 'atlas') => {
    createImporterWindow(source)
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

  const isAllowedExternalUrl = (value) =>
    /^https?:\/\//i.test(value) ||
    /^steam:\/\/(?:nav\/games\/details|install|uninstall|run|rungameid)\/\d+$/i.test(value)

  ipcMain.handle('open-external-url', async (event, url) => {
    const value = String(url || '').trim()
    if (!isAllowedExternalUrl(value)) {
      throw new Error('External URL must be http(s) or an approved Steam app URL')
    }
    await shell.openExternal(value)
  })
}
