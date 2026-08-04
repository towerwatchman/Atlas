'use strict'

const { ipcMain, BrowserWindow, shell } = require('electron')
const { BROWSE_MODE_ENABLED } = require('../features')
const path = require('path')
const fs = require('fs')
const cp = require('child_process')
const { recordGameLaunchStarted, recordGamePlaytime, getLibraryStats } = require('../db/games')
// Required directly rather than pulled from the ctx bundle: that bundle
// re-exports a curated list, so adding exports to db/games.js alone left these
// undefined and set-tag-override failed with "getTagState is not a function"
// AFTER already writing the override.
const { getTagState, clearTagOverride, getKnownTags, bulkEditTags } = require('../db/tagOverrides')
const { sanitizeChildEnv, resolveLinuxLaunch, resolveEmulatorLaunch } = require('../launchEnv')
const { getEmulatorByExtension } = require('../db/settings')
const { getSteamIDbyRecord } = require('../db/steam')
const { getGogIDbyRecord, addGogMapping } = require('../db/gog')
const { fetchAndStoreGogData } = require('../scanners/gogscanner')
const { applyMediaSources } = require('../db/mediaSources')
const { calculatePathSize } = require('../pathSize')
const { runDatabaseAudit, getInvalidMappingCount } = require('../db/audit')
const { getCatalogIndexStatus, rebuildCatalogIndex } = require('../db/catalogIndex')
const { runClientAudit, repairClientAuditSection } = require('../db/clientAudit')
const { auditSeasonMerges, applySeasonMerge, applyAllSeasonMerges } = require('../db/seasonMerge')

// Guards against two full rebuilds interleaving their chunked transactions on
// the single shared sqlite connection.
let catalogIndexRebuildInFlight = false
// Repairs mutate shared tables and VACUUM takes an exclusive lock, so only one
// may run at a time.
let clientAuditRepairInFlight = false

function emitGameUpdated(recordId) {
  if (!recordId) return
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send('game-updated', recordId)
  })
}

// ── Running-game tracking ──────────────────────────────────────────────────
// The detail page's PLAY button used to infer "the game closed" from the
// game-updated event, but startPlaySession fires game-updated at launch *start*
// (to refresh last_played), so the button flipped to RUNNING and straight back
// to PLAY. These broadcasts are now the single source of truth for that button.
const runningSessions = new Map()
const runKey = (recordId, version) => `${recordId}::${version ?? ''}`

// Steam/GOG handoffs and shell.openPath launches give us no child process, so
// there's no exit to observe. Hold RUNNING briefly for feedback, then release it
// so the user isn't locked out of relaunching.
const UNTRACKED_RUN_STATE_MS = 20000

function broadcastRunState(recordId, version, running, tracked) {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send('game-run-state', { recordId, version, running, tracked })
    }
  })
}

function getRunningGames() {
  return [...runningSessions.values()].map(({ recordId, version, tracked, startedAtMs }) => ({
    recordId, version, tracked, startedAtMs,
  }))
}

async function startPlaySession(recordId, version, trackPlaytime = true) {
  if (!recordId || !version) return null
  const startedAtMs = Date.now()
  const startedAtSeconds = Math.floor(startedAtMs / 1000)
  await recordGameLaunchStarted(recordId, version, startedAtSeconds)
  emitGameUpdated(recordId)

  const key = runKey(recordId, version)
  const previous = runningSessions.get(key)
  if (previous?.expiry) clearTimeout(previous.expiry)
  const entry = { recordId, version, tracked: trackPlaytime, startedAtMs, expiry: null }
  runningSessions.set(key, entry)
  // Sent after emitGameUpdated so a renderer refresh can't clobber it.
  broadcastRunState(recordId, version, true, trackPlaytime)

  const release = () => {
    if (runningSessions.get(key) !== entry) return
    if (entry.expiry) clearTimeout(entry.expiry)
    runningSessions.delete(key)
    broadcastRunState(recordId, version, false, trackPlaytime)
  }

  if (!trackPlaytime) {
    entry.expiry = setTimeout(release, UNTRACKED_RUN_STATE_MS)
    if (typeof entry.expiry.unref === 'function') entry.expiry.unref()
  }

  return {
    release,
    finish: async () => {
      release()
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
    // No playtime worth recording, but the run state still has to be released or
    // the PLAY button stays stuck on RUNNING for the rest of the session.
    session.release?.()
  })
}

