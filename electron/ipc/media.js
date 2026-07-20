'use strict'

const { ipcMain, BrowserWindow, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const {
  downloadImages, buildBannerBaseName,
} = require('../imageUtils')
const { orderPreviewsBySource } = require('../db/mediaSources')
const { getSteamIDbyRecord } = require('../db/steam')
const { fetchAndStoreSteamData } = require('../scanners/steamscanner')
const { getGogIDbyRecord } = require('../db/gog')
const { fetchAndStoreGogData } = require('../scanners/gogscanner')
const { getLewdCornerIDbyRecord } = require('../db/lewdcorner')
const {
  getF95IDbyRecord, getMediaSourceCache, upsertMediaSourceCache,
} = require('../db/media')
const dbIndexForMedia = require('../db/index')
const liveMediaDb = () => dbIndexForMedia.db

const isVideoUrl = (url) => /\.(mp4|webm|m4v|mpd)(\?|#|$)/i.test(String(url || ''))

const broadcastBannerLayoutUpdated = () => {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send('banner-layout-updated')
  })
}

let sharpModule = null
function getSharp() {
  if (sharpModule) return sharpModule
  try {
    sharpModule = require('sharp')
    return sharpModule
  } catch (err) {
    const message = `Sharp image processor failed to load: ${err.message}`
    console.error(message, err)
    throw new Error(message)
  }
}

const inferMediaSource = (url) => {
  const value = String(url || '').toLowerCase()
  if (value.includes('steamstatic.com') || value.includes('/steam/apps/')) return 'steam'
  if (value.includes('f95')) return 'f95'
  if (value.includes('lewdcorner.com')) return 'lewdcorner'
  if (value.includes('atlas')) return 'atlas'
  return 'remote'
}

// ── IPC Handlers (image download helpers are in ../imageUtils.js) ─────────────

// ── IPC Handlers ─────────────────────────────────────────────────────────────

