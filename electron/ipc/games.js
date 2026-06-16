'use strict'

const { ipcMain, BrowserWindow, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const cp = require('child_process')
const { recordGameLaunchStarted, recordGamePlaytime } = require('../db/games')
const { getEmulatorByExtension } = require('../db/settings')
const { getSteamIDbyRecord } = require('../db/steam')
const { applyMediaSources } = require('../db/mediaSources')

function emitGameUpdated(recordId) {
  if (!recordId) return
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send('game-updated', recordId)
  })
}

async function startPlaySession(recordId, version, trackPlaytime = true) {
  if (!recordId || !version) return null
  const startedAtMs = Date.now()
  const startedAtSeconds = Math.floor(startedAtMs / 1000)
  await recordGameLaunchStarted(recordId, version, startedAtSeconds)
  emitGameUpdated(recordId)
  return {
    finish: async () => {
      if (!trackPlaytime) return
      const elapsedMs = Math.max(0, Date.now() - startedAtMs)
      if (elapsedMs <= 0) return
      const minutes = Math.max(1, Math.ceil(elapsedMs / 60000))
      await recordGamePlaytime(recordId, version, minutes)
      emitGameUpdated(recordId)
    },
  }
}

function trackChildPlaySession(child, session, recordId) {
  if (!child || !session) return
  let finalized = false
  const finalize = async () => {
    if (finalized) return
    finalized = true
    try { await session.finish() }
    catch (err) { console.error(`Failed to finalize play session for ${recordId}:`, err) }
  }
  child.once('exit', finalize)
  child.once('close', finalize)
  child.once('error', (err) => {
    if (finalized) return
    finalized = true
    console.error(`Tracked game process error for ${recordId}:`, err)
  })
}

async function launchGame({ execPath, extension, recordId, version }) {
  if (recordId) {
    const steamId = await getSteamIDbyRecord(recordId)
    if (steamId) {
      await startPlaySession(recordId, version, false)
      shell.openExternal(`steam://run/${steamId}`)
      return
    }
  }
  if (!fs.existsSync(execPath)) {
    throw new Error(`Executable not found: ${execPath}`)
  }
  const emulator = await getEmulatorByExtension(extension)
  if (emulator) {
    const args = emulator.parameters ? emulator.parameters.split(' ') : []
    args.push(execPath)
    const child = cp.spawn(emulator.program_path, args, { detached: true, stdio: 'ignore' })
    const session = await startPlaySession(recordId, version, true)
    trackChildPlaySession(child, session, recordId)
    child.unref()
  } else if (['exe', 'bat', 'cmd'].includes(extension)) {
    const child = cp.spawn(execPath, [], {
      cwd: path.dirname(execPath),
      detached: true,
      stdio: 'ignore',
      shell: extension === 'bat' || extension === 'cmd',
    })
    const session = await startPlaySession(recordId, version, true)
    trackChildPlaySession(child, session, recordId)
    child.unref()
  } else {
    const openResult = await shell.openPath(execPath)
    if (openResult) throw new Error(openResult)
    await startPlaySession(recordId, version, false)
  }
}

function registerGamesHandlers(ctx) {
  const {
    getAssetBasePath, getMediaStorageMode, appConfig, configPath,
    gameDetailsRecordMap, recentlyDeletedGamePaths,
    getMetadataSourceOrder,
    // db functions
    addGame, getGame, getGames, getGameRecordIds, removeGame, updateGame,
    upsertVersion, updateVersion, deleteGameCompletely, getUniqueFilterOptions,
    updateFolderSize, countVersions, deleteVersion, getVersionForRecord,
    getVersionPathsForRecord, getInstalledVersionsForRecord,
    recordGameLaunchStarted, recordGamePlaytime, getEmulatorByExtension,
    // helpers
    deleteTitleRecord, isAllowedDeletionPath, getTrustedVersion,
    removeEmptyParentDirectories, normalizeForPathCompare,
    // windows
    createGameDetailsWindow,
  } = ctx

  // Attach the configurable media-source fields (banner/hero/logo + steam id)
  // to a game (or array of games) right before it leaves for the renderer.
  const withMedia = (data) => {
    const sourceOrder = getMetadataSourceOrder()
    if (Array.isArray(data)) return data.map((g) => applyMediaSources(g, { sourceOrder }))
    return applyMediaSources(data, { sourceOrder })
  }

  ipcMain.handle('add-game', async (event, game) => {
    return await addGame(game, getAssetBasePath(), process.defaultApp)
  })

  ipcMain.handle('count-versions', async (_, recordId) => {
    return await countVersions(recordId)
  })

  ipcMain.handle('delete-version', async (_, { recordId, version }) => {
    try {
      // Get version directly without isInstalled check — allow deleting broken versions
      const selectedVersion = await getVersionForRecord(recordId, version)
      if (!selectedVersion) return { success: false, error: 'Version not found' }

      const result = await deleteVersion(recordId, version)
      if (!result?.changes) return { success: false, error: 'Version was not removed' }
      emitGameUpdated(recordId)
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
    const result = await deleteGameCompletely(recordId, getAssetBasePath(), process.defaultApp)
    if (result.success) {
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) win.webContents.send('game-deleted', recordId)
      })
    }
    return result
  })

  ipcMain.handle('delete-title', async (_, { recordId, deleteFiles = false }) => {
    return await deleteTitleRecord(recordId, { deleteFiles })
  })

  ipcMain.handle('get-game', async (event, recordId) => {
    const game = await getGame(recordId, getAssetBasePath(), process.defaultApp, getMediaStorageMode())
    return withMedia(game)
  })

  ipcMain.handle('request-game-data', async (event) => {
    if (event.sender.isDestroyed()) return null
    const recordId = gameDetailsRecordMap.get(event.sender.id)
    if (recordId === undefined) {
      console.warn('request-game-data: no recordId mapped for this window')
      return null
    }
    const game = await getGame(recordId, getAssetBasePath(), process.defaultApp, getMediaStorageMode())
    if (event.sender.isDestroyed()) return null
    return withMedia(game)
  })

  ipcMain.handle('get-games', async (event, args = {}) => {
    const { offset = 0, limit = null, includeUninstalled = false, options = {} } = args
    const games = await getGames(
      getAssetBasePath(),
      process.defaultApp,
      offset,
      limit,
      {
        ...options,
        includeUninstalled,
        mediaStorageMode: getMediaStorageMode(),
      },
    )
    return withMedia(games)
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
            if (game) sender.send('game-updated', withMedia(game))
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
    try {
      const selectedVersion = await getTrustedVersion(data?.recordId, data?.version)
      const execPath = selectedVersion.exec_path || ''
      const extension = execPath.includes('.')
        ? execPath.split('.').pop().toLowerCase()
        : ''
      await launchGame({ execPath, extension, recordId: data.recordId, version: selectedVersion.version })
      return { success: true }
    } catch (err) {
      console.error('Error launching game:', err)
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

module.exports = { registerGamesHandlers, launchGame }