const isSteamInstallPath = (value) =>
  /(?:^|[\\/])steamapps[\\/]common(?:[\\/]|$)/i.test(String(value || ''))

/**
 * Spawn a tracked child.
 *
 * The play session is opened BEFORE the spawn. It used to be awaited after, and
 * that await performs database writes, so it yields: a child that exited during
 * it fired 'exit' before trackChildPlaySession attached a listener, the exit was
 * lost, playtime went unrecorded and the PLAY button stayed on RUNNING forever.
 * Rare on Windows, routine on Linux where a bad exec fails instantly.
 *
 * The environment is sanitised for every spawn. Under deb and pacman that is a
 * no-op; under AppImage it removes the AppDir paths AppRun injected, which would
 * otherwise hand the game Electron's bundled libraries.
 */
async function spawnTrackedGame(command, args, { recordId, version, cwd, shell = false }) {
  const session = await startPlaySession(recordId, version, true)
  try {
    const child = cp.spawn(command, args, {
      cwd,
      detached: true,
      stdio: 'ignore',
      shell,
      env: sanitizeChildEnv(process.env),
    })
    trackChildPlaySession(child, session, recordId)
    child.unref()
    return child
  } catch (err) {
    // Spawn threw synchronously, so no exit will ever arrive to release it.
    session?.release?.()
    throw err
  }
}

async function launchGame({ execPath, gamePath, extension, recordId, version, source, sourceAppId }) {
  const hasExecutable = !!execPath && fs.existsSync(execPath)
  // Source-aware Steam launch: a version tagged source='steam' (or one sitting
  // in a steamapps/common path) launches via the Steam client. Prefer the
  // version's own appid so the right title launches even when the record holds
  // multiple sources.
  if (!hasExecutable && recordId && (source === 'steam' || isSteamInstallPath(gamePath))) {
    const steamId = String(sourceAppId || '').trim() || await getSteamIDbyRecord(recordId)
    if (steamId) {
      await startPlaySession(recordId, version, false)
      shell.openExternal(`steam://run/${steamId}`)
      return
    }
  }
  // GOG launch: when there's no local executable, hand off to GOG Galaxy via its
  // protocol handler so installed GOG games launch the same way Steam ones do.
  if (!hasExecutable && recordId) {
    const gogId = await getGogIDbyRecord(recordId)
    if (gogId) {
      await startPlaySession(recordId, version, false)
      shell.openExternal(`goggalaxy://openGameView/${gogId}`)
      return
    }
  }
  if (!hasExecutable) {
    throw new Error(`Executable not found: ${execPath}`)
  }
  const emulator = await getEmulatorByExtension(extension)
  if (emulator) {
    // The general wrapper mechanism: Wine, Proton, an interpreter, anything. It
    // is checked first so a configured launcher always beats built-in handling.
    const plan = resolveEmulatorLaunch({ emulator, execPath })
    if (plan.error) throw new Error(plan.error)
    await spawnTrackedGame(plan.command, plan.args, {
      recordId,
      version,
      // Previously omitted, so an emulated game inherited Atlas's own working
      // directory — /opt/Atlas on a package install, or the read-only AppImage
      // mount. Ren'Py, Unity and RPG Maker resolve their assets relative to cwd,
      // so under Wine they simply failed to find their data.
      cwd: path.dirname(execPath),
    })
  } else if (process.platform === 'linux') {
    // shell.openPath on Linux goes through xdg-open/KIO, which refuses to
    // execute binaries, so the child has to be spawned directly. resolveLinuxLaunch
    // adds a missing execute bit (archives built on Windows carry no Unix mode,
    // so an extracted Game.sh arrives at 0644) and routes Windows builds through
    // Wine, reporting a readable error when Wine is absent.
    const plan = resolveLinuxLaunch({ execPath, extension })
    if (plan.error) throw new Error(plan.error)
    if (plan.madeExecutable) {
      console.log(`Added the execute bit to ${execPath}`)
    }
    await spawnTrackedGame(plan.command, plan.args, {
      recordId,
      version,
      // Ren'Py, Unity and RPG Maker all resolve assets relative to the working
      // directory, so this is required rather than tidiness. Under Wine the cwd
      // is still the game folder, not Wine's.
      cwd: path.dirname(execPath),
    })
  } else if (['exe', 'bat', 'cmd'].includes(extension)) {
    await spawnTrackedGame(execPath, [], {
      recordId,
      version,
      cwd: path.dirname(execPath),
      shell: extension === 'bat' || extension === 'cmd',
    })
  } else {
    const openResult = await shell.openPath(execPath)
    if (openResult) throw new Error(openResult)
    await startPlaySession(recordId, version, false)
  }
}