module.exports = function registerMediaHandlers(ctx) {
  const {
    getAssetBasePath, getMediaStorageMode, templatesDir, dataDir,
    getPreviews, getBanner, deleteBanner, deletePreviews,
    updateBanners, updatePreviews, getBannerUrl, getScreensUrlList,
    getRemoteBannerUrl, getRemotePreviewUrls, getSteamMovieThumbnails,
    GetAtlasIDbyRecord, firstMediaPath, getBrowsePreviewUrls,
    getAllDownloadableAssetUrlsForRecord, upsertMediaAsset,
    configPath,
    getMetadataSourceOrder,
  } = ctx

  // ── User banner-layout presets are stored as individual JSON files ──────────
  // (templates/banner-layout/<id>.json), the same way themes live in
  // templates/theme/. They used to be crammed into a single config.ini key
  // (Appearance.userBannerLayouts); migrateBannerLayoutsFromConfig() below moves
  // any legacy value out to files once, then drops the key. One file per preset
  // makes them easy to back up, hand-edit, and share via the gallery.
  const bannerLayoutTemplatesDir = path.join(dataDir, 'templates', 'banner-layout')
  try {
    if (!fs.existsSync(bannerLayoutTemplatesDir)) fs.mkdirSync(bannerLayoutTemplatesDir, { recursive: true })
  } catch (err) {
    console.error('Failed to create banner-layout templates dir:', err)
  }

  const bannerLayoutFileName = (idOrName) =>
    `${String(idOrName || 'layout')
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'layout'}.json`

  const readUserBannerLayoutFiles = () => {
    if (!fs.existsSync(bannerLayoutTemplatesDir)) return []
    const presets = []
    for (const filename of fs.readdirSync(bannerLayoutTemplatesDir).filter((f) => f.endsWith('.json'))) {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(bannerLayoutTemplatesDir, filename), 'utf8'))
        if (parsed && typeof parsed === 'object' && parsed.layout) {
          const id = parsed.id || path.basename(filename, '.json')
          presets.push({ ...parsed, id })
        } else {
          console.warn(`Skipping ${filename}: not a valid banner-layout preset`)
        }
      } catch (err) {
        console.warn(`Skipping ${filename}: ${err.message}`)
      }
    }
    presets.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
    return presets
  }

  const migrateBannerLayoutsFromConfig = () => {
    try {
      const raw = ctx.appConfig?.Appearance?.userBannerLayouts
      if (raw === undefined) return
      let legacy = []
      try { legacy = JSON.parse(raw) } catch { legacy = [] }
      if (Array.isArray(legacy)) {
        for (const preset of legacy) {
          if (!preset || !preset.id || !preset.layout) continue
          const file = path.join(bannerLayoutTemplatesDir, bannerLayoutFileName(preset.id))
          if (!fs.existsSync(file)) {
            fs.writeFileSync(file, JSON.stringify(preset, null, 2) + '\n', 'utf8')
          }
        }
      }
      // Drop the legacy key now that presets live in files.
      const ini = require('ini')
      const newConfig = { ...ctx.appConfig, Appearance: { ...ctx.appConfig.Appearance } }
      delete newConfig.Appearance.userBannerLayouts
      fs.writeFileSync(configPath, ini.stringify(newConfig))
      ctx.appConfig = newConfig
      console.log('Migrated user banner layouts from config.ini to templates/banner-layout/')
    } catch (err) {
      console.error('Banner layout migration error:', err)
    }
  }
  migrateBannerLayoutsFromConfig()

  ipcMain.handle('get-available-banner-templates', async () => {
    try {
      const builtIn = ['Default']
      if (!fs.existsSync(templatesDir)) return builtIn
      const files = fs.readdirSync(templatesDir)
        .filter(f => f.endsWith('.js'))
        .map(f => path.basename(f, '.js'))
      return [...builtIn, ...files]
    } catch (err) {
      console.error('get-available-banner-templates error:', err)
      return ['Default']
    }
  })

  ipcMain.handle('get-selected-banner-template', async () => {
    try {
      return ctx.appConfig?.Appearance?.bannerTemplate || 'Default'
    } catch {
      return 'Default'
    }
  })

  ipcMain.handle('set-selected-banner-template', async (event, template) => {
    try {
      const ini = require('ini')
      const newConfig = {
        ...ctx.appConfig,
        Appearance: { ...ctx.appConfig.Appearance, bannerTemplate: template },
      }
      fs.writeFileSync(configPath, ini.stringify(newConfig))
      ctx.appConfig = newConfig
      broadcastBannerLayoutUpdated()
      return { success: true }
    } catch (err) {
      console.error('set-selected-banner-template error:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('get-custom-banner-layout', async () => {
    try {
      const raw = ctx.appConfig?.Appearance?.customBannerLayout
      if (!raw) return null
      return JSON.parse(raw)
    } catch (err) {
      console.error('get-custom-banner-layout error:', err)
      return null
    }
  })

  ipcMain.handle('set-custom-banner-layout', async (event, layout) => {
    try {
      const ini = require('ini')
      const newConfig = {
        ...ctx.appConfig,
        Appearance: {
          ...ctx.appConfig.Appearance,
          bannerTemplate: 'custom',
          customBannerLayout: JSON.stringify(layout || {}),
        },
      }
      fs.writeFileSync(configPath, ini.stringify(newConfig))
      ctx.appConfig = newConfig
      broadcastBannerLayoutUpdated()
      return { success: true }
    } catch (err) {
      console.error('set-custom-banner-layout error:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('get-user-banner-layouts', async () => {
    try {
      return readUserBannerLayoutFiles()
    } catch (err) {
      console.error('get-user-banner-layouts error:', err)
      return []
    }
  })

  ipcMain.handle('set-user-banner-layouts', async (event, presets) => {
    try {
      const list = Array.isArray(presets) ? presets : []
      if (!fs.existsSync(bannerLayoutTemplatesDir)) fs.mkdirSync(bannerLayoutTemplatesDir, { recursive: true })
      // Write one file per preset and prune files for presets that were removed,
      // keeping the folder in sync with the incoming set.
      const keep = new Set()
      for (const preset of list) {
        if (!preset || !preset.id) continue
        const filename = bannerLayoutFileName(preset.id)
        keep.add(filename)
        fs.writeFileSync(
          path.join(bannerLayoutTemplatesDir, filename),
          JSON.stringify(preset, null, 2) + '\n',
          'utf8',
        )
      }
      for (const filename of fs.readdirSync(bannerLayoutTemplatesDir).filter((f) => f.endsWith('.json'))) {
        if (!keep.has(filename)) {
          try { fs.unlinkSync(path.join(bannerLayoutTemplatesDir, filename)) } catch (err) { console.warn(err.message) }
        }
      }
      broadcastBannerLayoutUpdated()
      return { success: true }
    } catch (err) {
      console.error('set-user-banner-layouts error:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('export-banner-layout-preset', async (event, defaultName, preset) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      const safeName = String(defaultName || 'banner-layout')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
        .replace(/\s+/g, ' ')
        .trim() || 'banner-layout'
      const result = await dialog.showSaveDialog(win, {
        defaultPath: `${safeName}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (result.canceled || !result.filePath) return { success: false, canceled: true }
      await fs.promises.writeFile(
        result.filePath,
        `${JSON.stringify(preset, null, 2)}\n`,
        'utf8',
      )
      return { success: true, filePath: result.filePath }
    } catch (err) {
      console.error('export-banner-layout-preset error:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('import-banner-layout-preset', async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      const result = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (result.canceled || !result.filePaths?.[0]) return { success: false, canceled: true }
      const raw = await fs.promises.readFile(result.filePaths[0], 'utf8')
      return { success: true, data: JSON.parse(raw), filePath: result.filePaths[0] }
    } catch (err) {
      console.error('import-banner-layout-preset error:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('get-previews', async (event, recordId) => {
    const previews = await getPreviews(recordId, getAssetBasePath(), process.defaultApp, { mode: getMediaStorageMode(), sourceOrder: getMetadataSourceOrder() })
    return orderPreviewsBySource(previews, getMetadataSourceOrder())
  })

  ipcMain.handle('get-steam-movie-thumbnails', async (event, recordId) => {
    try {
      return await getSteamMovieThumbnails(recordId)
    } catch (err) {
      console.error('get-steam-movie-thumbnails error:', err)
      return []
    }
  })

  ipcMain.handle('get-browse-preview-urls', async (event, record = {}) => {
    try {
      const urls = await getBrowsePreviewUrls({
        atlasId: record.atlasId ?? record.atlas_id,
        f95Id: record.f95Id ?? record.f95_id,
        lcId: record.lcId ?? record.lc_id ?? record.lewdCornerId ?? record.lewdcornerId,
        steamId: record.steamId ?? record.steam_id ?? record.steam_appid,
        gogId: record.gogId ?? record.gog_id ?? record.gog_appid,
        sourceOrder: getMetadataSourceOrder(),
      })
      return orderPreviewsBySource(Array.isArray(urls) ? urls : [], getMetadataSourceOrder())
    } catch (err) {
      console.error('get-browse-preview-urls error:', err)
      return []
    }
  })

  ipcMain.handle('update-banners', async (event, recordId) => {
    console.log('Handling update-banners for recordId:', recordId)
    try {
      const atlas_id = await GetAtlasIDbyRecord(recordId)
      let progress = 0
      const imageTotal = 1
      const sourceOrder = getMetadataSourceOrder()
      const steamId = await getSteamIDbyRecord(recordId)
      if (steamId) {
        await fetchAndStoreSteamData(null, steamId, ctx.appConfig?.Metadata?.steamAssetSourceOrder)
      }
      const bannerUrl = await getRemoteBannerUrl(recordId, { sourceOrder })
      const downloadResult = await downloadImages(
        recordId, atlas_id,
        (current, totalImages) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('game-details-import-progress', {
              text: `Downloading images ${current}/${totalImages}`,
              progress: current,
              total: totalImages,
            })
          }
        },
        true, false, 1, false, dataDir, async () => bannerUrl, getScreensUrlList, updateBanners, updatePreviews,
        { source: inferMediaSource(bannerUrl), bannerSource: inferMediaSource(bannerUrl) },
      )
      const bannerPath = await getBanner(recordId, getAssetBasePath(), process.defaultApp, 'large', { mode: 'download', sourceOrder })
      BrowserWindow.getAllWindows().forEach(win => { if (!win.isDestroyed()) win.webContents.send('game-updated', recordId) })
      progress++
      if (!event.sender.isDestroyed()) {
        const cleanSuccess = downloadResult.success &&
          ((downloadResult.filesWritten || 0) > 0 || (downloadResult.filesExisting || 0) > 0);
        event.sender.send('game-details-import-progress', {
          text: cleanSuccess
            ? `Downloaded banner: ${downloadResult.filesWritten} file(s) written`
            : `Banner download finished with no local files written${downloadResult.errors?.[0] ? `: ${downloadResult.errors[0]}` : ''}`,
          progress,
          total: imageTotal,
        })
      }
      return bannerPath
    } catch (err) {
      console.error('Error downloading banner:', err)
      throw err
    }
  })

  ipcMain.handle('update-previews', async (event, recordId) => {
    console.log('Handling update-previews for recordId:', recordId)
    try {
      const atlasId = await GetAtlasIDbyRecord(recordId)
      let imageTotal = 1
      const sourceOrder = getMetadataSourceOrder()
      const steamId = await getSteamIDbyRecord(recordId)
      if (steamId) {
        await fetchAndStoreSteamData(null, steamId, ctx.appConfig?.Metadata?.steamAssetSourceOrder)
      }
      const rawPreviewUrls = await getRemotePreviewUrls(recordId, { sourceOrder })
      const screenUrls = rawPreviewUrls.map((url) => ({ url, source: inferMediaSource(url) }))
      const downloadResult = await downloadImages(
        recordId, atlasId,
        (current, totalImages) => {
          imageTotal = totalImages || imageTotal
          if (!event.sender.isDestroyed()) {
            event.sender.send('game-details-import-progress', {
              text: `Downloading previews ${current}/${imageTotal}`,
              progress: current,
              total: imageTotal,
            })
          }
        },
        false, true, 'Unlimited', false, dataDir, getBannerUrl, async () => screenUrls, updateBanners, updatePreviews,
        { source: screenUrls[0]?.source || 'remote', previewSource: screenUrls[0]?.source || 'remote' },
      )
      const previewUrls = await getPreviews(recordId, getAssetBasePath(), process.defaultApp, { mode: 'download', sourceOrder })
      BrowserWindow.getAllWindows().forEach(win => { if (!win.isDestroyed()) win.webContents.send('game-updated', recordId) })
      if (!event.sender.isDestroyed()) {
        const cleanSuccess = downloadResult.success &&
          ((downloadResult.filesWritten || 0) > 0 || (downloadResult.filesExisting || 0) > 0);
        event.sender.send('game-details-import-progress', {
          text: cleanSuccess
            ? `Downloaded previews: ${downloadResult.filesWritten} file(s) written`
            : `Preview download finished with no local files written${downloadResult.errors?.[0] ? `: ${downloadResult.errors[0]}` : ''}`,
          progress: imageTotal,
          total: imageTotal,
        })
      }
      return Array.isArray(previewUrls) ? previewUrls : []
    } catch (err) {
      console.error('Error downloading previews:', err)
      throw err
    }
  })

  // Shared media-refresh core, used by both the per-game refresh (detail page)
  // and the library-wide refresh (nav "Updates"). Options:
  //   mode: 'missing' -> only fetch/download what's absent; 'all' -> overwrite.
  //   download: whether to pull images to disk (true) or leave them streamed
  //             (false). Determined by the mediaStorageMode setting.
  const refreshOneGame = async (recordId, { mode = 'all', download = false, onProgress, blockedSources, onRateLimited } = {}) => {
    const missingOnly = mode === 'missing'

    // 0) Resolve every source's id up front (cheap DB reads, run in parallel).
    //    A source with no id gets skipped entirely below — we never fetch its
    //    metadata and never try to pull its images. Existing local images for a
    //    source that has since gone away are left untouched (nothing here
    //    deletes rows or files), so they keep displaying.
    const [steamId, gogId, f95Id, lcId, atlasId] = await Promise.all([
      getSteamIDbyRecord(recordId).catch(() => null),
      getGogIDbyRecord(recordId).catch(() => null),
      getF95IDbyRecord(recordId).catch(() => null),
      getLewdCornerIDbyRecord(recordId).catch(() => null),
      GetAtlasIDbyRecord(recordId).catch(() => null),
    ])

    // 1) Re-fetch source metadata so *_data rows repopulate — but ONLY for
    //    sources that actually have an id, and (in 'missing' mode) only when the
    //    cached row looks incomplete. In 'all' mode we still skip the re-fetch
    //    when the row is already fully populated, so a plain refresh only pulls
    //    what's genuinely new instead of re-hitting every origin every time.
    //    Only Steam + GOG have live metadata scanners here; F95/LC image URLs
    //    come from their cached rows and are gated purely by id presence.
    const metadataJobs = []
    if (steamId) {
      metadataJobs.push((async () => {
        const row = await dbGetSafe(`SELECT title, header FROM steam_data WHERE steam_id = ?`, [steamId])
        // Also re-fetch when trailers are absent: older scans (and the age-gated
        // appdetails bug) left steam_movies empty even for games that have
        // title+header, so a completeness check on those two alone would never
        // repopulate trailers. Treat "no movies stored" as needing a refresh.
        const movieRow = await dbGetSafe(`SELECT COUNT(*) AS n FROM steam_movies WHERE steam_id = ?`, [steamId])
        const hasMovies = movieRow && movieRow.n > 0
        const needsSteam = !row || !row.title || !row.header || !hasMovies || mode === 'all'
        if (needsSteam) {
          try { await fetchAndStoreSteamData(null, steamId, ctx.appConfig?.Metadata?.steamAssetSourceOrder) }
          catch (e) { console.warn(`refresh: steam fetch failed for ${steamId}:`, e.message) }
        }
      })())
    }
    if (gogId) {
      metadataJobs.push((async () => {
        const row = await dbGetSafe(`SELECT title, header, overview, store_url FROM gog_data WHERE gog_id = ?`, [gogId])
        const needsGog = !row || !row.title || !row.header || !row.overview || !row.store_url
        if (needsGog) {
          try { await fetchAndStoreGogData(null, gogId) }
          catch (e) { console.warn(`refresh: gog fetch failed for ${gogId}:`, e.message) }
        }
      })())
    }
    // Steam + GOG metadata fetches are independent origins — run concurrently.
    if (metadataJobs.length) await Promise.all(metadataJobs)

    const sourceOrder = getMetadataSourceOrder()
    const bannerUrl = await getRemoteBannerUrl(recordId, { sourceOrder })
    const rawPreviewUrls = await getRemotePreviewUrls(recordId, { sourceOrder })
    const screenUrls = rawPreviewUrls
      .map((url) => String(url || '').trim())
      .filter(Boolean)
      .filter((url) => !isVideoUrl(url))
      .map((url) => ({ url, source: inferMediaSource(url) }))

    // 2) Images: only pull to disk when the setting says 'download'. When
    //    streaming, we skip downloadImages entirely and let the *_data URLs be
    //    served directly (previews still come back via getPreviews below).
    if (download) {
      // In 'missing' mode, skip the download when the banner + previews are
      // already present on disk for this record.
      let doDownload = true
      if (missingOnly) {
        const hasBanner = await hasLocalBanner(recordId)
        const hasPreviews = await hasLocalPreviews(recordId)
        doDownload = !hasBanner || !hasPreviews
      }
      if (doDownload) {
        const additionalAssets = (await getAllDownloadableAssetUrlsForRecord(recordId, { downloadVideos: false, sourceOrder }))
          .filter((asset) => asset.targetKind !== 'preview' && asset.url !== bannerUrl)
        await downloadImages(
          recordId,
          atlasId || steamId || gogId || recordId,
          (current, totalImages) => { if (onProgress) onProgress(current, totalImages) },
          Boolean(bannerUrl),
          screenUrls.length > 0,
          'Unlimited',
          false,
          dataDir,
          async () => bannerUrl,
          async () => screenUrls,
          updateBanners,
          updatePreviews,
          {
            source: inferMediaSource(bannerUrl),
            additionalAssets,
            upsertMediaAsset,
            getMediaSourceCache,
            upsertMediaSourceCache,
            blockedSources,
            onRateLimited,
          },
        )
      }
    }

    const previewUrls = orderPreviewsBySource(
      await getPreviews(recordId, getAssetBasePath(), process.defaultApp, { mode: getMediaStorageMode(), sourceOrder }),
      sourceOrder,
    )
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) win.webContents.send('game-updated', recordId)
    })
    return { success: true, previewUrls }
  }

  // Small promise helpers scoped to this handler set.
  const dbGetSafe = (sql, params) => new Promise((resolve) => {
    try {
      liveMediaDb().get(sql, params, (err, row) => resolve(err ? null : row || null))
    } catch { resolve(null) }
  })
  const hasLocalBanner = async (recordId) => {
    const row = await dbGetSafe(
      `SELECT 1 FROM media_assets WHERE record_id = ? AND asset_type LIKE '%banner%' LIMIT 1`, [recordId])
    return !!row
  }
  const hasLocalPreviews = async (recordId) => {
    const row = await dbGetSafe(
      `SELECT 1 FROM media_assets WHERE record_id = ? AND asset_type LIKE '%preview%' LIMIT 1`, [recordId])
    return !!row
  }

  // Whether the user's saved setting wants images downloaded to disk.
  const shouldDownloadImages = () => getMediaStorageMode() === 'download'

  ipcMain.handle('refresh-game-media', async (event, arg) => {
    // Back-compat: old callers pass a bare recordId; new callers pass
    // { recordId, mode }.
    const recordId = (arg && typeof arg === 'object') ? arg.recordId : arg
    const mode = (arg && typeof arg === 'object' && arg.mode) ? arg.mode : 'all'
    try {
      const result = await refreshOneGame(recordId, {
        mode,
        download: shouldDownloadImages(),
        onProgress: (current, totalImages) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('game-details-import-progress', {
              text: `Downloading media assets ${current}/${totalImages}`,
              progress: current,
              total: totalImages,
            })
          }
        },
      })
      return { success: result.success, previewUrls: result.previewUrls }
    } catch (err) {
      console.error('refresh-game-media error:', err)
      return { success: false, error: err.message }
    }
  })

  // Library-wide media refresh (nav "Updates" flow). Iterates every record id,
  // applying the same per-game refresh with the chosen mode + the saved
  // download setting, and emits progress so the UI can show a bar.
  ipcMain.handle('refresh-media-library', async (event, arg = {}) => {
    const mode = arg.mode === 'missing' ? 'missing' : 'all'
    try {
      const recordIds = await new Promise((resolve, reject) => {
        liveMediaDb().all(`SELECT record_id FROM games`, [], (err, rows) =>
          err ? reject(err) : resolve((rows || []).map((r) => r.record_id)))
      })
      const download = shouldDownloadImages()
      const total = recordIds.length
      let processed = 0
      const emit = (text) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('refresh-media-progress', { text, processed, total })
        }
      }
      emit(`Refreshing media for ${total} games…`)
      // Shared across the whole refresh run: once a source is rate-limited we
      // stop pulling from it and notify the user, but keep going with the rest.
      const blockedSources = new Set()
      const onRateLimited = (source, retryAfterMs) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('media-rate-limited', { source, retryAfterMs })
        }
      }
      for (const recordId of recordIds) {
        try {
          await refreshOneGame(recordId, { mode, download, blockedSources, onRateLimited })
        } catch (e) {
          console.warn(`refresh-media-library: game ${recordId} failed:`, e.message)
        }
        processed++
        if (processed % 3 === 0 || processed === total) {
          emit(`Refreshed ${processed}/${total} games…`)
        }
      }
      emit(`Media refresh complete (${processed}/${total}).`)
      return { success: true, processed, total }
    } catch (err) {
      console.error('refresh-media-library error:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('delete-banner', async (event, recordId) => {
    return await deleteBanner(recordId, getAssetBasePath(), process.defaultApp)
  })

  ipcMain.handle('delete-previews', async (event, recordId) => {
    return await deletePreviews(recordId, getAssetBasePath(), process.defaultApp)
  })

  ipcMain.handle('convert-and-save-banner', async (event, { recordId, filePath }) => {
    console.log('Handling convert-and-save-banner for recordId:', recordId)
    try {
      if (!recordId) throw new Error('Missing recordId')
      if (!filePath || typeof filePath !== 'string') throw new Error('No banner file selected')
      const sourcePath = path.resolve(filePath)
      if (!fs.existsSync(sourcePath)) throw new Error(`Selected banner does not exist: ${sourcePath}`)
      const stat = await fs.promises.stat(sourcePath)
      if (!stat.isFile()) throw new Error('Selected banner path is not a file')

      const imageDir = path.join(dataDir, 'images', String(recordId))
      await fs.promises.mkdir(imageDir, { recursive: true })

      const customBaseName = buildBannerBaseName('custom')
      const relativeBasePath = path.join('data', 'images', String(recordId), customBaseName)
      const mediumPath = path.join(imageDir, `${customBaseName}_mc.webp`)
      const smallPath = path.join(imageDir, `${customBaseName}_sc.webp`)

      const normalizedSource = path.resolve(sourcePath).toLowerCase()
      if (normalizedSource === path.resolve(mediumPath).toLowerCase() ||
          normalizedSource === path.resolve(smallPath).toLowerCase()) {
        throw new Error('Selected banner is already the saved Atlas banner. Choose a different source file.')
      }

      const sharp = getSharp()
      const imageBytes = await fs.promises.readFile(sourcePath)
      await sharp(imageBytes).webp({ quality: 90 }).resize({ width: 1260, withoutEnlargement: true }).toFile(mediumPath)
      await sharp(imageBytes).webp({ quality: 90 }).resize({ width: 600, withoutEnlargement: true }).toFile(smallPath)

      await updateBanners(recordId, `${relativeBasePath}_mc.webp`, 'small')
      await updateBanners(recordId, `${relativeBasePath}_sc.webp`, 'large')

      const bannerPath = await getBanner(recordId, getAssetBasePath(), process.defaultApp, 'large', 'download')

      BrowserWindow.getAllWindows().forEach(win => { if (!win.isDestroyed()) win.webContents.send('game-updated', recordId) })
      if (!event.sender.isDestroyed()) {
        event.sender.send('game-details-import-progress', { text: 'Custom banner saved', progress: 1, total: 1 })
      }
      return firstMediaPath(bannerPath)
    } catch (err) {
      console.error('Error converting and saving banner:', err)
      if (!event.sender.isDestroyed()) {
        event.sender.send('game-details-import-progress', {
          text: `Failed to save custom banner: ${err.message}`,
          progress: 0, total: 1,
        })
      }
      throw err
    }
  })
}
