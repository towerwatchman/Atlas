'use strict'

const { ipcMain, BrowserWindow, shell } = require('electron')
const path = require('path')
const fs = require('fs')

module.exports = function registerGamesHandlers(ctx) {
  const {
    getAssetBasePath, getMediaStorageMode, appConfig, configPath,
    gameDetailsRecordMap, recentlyDeletedGamePaths,
    // db functions
    addGame, getGame, getGames, getGameRecordIds, removeGame, updateGame,
    upsertVersion, updateVersion, deleteGameCompletely, getUniqueFilterOptions,
    updateFolderSize, countVersions, deleteVersion,
    getVersionPathsForRecord, getVersionForRecord, getInstalledVersionsForRecord,
    recordGameLaunchStarted, recordGamePlaytime, getEmulatorByExtension,
    // helpers
    deleteTitleRecord, isAllowedDeletionPath, getTrustedVersion,
    removeEmptyParentDirectories, normalizeForPathCompare,
    // windows
    createGameDetailsWindow,
  } = ctx

  ipcMain.handle('add-game', async (event, game) => {
    return await addGame(game, getAssetBasePath(), process.defaultApp)
  })

  ipcMain.handle('count-versions', async (_, recordId) => {
    return await countVersions(recordId)
  })

  ipcMain.handle('delete-version', async (_, { recordId, version }) => {
    try {
      const selectedVersion = await getTrustedVersion(recordId, version)
      const folderPath = selectedVersion.game_path
        ? path.resolve(selectedVersion.game_path)
        : null

      if (folderPath && fs.existsSync(folderPath)) {
        if (!(await isAllowedDeletionPath(recordId, folderPath))) {
          return { success: false, error: 'Folder is not linked to this game' }
        }
        await fs.promises.rm(folderPath, { recursive: true, force: true })
        await removeEmptyParentDirectories(folderPath, appConfig?.Library?.gameFolder)
      }

      await deleteVersion(recordId, version)
      return { success: true }
    } catch (err) {
      console.error('delete-version failed:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('get-replace-version-options', async (_, { recordId }) => {
    return await getInstalledVersionsForRecord(recordId)
  })

  ipcMain.handle('delete-game-completely', async (_, recordId) => {
    return await deleteGameCompletely(recordId, getAssetBasePath(), process.defaultApp)
  })

  ipcMain.handle('delete-title', async (_, { recordId, deleteFiles = false }) => {
    return await deleteTitleRecord(recordId, { deleteFiles })
  })

  ipcMain.handle('get-game', async (event, recordId) => {
    return await getGame(recordId, getAssetBasePath(), process.defaultApp, getMediaStorageMode())
  })

  ipcMain.handle('request-game-data', async (event) => {
    const recordId = gameDetailsRecordMap.get(event.sender.id)
    if (recordId === undefined) {
      console.warn('request-game-data: no recordId mapped for this window')
      return null
    }
    return await getGame(recordId, getAssetBasePath(), process.defaultApp, getMediaStorageMode())
  })

  ipcMain.handle('get-games', async (event, args = {}) => {
    const { offset, limit, includeUninstalled, options = {} } = args
    return await getGames(
      getAssetBasePath(),
      process.defaultApp,
      getMediaStorageMode(),
      offset,
      limit,
      includeUninstalled,
      options,
    )
  })

  ipcMain.handle('validate-library-paths', async (event) => {
    if (ctx.activeLibraryValidation?.running) {
      return { success: true, alreadyRunning: true }
    }
    const sender = event.sender
    ctx.activeLibraryValidation = { running: true, canceled: false }
    setImmediate(async () => {
      try {
        const recordIds = await getGameRecordIds()
        let processed = 0
        for (const recordId of recordIds) {
          if (ctx.activeLibraryValidation?.canceled) break
          const game = await getGame(recordId, getAssetBasePath(), process.defaultApp, getMediaStorageMode())
          processed++
          if (!sender.isDestroyed()) {
            sender.send('library-validation-progress', { processed, total: recordIds.length })
            if (game) sender.send('game-updated', game)
          }
          if (processed % 25 === 0) await new Promise(resolve => setTimeout(resolve, 0))
        }
      } catch (err) {
        console.error('Library path validation failed:', err)
        if (!sender.isDestroyed()) {
          sender.send('library-validation-progress', { error: err.message, processed: 0, total: 0 })
        }
      } finally {
        ctx.activeLibraryValidation = null
      }
    })
    return { success: true }
  })

  ipcMain.handle('remove-game', async (event, record_id) => {
    return await removeGame(record_id, getAssetBasePath(), process.defaultApp)
  })

  ipcMain.handle('get-unique-filter-options', async () => {
    return await getUniqueFilterOptions()
  })

  ipcMain.handle('update-game', async (event, game) => {
    return await updateGame(game, getAssetBasePath(), process.defaultApp)
  })

  ipcMain.handle('update-version', async (event, version, record_id) => {
    return await upsertVersion(version, record_id)
  })

  ipcMain.handle('get-default-game-folder', async () => {
    return appConfig?.Library?.gameFolder || ''
  })

  ipcMain.handle('set-default-game-folder', async (event, newPath) => {
    const ini = require('ini')
    const newConfig = { ...appConfig, Library: { ...appConfig.Library, gameFolder: newPath } }
    fs.writeFileSync(configPath, ini.stringify(newConfig))
    ctx.appConfig = newConfig
    return { success: true }
  })

  ipcMain.handle('launch-game', async (event, data) => {
    const { recordId, version } = data
    try {
      const selectedVersion = await getTrustedVersion(recordId, version)
      const gamePath = selectedVersion.game_path
      const ext = path.extname(gamePath).toLowerCase().replace('.', '')
      const emulator = await getEmulatorByExtension(ext)
      const launchPath = emulator ? emulator.path : gamePath
      const args = emulator ? [gamePath] : []
      const child = require('child_process').spawn(launchPath, args, {
        detached: true,
        stdio: 'ignore',
      })
      child.unref()
      await recordGameLaunchStarted(recordId, version)
      return { success: true }
    } catch (err) {
      console.error('launch-game error:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('open-game-folder', async (event, data) => {
    const { recordId, version } = data
    try {
      const selectedVersion = await getTrustedVersion(recordId, version)
      await shell.openPath(path.dirname(selectedVersion.game_path))
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('open-game-properties', async (event, recordId) => {
    createGameDetailsWindow(recordId)
    return { success: true }
  })

  ipcMain.handle('open-directory', async (event, dirPath) => {
    await shell.openPath(dirPath)
    return { success: true }
  })
}