function registerGamesHandlers(ctx) {
  const {
    getAssetBasePath, getMediaStorageMode, appConfig, configPath,
    gameDetailsRecordMap,
    getMetadataSourceOrder,
    // db functions
    addGame, getGame, getGames, getCatalogGames, getGameRecordIds, removeGame, updateGame,
    addWishlistEntry, removeWishlistEntry, toggleWishlistEntry, isWishlistEntry,
    getWishlistEntries, getWishlistEntryIdentities,
    upsertVersion, updateVersion, deleteGameCompletely, getUniqueFilterOptions,
    updateFolderSize, countVersions, deleteVersion, getVersionForRecord,
    getVersionPathsForRecord, getInstalledVersionsForRecord,
    recordGameLaunchStarted, recordGamePlaytime, setGameFavorite, setGamePlaystate, setVersionPlaystate, setGamePersonalRatings, setSelectedGameVersion, getEmulatorByExtension,
    getManualMappings, setManualMappings, addSteamMapping,
    getGameOverrides, clearGameOverrides, validateGameMetadataOverrides,
    takeStartupRepairSummary,
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

  // Cheap probe so the renderer can show a spinner with a real count instead of
  // an empty-library message while get-games is still running.
  ipcMain.handle('get-library-stats', async () => {
    try {
      return await getLibraryStats()
    } catch (err) {
      console.error('get-library-stats error:', err)
      return { games: 0, versions: 0, pathVersions: 0, ok: false }
    }
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

  ipcMain.handle('set-game-favorite', async (_, { recordId, isFavorite } = {}) => {
    const result = await setGameFavorite(recordId, isFavorite === true)
    if (result?.success) emitGameUpdated(result.recordId)
    return result
  })

  ipcMain.handle('set-game-playstate', async (_, { recordId, playstate } = {}) => {
    const result = await setGamePlaystate(recordId, playstate)
    if (result?.success) emitGameUpdated(result.recordId)
    return result
  })

  ipcMain.handle('set-version-playstate', async (_, { recordId, versionId, playstate } = {}) => {
    const result = await setVersionPlaystate(recordId, versionId, playstate)
    if (result?.success) emitGameUpdated(result.recordId)
    return result
  })

  ipcMain.handle('set-game-personal-ratings', async (_, { recordId, ratings } = {}) => {
    const result = await setGamePersonalRatings(recordId, ratings || {})
    if (result?.success) emitGameUpdated(result.recordId)
    return result
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

  ipcMain.handle('get-catalog-games', async (event, args = {}) => {
    if (!BROWSE_MODE_ENABLED) {
      return { games: [], offset: 0, hasMore: false, total: 0 }
    }
    const rawOffset = Number.parseInt(args?.offset, 10)
    const rawLimit = Number.parseInt(args?.limit, 10)
    const offset = Number.isInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0
    const limit = Number.isInteger(rawLimit)
      ? Math.min(1000, Math.max(50, rawLimit))
      : 250
    const result = await getCatalogGames(
      getAssetBasePath(),
      process.defaultApp,
      {
        ...(args?.options || {}),
        offset,
        limit,
        includeTotal: args?.includeTotal === true,
        filters: args?.filters || {},
        search: args?.search || {},
        mediaStorageMode: getMediaStorageMode(),
      },
    )
    if (Array.isArray(result)) return withMedia(result)
    return { ...result, games: withMedia(result.games || []) }
  })

  // Count-only variant of get-catalog-games — runs just the COUNT query,
  // skipping the (minimum 50-row) page fetch entirely. Used by the saved
  // filters panel to show how many catalog entries a filter would actually
  // match while in Browse mode, without paying for full rows it won't use.
  ipcMain.handle('get-catalog-count', async (event, args = {}) => {
    if (!BROWSE_MODE_ENABLED) return { total: 0 }
    const result = await getCatalogGames(
      getAssetBasePath(),
      process.defaultApp,
      {
        ...(args?.options || {}),
        offset: 0,
        limit: 50,
        countOnly: true,
        filters: args?.filters || {},
        search: args?.search || {},
        mediaStorageMode: getMediaStorageMode(),
      },
    )
    return { total: Number(result?.total || 0) }
  })

  ipcMain.handle('wishlist-add', async (_, entry = {}) => {
    return await addWishlistEntry(entry)
  })

  ipcMain.handle('wishlist-remove', async (_, identity = {}) => {
    return await removeWishlistEntry(identity)
  })

  ipcMain.handle('wishlist-toggle', async (_, entry = {}) => {
    return await toggleWishlistEntry(entry)
  })

  ipcMain.handle('wishlist-check', async (_, identity = {}) => {
    return await isWishlistEntry(identity)
  })

  ipcMain.handle('wishlist-list', async () => {
    return withMedia(await getWishlistEntries())
  })

  ipcMain.handle('wishlist-identities', async () => {
    return await getWishlistEntryIdentities()
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

  // Edits from the game properties window. recordBaseEdits is what distinguishes
  // a user edit from the importer/scanner writes that also call updateGame():
  // only a user edit should mark Title/Engine/Developer as changed.
  //
  // (The previous getAssetBasePath()/process.defaultApp arguments here were
  // vestigial — updateGame has never read a second or third positional arg.)
  ipcMain.handle('update-game', async (event, game) => {
    return await updateGame(game, { recordBaseEdits: true })
  })

  ipcMain.handle('update-version', async (event, version, record_id) => {
    try {
      const result = await updateVersion(version, record_id)
      emitGameUpdated(record_id)
      return { success: true, ...result }
    } catch (err) {
      console.error('update-version failed:', err)
      return { success: false, error: err.message || 'Failed to update version' }
    }
  })

  ipcMain.handle('set-selected-game-version', async (event, { recordId, versionId }) => {
    try {
      return await setSelectedGameVersion(recordId, versionId)
    } catch (err) {
      console.error('set-selected-game-version failed:', err)
      return { success: false, error: err.message || 'Failed to save selected version' }
    }
  })

  ipcMain.handle('recalculate-version-size', async (event, { recordId, version, gamePath }) => {
    try {
      if (!recordId || !version || !gamePath) {
        return { success: false, error: 'Missing version path details' }
      }
      const result = await calculatePathSize(gamePath)
      if (result.missing) {
        return { success: false, missing: true, error: 'Path is missing' }
      }
      await updateFolderSize(recordId, version, result.sizeBytes || 0)
      emitGameUpdated(recordId)
      return {
        success: true,
        folder_size: result.sizeBytes || 0,
        warnings: result.errors || [],
      }
    } catch (err) {
      console.error('recalculate-version-size failed:', err)
      return { success: false, error: err.message }
    }
  })

  // Both of these read ctx.appConfig rather than the destructured `appConfig`
  // snapshot: saving settings replaces ctx.appConfig wholesale, so the snapshot
  // goes stale the moment the games folder is set.
  ipcMain.handle('get-default-game-folder', async () => {
    return (ctx.appConfig || appConfig)?.Library?.gameFolder || ''
  })

  ipcMain.handle('set-default-game-folder', async (event, newPath) => {
    const ini = require('ini')
    const currentConfig = ctx.appConfig || appConfig || {}
    const newConfig = { ...currentConfig, Library: { ...currentConfig.Library, gameFolder: newPath } }
    fs.writeFileSync(configPath, ini.stringify(newConfig))
    ctx.appConfig = newConfig
    return { success: true }
  })

  // Lets a window that mounts while a game is already running show RUNNING
  // instead of PLAY (e.g. navigating away from the detail page and back).
  ipcMain.handle('get-running-games', async () => getRunningGames())

  // ── Tag overrides ────────────────────────────────────────────────────────
  // Tags come from the catalog; a user can add to and remove from that list.
  // Their edit is stored as a snapshot and wins until reset, which restores the
  // catalog list. get-tag-state also returns catalogTags so the UI can show
  // what a reset would go back to, and can seed the editor from the DB list.
  ipcMain.handle('get-tag-state', async (event, recordId) => {
    try {
      return await getTagState(recordId)
    } catch (err) {
      console.error('get-tag-state failed:', err)
      return { recordId, tags: [], catalogTags: [], overridden: false, added: [], removed: [] }
    }
  })

  ipcMain.handle('set-tag-override', async (event, { recordId, tags } = {}) => {
    try {
      // Routed through updateGame so tag_mappings is rebuilt in the same step;
      // the filter sidebar and library query both read tag_mappings, so writing
      // the override alone would leave search disagreeing with the detail page.
      await updateGame({ record_id: recordId, tags })
      emitGameUpdated(recordId)
      return { success: true, ...(await getTagState(recordId)) }
    } catch (err) {
      console.error('set-tag-override failed:', err)
      return { success: false, error: err.message }
    }
  })

  // Autocomplete source. Cached per call is fine: the list is small and this is
  // only hit when a tag field is focused.
  ipcMain.handle('get-known-tags', async () => {
    try {
      return await getKnownTags()
    } catch (err) {
      console.error('get-known-tags failed:', err)
      return []
    }
  })

  ipcMain.handle('bulk-edit-tags', async (event, { recordIds, add, remove } = {}) => {
    try {
      const result = await bulkEditTags(recordIds || [], { add, remove })
      if (result.success) {
        // tag_mappings drives filtering, so rebuild it for each record that
        // actually changed, then let every window refresh.
        for (const entry of result.results) {
          if (!entry.changed) continue
          await updateGame({ record_id: entry.recordId, tags: entry.tags })
          emitGameUpdated(entry.recordId)
        }
      }
      return result
    } catch (err) {
      console.error('bulk-edit-tags failed:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('reset-tag-override', async (event, recordId) => {
    try {
      const catalogTags = await clearTagOverride(recordId)
      // Rebuild tag_mappings from the catalog list so filters follow the reset.
      await updateGame({ record_id: recordId, f95_tags: catalogTags.join(', ') })
      emitGameUpdated(recordId)
      return { success: true, ...(await getTagState(recordId)) }
    } catch (err) {
      console.error('reset-tag-override failed:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('launch-game', async (event, data) => {
    try {
      const selectedVersion = await getTrustedVersion(data?.recordId, data?.version)
      const execPath = selectedVersion.exec_path || ''
      const gamePath = selectedVersion.game_path || ''
      const extension = execPath.includes('.')
        ? execPath.split('.').pop().toLowerCase()
        : ''
      await launchGame({
        execPath, gamePath, extension,
        recordId: data.recordId,
        version: selectedVersion.version,
        source: selectedVersion.source || null,
        sourceAppId: selectedVersion.source_app_id || null,
      })
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

  ipcMain.handle('open-game-image-folder', async (event, recordId) => {
    try {
      const id = String(recordId ?? '').trim()
      if (!/^\d+$/.test(id)) {
        return { success: false, error: 'A valid game record ID is required.' }
      }

      const imagesRoot = path.resolve(getAssetBasePath(), 'data', 'images')
      const folderPath = path.resolve(imagesRoot, id)
      const relativePath = path.relative(imagesRoot, folderPath)
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        return { success: false, error: 'Resolved image folder is outside the media cache.' }
      }

      await fs.promises.mkdir(folderPath, { recursive: true })
      const openError = await shell.openPath(folderPath)
      if (openError) return { success: false, error: openError }
      return { success: true, path: folderPath }
    } catch (err) {
      return { success: false, error: err.message || String(err) }
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

  // ── Browse catalog index ──────────────────────────────────────────────────
  // Browse filters and sorts against catalog_index rather than the four-branch
  // union, which is what makes the always-on newest-first sort answerable from
  // an index instead of a 32k-row temp b-tree. Status is polled by the renderer
  // so Browse can show build progress instead of an empty grid.
  ipcMain.handle('get-catalog-index-status', async () => {
    try {
      return { success: true, ...(await getCatalogIndexStatus()) }
    } catch (err) {
      console.error('get-catalog-index-status error:', err)
      return { success: false, error: err.message, ready: false }
    }
  })

  // Manual full rebuild (Settings -> Database). Chunked and yielding, so the
  // library stays usable while it runs; progress is streamed to every open
  // window rather than returned, since a large catalog takes a few seconds.
  ipcMain.handle('rebuild-catalog-index', async () => {
    if (catalogIndexRebuildInFlight) {
      return { success: false, error: 'A catalog index rebuild is already running.' }
    }
    catalogIndexRebuildInFlight = true
    try {
      const summary = await rebuildCatalogIndex({
        onProgress: (payload) => {
          BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.isDestroyed()) win.webContents.send('catalog-index-progress', payload)
          })
        },
      })
      return { success: true, ...summary }
    } catch (err) {
      console.error('rebuild-catalog-index error:', err)
      return { success: false, error: err.message }
    } finally {
      catalogIndexRebuildInFlight = false
    }
  })

  // ── Full client check ─────────────────────────────────────────────────────
  // Read-only. Returns one entry per section with its findings and, where a
  // repair exists, a `willChange` list so the UI can state the effect before the
  // user approves it. Nothing is modified until repair-client-audit-section is
  // called with a specific section id.
  ipcMain.handle('run-client-audit', async () => {
    try {
      return { success: true, ...(await runClientAudit(ctx)) }
    } catch (err) {
      console.error('run-client-audit error:', err)
      return { success: false, error: err.message, sections: [] }
    }
  })

  ipcMain.handle('repair-client-audit-section', async (event, sectionId) => {
    if (clientAuditRepairInFlight) {
      return { success: false, error: 'Another repair is already running.' }
    }
    clientAuditRepairInFlight = true
    try {
      const result = await repairClientAuditSection(String(sectionId || ''), ctx, {
        onProgress: (payload) => {
          BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.isDestroyed()) win.webContents.send('catalog-index-progress', payload)
          })
        },
      })
      console.log(`client audit repair [${sectionId}]:`, (result.changes || []).join('; ') || 'no changes')
      return { success: true, section: sectionId, ...result }
    } catch (err) {
      console.error(`repair-client-audit-section (${sectionId}) error:`, err)
      return { success: false, error: err.message }
    } finally {
      clientAuditRepairInFlight = false
    }
  })

  ipcMain.handle('run-db-audit', async () => {
    try {
      return { success: true, ...(await runDatabaseAudit()) }
    } catch (err) {
      console.error('run-db-audit error:', err)
      return { success: false, error: err.message, items: [], summary: { removed: 0, orphaned: 0, unmapped: 0 }, total: 0 }
    }
  })

  // Season/version merge: find and fold multiple local records that share one
  // atlas_id into a single record whose versions carry per-source identity.
  ipcMain.handle('audit-season-merges', async () => {
    try {
      return { success: true, ...(await auditSeasonMerges()) }
    } catch (err) {
      console.error('audit-season-merges error:', err)
      return { success: false, error: err.message, items: [], total: 0 }
    }
  })

  ipcMain.handle('apply-season-merge', async (event, data) => {
    try {
      const atlasId = data?.atlasId
      const survivorRecordId = data?.survivorRecordId ?? null
      if (atlasId == null) throw new Error('atlasId is required')
      return { success: true, ...(await applySeasonMerge(atlasId, survivorRecordId)) }
    } catch (err) {
      console.error('apply-season-merge error:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('apply-all-season-merges', async () => {
    try {
      return { success: true, ...(await applyAllSeasonMerges()) }
    } catch (err) {
      console.error('apply-all-season-merges error:', err)
      return { success: false, error: err.message, results: [], total: 0 }
    }
  })

  ipcMain.handle('get-invalid-mapping-count', async () => {
    try {
      return { success: true, count: await getInvalidMappingCount() }
    } catch (err) {
      console.error('get-invalid-mapping-count error:', err)
      return { success: false, error: err.message, count: 0 }
    }
  })

  ipcMain.handle('get-manual-mappings', async (event, recordId) => {
    try {
      return { success: true, mappings: await getManualMappings(recordId) }
    } catch (err) {
      console.error('get-manual-mappings error:', err)
      return { success: false, error: err.message, mappings: {} }
    }
  })

  ipcMain.handle('set-manual-mappings', async (event, { recordId, mappings } = {}) => {
    try {
      const saved = await setManualMappings(recordId, mappings)
      // Keep Steam art/metadata linkage working when a Steam id is set
      // manually — the blob is the record of what the user typed, but Steam
      // data joins through steam_mappings elsewhere.
      const steamId = Number.parseInt(saved.steam_appid ?? saved.steam_id, 10)
      if (Number.isInteger(steamId) && steamId > 0 && typeof addSteamMapping === 'function') {
        try { await addSteamMapping(recordId, steamId) } catch (e) { console.warn('addSteamMapping (manual) failed:', e.message) }
      }
      // GOG: same pattern — persist the mapping so art/metadata joins through
      // gog_mappings, then fetch metadata so the details page fills in the box
      // art, description, developer, etc. right away.
      const gogId = Number.parseInt(saved.gog_id ?? saved.gog_appid, 10)
      if (Number.isInteger(gogId) && gogId > 0) {
        try { await addGogMapping(recordId, gogId) } catch (e) { console.warn('addGogMapping (manual) failed:', e.message) }
        try { await fetchAndStoreGogData(null, gogId) } catch (e) { console.warn('fetchAndStoreGogData (manual) failed:', e.message) }
      }
      return { success: true, mappings: saved }
    } catch (err) {
      console.error('set-manual-mappings error:', err)
      return { success: false, error: err.message }
    }
  })

  // Which metadata fields carry a user override, and what each field would fall
  // back to if that override were cleared. Drives the custom-value markers and
  // per-field revert in the game properties window.
  ipcMain.handle('get-game-overrides', async (event, recordId) => {
    try {
      return await getGameOverrides(recordId)
    } catch (err) {
      console.error('get-game-overrides error:', err)
      return { recordId, fields: [], overriddenCount: 0, error: err.message }
    }
  })

  // Clear specific overrides (pass `fields`) or every override for the title.
  ipcMain.handle('clear-game-overrides', async (event, { recordId, fields = null } = {}) => {
    try {
      const result = await clearGameOverrides(recordId, fields)
      if (result?.success) emitGameUpdated(recordId)
      return result
    } catch (err) {
      console.error('clear-game-overrides error:', err)
      return { success: false, error: err.message, cleared: [] }
    }
  })

  // One-shot: what the startup custom-metadata repair changed, if anything.
  // Returns null when there is nothing to report. Reading it clears it, so the
  // renderer shows the notice once per launch.
  ipcMain.handle('get-startup-repair-summary', async () => {
    try {
      return typeof takeStartupRepairSummary === 'function' ? takeStartupRepairSummary() : null
    } catch (err) {
      console.error('get-startup-repair-summary error:', err)
      return null
    }
  })

  // Library-wide audit of the custom metadata table. Pass dryRun to get the
  // report without writing anything.
  ipcMain.handle('validate-game-overrides', async (event, { dryRun = false } = {}) => {
    try {
      const summary = await validateGameMetadataOverrides({ dryRun })
      return { success: true, summary }
    } catch (err) {
      console.error('validate-game-overrides error:', err)
      return { success: false, error: err.message }
    }
  })
}

module.exports = { registerGamesHandlers, launchGame }
