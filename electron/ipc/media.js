'use strict'

const { ipcMain, BrowserWindow, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const axios = require('axios')
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
  nextCreatedAt,
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
    getSteamBrowseMediaForAppId,
    getAllDownloadableAssetUrlsForRecord, upsertMediaAsset,
    configPath,
    getMetadataSourceOrder,
    insertPreviewSortRow,
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

  // Both banner handlers used to build a whole config object and
  // fs.writeFileSync it directly, which bypassed the section-wise merge in
  // save-settings -- so a settings change made in between could be clobbered.
  // This merges into the live config and supports deleting a key (undefined),
  // which is how customBannerLayout is retired once it lives in a file.
  const persistAppearance = (patch) => {
    const ini = require('ini')
    const appearance = { ...(ctx.appConfig?.Appearance || {}) }
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete appearance[key]
      else appearance[key] = value
    }
    const next = { ...(ctx.appConfig || {}), Appearance: appearance }
    fs.writeFileSync(configPath, ini.stringify(next))
    ctx.appConfig = next
  }

  ipcMain.handle('get-selected-banner-template', async () => {
    try {
      return ctx.appConfig?.Appearance?.bannerTemplate || 'Default'
    } catch {
      return 'Default'
    }
  })

  ipcMain.handle('set-selected-banner-template', async (event, template) => {
    try {
      persistAppearance({ bannerTemplate: template })
      broadcastBannerLayoutUpdated()
      return { success: true }
    } catch (err) {
      console.error('set-selected-banner-template error:', err)
      return { success: false, error: err.message }
    }
  })

  // The active layout lives in templates/banner-layout-active.json, not in
  // config.ini. ctx.readActiveBannerLayout falls back to the old config key when
  // the file is absent, so a downgrade or a restored older config.ini still works.
  ipcMain.handle('get-custom-banner-layout', async () => {
    try {
      return ctx.readActiveBannerLayout?.() ?? null
    } catch (err) {
      console.error('get-custom-banner-layout error:', err)
      return null
    }
  })

  ipcMain.handle('set-custom-banner-layout', async (event, layout) => {
    try {
      // Layout to its own file; config.ini keeps only the short id, the same
      // split themes already use.
      ctx.writeActiveBannerLayout(layout || {})
      persistAppearance({ bannerTemplate: 'custom', customBannerLayout: undefined })
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

  ipcMain.handle('get-previews', async (event, arg) => {
    // arg may be a bare recordId (legacy) or { recordId, sourceAppId }.
    const recordId = typeof arg === 'object' && arg !== null ? arg.recordId : arg
    const sourceAppId = typeof arg === 'object' && arg !== null ? (arg.sourceAppId ?? null) : null
    const previews = await getPreviews(recordId, getAssetBasePath(), process.defaultApp, { mode: getMediaStorageMode(), sourceOrder: getMetadataSourceOrder(), sourceAppId })
    // orderPreviewsBySource only re-sorts remote http(s) URLs by source priority.
    // Skip it when the user has a custom sort — otherwise it undoes their
    // drag-reorder of remote screenshots.
    const hasSort = await hasCustomPreviewSort(recordId)
    if (hasSort) {
      // console.log('[get-previews] recordId=%s custom sort active, skipping source reorder (%d previews): %j', recordId, previews.length, previews)
      return previews
    }
    // console.log('[get-previews] recordId=%s no custom sort, applying source reorder (%d previews)', recordId, previews.length)
    return orderPreviewsBySource(previews, getMetadataSourceOrder())
  })

  ipcMain.handle('get-steam-movie-thumbnails', async (event, arg) => {
    const recordId = typeof arg === 'object' && arg !== null ? arg.recordId : arg
    const sourceAppId = typeof arg === 'object' && arg !== null ? (arg.sourceAppId ?? null) : null
    try {
      return await getSteamMovieThumbnails(recordId, sourceAppId)
    } catch (err) {
      console.error('get-steam-movie-thumbnails error:', err)
      return []
    }
  })

  // Lazily fetch a Steam appid's metadata (screens + movies) if not already
  // cached, then return its previews and trailers. Lets a browse-mode Steam
  // game (catalog entry, never imported) show previews and trailers exactly like
  // an installed one, on demand per selected season.
  ipcMain.handle('ensure-steam-browse-media', async (event, { appId } = {}) => {
    const id = String(appId || '').trim()
    if (!/^\d+$/.test(id)) return { previews: [], trailers: [] }
    try {
      // Fetch only if we don't already have this appid's screens/movies cached,
      // so revisiting a game (or re-selecting a season) doesn't re-hit Steam.
      const db = liveMediaDb()
      const existing = db ? await getSteamBrowseMediaForAppId(id) : { previews: [], trailers: [] }
      if ((existing.previews?.length || 0) === 0 && (existing.trailers?.length || 0) === 0) {
        try {
          await fetchAndStoreSteamData(db, id, ctx.appConfig?.Metadata?.steamAssetSourceOrder)
        } catch (fetchErr) {
          console.warn('ensure-steam-browse-media fetch failed for', id, fetchErr?.message)
        }
      }
      const media = await getSteamBrowseMediaForAppId(id)
      return { previews: media.previews || [], trailers: media.trailers || [] }
    } catch (err) {
      console.error('ensure-steam-browse-media error:', err)
      return { previews: [], trailers: [] }
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

    // Remove duplicate DOWNLOADED preview files (same image saved under
    // different sequential filenames). Uses on-disk MD5 — bounded, local, no
    // network. Upstream steam_screens dedup prevents new dupes; this cleans up
    // ones already downloaded. Keeps the first file per hash.
    try {
      await dedupeLocalPreviews(recordId)
    } catch (e) {
      console.warn('local preview dedupe failed:', e.message)
    }

    const fetchedPreviews = await getPreviews(recordId, getAssetBasePath(), process.defaultApp, { mode: getMediaStorageMode(), sourceOrder })
    const hasSort = await hasCustomPreviewSort(recordId)
    const previewUrls = hasSort
      ? fetchedPreviews
      : orderPreviewsBySource(fetchedPreviews, sourceOrder)
    console.log('[refreshOneGame] recordId=%s customSort=%s previewCount=%d', recordId, hasSort, previewUrls.length)
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

  // Checks whether a custom sort order exists for this record in preview_sort.
  // When it does, orderPreviewsBySource must be skipped — otherwise it would
  // re-sort remote screenshots by source priority, undoing the user's drag-reorder.
  const hasCustomPreviewSort = (recordId) => new Promise((resolve) => {
    const db = liveMediaDb()
    if (!db) { resolve(false); return }
    db.get(
      `SELECT 1 FROM preview_sort WHERE record_id = ? LIMIT 1`,
      [recordId],
      (err, row) => resolve(!err && !!row),
    )
  })

  // Content-dedupe downloaded preview files for a record: hash each existing
  // local preview file, and for any hash seen more than once delete the extra
  // DB rows (and their files). Keeps the first occurrence.
  const dedupeLocalPreviews = (recordId) => new Promise((resolve) => {
    const db = liveMediaDb()
    if (!db) { resolve(0); return }
    db.all(`SELECT rowid, path FROM previews WHERE record_id = ?`, [recordId], (err, rows) => {
      if (err || !Array.isArray(rows) || rows.length === 0) { resolve(0); return }
      const base = getAssetBasePath()
      const seen = new Map() // hash -> rowid kept
      const dupRowids = []
      const dupFiles = []
      for (const r of rows) {
        if (!r.path) continue
        // Resolve to an absolute file path (previews store a relative asset path).
        let abs = r.path
        try { abs = path.isAbsolute(r.path) ? r.path : path.join(base, r.path) } catch { /* keep */ }
        let hash = ''
        try {
          const buf = fs.readFileSync(abs)
          hash = crypto.createHash('md5').update(buf).digest('hex')
        } catch {
          // File missing/unreadable — leave the row alone.
          continue
        }
        if (seen.has(hash)) {
          dupRowids.push(r.rowid)
          dupFiles.push(abs)
        } else {
          seen.set(hash, r.rowid)
        }
      }
      if (dupRowids.length === 0) { resolve(0); return }
      db.serialize(() => {
        db.run('BEGIN TRANSACTION')
        const stmt = db.prepare(`DELETE FROM previews WHERE rowid = ?`)
        for (const id of dupRowids) stmt.run([id])
        stmt.finalize()
        db.run('COMMIT', () => {
          // Best-effort file cleanup after the rows are gone.
          for (const f of dupFiles) { try { fs.unlinkSync(f) } catch { /* ignore */ } }
          console.log(`Deduped local previews for record ${recordId}: removed ${dupRowids.length}`)
          resolve(dupRowids.length)
        })
      })
    })
  })

  const hasLocalBanner = async (recordId) => {
    // Check both tables: media_assets stores banner metadata (f95_banner,
    // lewdcorner_banner, atlas_banner, atlas_banner_wide), while banners stores
    // downloaded banner files. The missingOnly refresh needs both to correctly
    // skip already-downloaded records.
    //
    // TODO: media_assets stores banner-like asset types beyond what LIKE '%banner%'
    // matches. Currently only f95_banner, lewdcorner_banner, atlas_banner, and
    // atlas_banner_wide are matched. Others that getBanner or similar UI paths
    // could treat as banners: steam_header, steam_hero, atlas_cover,
    // atlas_wallpaper. Consider whether hasLocalBanner should cover them too.
    const fromAssets = await dbGetSafe(
      `SELECT 1 FROM media_assets WHERE record_id = ? AND asset_type LIKE '%banner%' LIMIT 1`, [recordId])
    const fromBanners = await dbGetSafe(
      `SELECT 1 FROM banners WHERE record_id = ? LIMIT 1`, [recordId])
    return !!(fromAssets || fromBanners)
  }

  const hasLocalPreviews = async (recordId) => {
    // source (f95, lewdcorner, atlas, steam) banners, header, hero, logo, preview, etc.
    // TODO: the getPreviews only looking at previews table so not sure if assets check is needed
    const fromAssets = await dbGetSafe(
      `SELECT 1 FROM media_assets WHERE record_id = ? AND asset_type LIKE '%preview%' LIMIT 1`, [recordId])
    // ignore custom previews (is_custom=1) when checking for missingOnly refresh, since they are user-added and not part of the remote source.
    const fromPreviews = await dbGetSafe(
      `SELECT 1 FROM previews WHERE record_id = ? AND is_custom = 0 LIMIT 1`, [recordId])
    // console.log(`[hasLocalPreviews] recordId=${recordId} fromAssets=${!!fromAssets} fromPreviews=${!!fromPreviews}`)
    return !!(fromAssets || fromPreviews)
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
    console.log('[delete-previews] handler invoked for recordId:', recordId)
    const result = await deletePreviews(recordId, getAssetBasePath(), process.defaultApp)
    console.log('[delete-previews] handler completed for recordId:', recordId)
    return result
  })

  // Deletes only user-added previews (is_custom=1) and their preview_sort rows, leaving downloaded previews intact.
  ipcMain.handle('delete-custom-previews', async (event, recordId) => {
    console.log('[delete-custom-previews] handler invoked for recordId:', recordId)
    const { deleteCustomPreviews } = require('../db/media')
    const result = await deleteCustomPreviews(recordId, getAssetBasePath(), process.defaultApp)
    console.log('[delete-custom-previews] handler completed for recordId:', recordId)
    return result
  })

  // Persists user drag-reorder of preview images into preview_sort, keyed by
  // stable identifiers (remote_url for downloaded images, relative path for
  // custom uploads) so order survives re-downloads and stream/download switches.
  // Custom uploads (oldPos === -1) are promoted to the sorted zone as soon as
  // any positive-position item appears ahead of them in the new order.
  ipcMain.handle('reorder-previews', async (event, { recordId, orderedPaths }) => {
    if (!Array.isArray(orderedPaths)) return { success: false, error: 'orderedPaths must be an array' }
    const db = liveMediaDb()
    if (!db) return { success: false, error: 'Database not available' }

    // Backend maps display URLs → stable identifiers for the preview_sort table.
    // Remote http(s) URLs use the URL itself as identifier. Local display paths
    // are normalized to relative asset paths, then looked up in previews to get
    // COALESCE(remote_url, path) — so downloaded images (keyed by source URL)
    // keep their order across re-downloads, and custom uploads keep their
    // relative path as identifier.
    const basePath = getAssetBasePath()
    const normalizeLocal = (displayUrl) => {
      const atlasMediaMatch = String(displayUrl || '').match(/^atlas-media:\/\/local\/(.+)$/i)
      if (atlasMediaMatch) {
        let decoded = decodeURIComponent(atlasMediaMatch[1])
        let rel = path.relative(basePath, decoded)
        if (path.sep === '\\') rel = rel.replace(/\\/g, '/')
        return rel
      }
      let cleaned = String(displayUrl || '').replace(/^file:\/\//, '')
      let rel = path.relative(basePath, cleaned)
      if (path.sep === '\\') rel = rel.replace(/\\/g, '/')
      return rel
    }

    // Collect local display paths for a single batch lookup.
    const localDisplayPaths = orderedPaths.filter((u) => !/^https?:\/\//i.test(u))
    const localRelativePaths = localDisplayPaths.map(normalizeLocal)
    const identifierByPath = new Map()

    if (localRelativePaths.length > 0) {
      // Query all previews for the record and match in JS. This avoids
      // SQL-level path comparison failures on Windows where previews.path
      // may contain backslashes from path.join() while normalizeLocal
      // always produces forward slashes.
      await new Promise((resolve, reject) => {
        db.all(
          `SELECT path, COALESCE(remote_url, path) AS identifier FROM previews WHERE record_id = ?`,
          [recordId],
          (err, rows) => {
            if (err) reject(err)
            else {
              for (const row of rows || []) {
                const normalized = String(row.path || '').replace(/\\/g, '/')
                identifierByPath.set(normalized, row.identifier)
              }
              resolve()
            }
          },
        )
      })
    }

    // Build ordered identifier list preserving the frontend's ordering. Local
    // paths that don't match a previews row (or are custom uploads with no
    // remote_url) fall back to their relative path as the identifier.
    const orderedIdentifiers = []
    for (const displayUrl of orderedPaths) {
      if (/^https?:\/\//i.test(displayUrl)) {
        orderedIdentifiers.push(displayUrl)
      } else {
        const rel = normalizeLocal(displayUrl)
        const id = identifierByPath.get(rel) || rel
        orderedIdentifiers.push(id)
        // console.log('[reorder-previews] local: displayUrl=%s rel=%s identifier=%s matched=%s', displayUrl, rel, id, identifierByPath.has(rel) ? 'yes' : 'no')
      }
    }
    // console.log('[reorder-previews] recordId=%s identifiers=%j', recordId, orderedIdentifiers)

    // Read existing positions and created_at so we can apply the -1 custom
    // zone promotion rule and preserve each row's original upload time. The
    // created_at tiebreak sort must not be reset on every drag.
    const oldPositions = new Map()
    const oldCreatedAtMap = new Map()
    await new Promise((resolve, reject) => {
      db.all(
        `SELECT identifier, position, created_at FROM preview_sort WHERE record_id = ?`,
        [recordId],
        (err, rows) => {
          if (err) reject(err)
          else {
            for (const row of rows || []) {
              oldPositions.set(row.identifier, row.position)
              oldCreatedAtMap.set(row.identifier, row.created_at)
            }
            resolve()
          }
        },
      )
    })

    // Walk the new order left to right assigning positions.
    // -1 custom items stay at -1 until a positive item appears ahead of them,
    // then they are promoted to the next available positive position.
    const newPositions = new Map()
    let nextPositive = 0
    let sawPositive = false
    for (const id of orderedIdentifiers) {
      const oldPos = oldPositions.has(id) ? oldPositions.get(id) : 0
      if (oldPos >= 0) {
        newPositions.set(id, nextPositive++)
        sawPositive = true
      } else if (oldPos === -1) {
        if (sawPositive) {
          newPositions.set(id, nextPositive++)
        } else {
          newPositions.set(id, -1)
        }
      } else {
        newPositions.set(id, nextPositive++)
        sawPositive = true
      }
    }

    // Replace all prior sort positions for this record in a single transaction.
    await new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run('BEGIN TRANSACTION')
        db.run(`DELETE FROM preview_sort WHERE record_id = ?`, [recordId])
        const stmt = db.prepare(
          `INSERT INTO preview_sort (record_id, identifier, position, created_at) VALUES (?, ?, ?, ?)`
        )
        orderedIdentifiers.forEach((identifier) => {
          const pos = newPositions.get(identifier)
          // Preserve the row's original created_at so the secondary sort
          // order is stable across drags; assign a fresh monotonic timestamp
          // only when the identifier had no prior sort row.
          const createdAt = oldCreatedAtMap.has(identifier)
            ? oldCreatedAtMap.get(identifier)
            : nextCreatedAt()
          stmt.run(recordId, identifier, pos, createdAt)
        })
        stmt.finalize((err) => {
          if (err) {
            db.run('ROLLBACK', () => reject(err))
          } else {
            db.run('COMMIT', (commitErr) => {
              if (commitErr) {
                db.run('ROLLBACK', () => reject(commitErr))
              } else {
                resolve()
              }
            })
          }
        })
      })
    })
    return { success: true }
  })

  // Clears the persisted sort order for a record. After clearing, getPreviews
  // keeps natural order (source priority, then local) for items without a
  // preview_sort row; explicitly sorted items lead.
  // Custom uploads (is_custom=1) are moved back to the front (position = -1)
  // and keep their created_at so they still sort among themselves by original
  // upload time; non-custom rows are removed entirely. Does NOT touch the
  // previews table itself.
  ipcMain.handle('clear-preview-sort', async (event, recordId) => {
    const db = liveMediaDb()
    if (!db) return { success: false, error: 'Database not available' }
    // Reset to natural order: custom uploads (is_custom=1) move back to the
    // front (-1) and keep their created_at; non-custom rows are removed so
    // getPreviews keeps natural order for items without a preview_sort row.
    // Both steps run in one transaction
    // (node-sqlite3 serializes statements on the connection) and any failure
    // rolls everything back. Does NOT touch the previews table itself.
    const run = (sql, params = []) =>
      new Promise((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())))
    try {
      await run('BEGIN TRANSACTION')
      await run(
        `UPDATE preview_sort SET position = -1
         WHERE record_id = ? AND identifier IN (
           SELECT path FROM previews WHERE record_id = ? AND is_custom = 1
         )`,
        [recordId, recordId],
      )
      await run(
        `DELETE FROM preview_sort
         WHERE record_id = ? AND identifier NOT IN (
           SELECT path FROM previews WHERE record_id = ? AND is_custom = 1
         )`,
        [recordId, recordId],
      )
      await run('COMMIT')
      return { success: true }
    } catch (err) {
      await run('ROLLBACK').catch(() => {})
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('convert-and-save-banner', async (event, { recordId, filePath, progressId }) => {
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
      const displayUrl = await saveCustomBannerFromBuffer(recordId, imageBytes, event, progressId)

      if (!progressId && event?.sender && !event.sender.isDestroyed()) {
        event.sender.send('game-details-import-progress', { text: 'Custom banner saved', progress: 1, total: 1 })
      }
      return displayUrl
    } catch (err) {
      console.error('Error converting and saving banner:', err)
      if (progressId && event?.sender && !event.sender.isDestroyed()) {
        event.sender.send('custom-media-progress', { id: progressId, error: err.message, done: true })
      } else if (event?.sender && !event.sender.isDestroyed()) {
        event.sender.send('game-details-import-progress', {
          text: `Failed to save custom banner: ${err.message}`,
          progress: 0, total: 1,
        })
      }
      throw err
    }
  })

  // Shared banner conversion: reads imageBytes, writes _mc.webp + _sc.webp,
  // updates banners table. Extracted so URL-based upload can reuse it.
  const saveCustomBannerFromBuffer = async (recordId, imageBytes, event, progressId = null) => {
    const imageDir = path.join(dataDir, 'images', String(recordId))
    await fs.promises.mkdir(imageDir, { recursive: true })

    const customBaseName = buildBannerBaseName('custom')
    const relativeBasePath = path.join('data', 'images', String(recordId), customBaseName)
    const mediumPath = path.join(imageDir, `${customBaseName}_mc.webp`)
    const smallPath = path.join(imageDir, `${customBaseName}_sc.webp`)

    const sharp = getSharp()
    await sharp(imageBytes).webp({ quality: 90 }).resize({ width: 1260, withoutEnlargement: true }).toFile(mediumPath)
    await sharp(imageBytes).webp({ quality: 90 }).resize({ width: 600, withoutEnlargement: true }).toFile(smallPath)

    await updateBanners(recordId, `${relativeBasePath}_mc.webp`, 'small')
    await updateBanners(recordId, `${relativeBasePath}_sc.webp`, 'large')

    const bannerPath = await getBanner(recordId, getAssetBasePath(), process.defaultApp, 'large', 'download')
    BrowserWindow.getAllWindows().forEach((win) => { if (!win.isDestroyed()) win.webContents.send('game-updated', recordId) })

    const displayUrl = firstMediaPath(bannerPath)
    if (progressId && event?.sender && !event.sender.isDestroyed()) {
      event.sender.send('custom-media-progress', { id: progressId, progress: 1, total: 1, done: true, url: displayUrl })
    }
    return displayUrl
  }

  const emitPreviewProgress = (event, itemId, progress, total, done = false, url = null, error = null) => {
    if (!event?.sender || event.sender.isDestroyed()) return
    event.sender.send('custom-media-progress', { id: itemId, progress, total, done, url, error })
  }

  const CUSTOM_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
  // 6-char base36 suffix (~2.1B values). Unique enough per record; the
  // previewIdentifierExists retry below absorbs the rare collision.
  const randomBase36Suffix = (len = 6) => {
    const bytes = crypto.randomBytes(len)
    let s = ''
    for (let i = 0; i < len; i++) s += CUSTOM_ID_ALPHABET[bytes[i] % 36]
    return s
  }
  const previewIdentifierExists = (recordId, relPath) =>
    new Promise((resolve, reject) => {
      const db = liveMediaDb()
      if (!db) return resolve(false)
      db.get(
        `SELECT 1 FROM preview_sort WHERE record_id = ? AND identifier = ? LIMIT 1`,
        [recordId, relPath],
        (err, row) => (err ? reject(err) : resolve(!!row)),
      )
    })

  // Copies user-picked local files into data/images/<recordId> and registers
  // them as custom previews so the Media tab can display and sort them without
  // an external download step.
  ipcMain.handle('add-custom-previews', async (event, { recordId, items }) => {
    if (!recordId || !Array.isArray(items) || items.length === 0) {
      return { success: false, error: 'Invalid request' }
    }
    const results = []
    const total = items.length
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const { id, srcPath } = item
      if (!id || !srcPath) continue
      try {
        const ext = path.extname(srcPath).toLowerCase() || '.webp'
        const imageDir = path.join(dataDir, 'images', String(recordId))
        await fs.promises.mkdir(imageDir, { recursive: true })
        // Short random alphanumeric id keeps filenames small; the existence
        // check + retry handles the rare per-record collision.
        let fileName
        let relPath
        do {
          fileName = `preview_custom_${randomBase36Suffix(6)}${ext}`
          relPath = path.join('data', 'images', String(recordId), fileName)
        } while (await previewIdentifierExists(recordId, relPath))
        const destPath = path.join(imageDir, fileName)
        await fs.promises.copyFile(srcPath, destPath)
        await updatePreviews(recordId, relPath, null, true)
        await insertPreviewSortRow(recordId, relPath, -1)
        const absolutePath = path.join(getAssetBasePath(), relPath).replace(/\\/g, '/')
        const displayUrl = `atlas-media://local/${encodeURIComponent(absolutePath)}`
        results.push({ id, url: displayUrl })
        emitPreviewProgress(event, id, i + 1, total, true, displayUrl)
      } catch (err) {
        emitPreviewProgress(event, id, 0, total, true, null, err.message)
      }
    }
    BrowserWindow.getAllWindows().forEach((win) => { if (!win.isDestroyed()) win.webContents.send('game-updated', recordId) })
    return results
  })

  // Fetches an image from a user-supplied URL, saves it as a custom preview,
  // and reports download progress so the Media tab can show a live progress bar.
  ipcMain.handle('add-custom-preview-from-url', async (event, { recordId, id, url }) => {
    if (!recordId || !id || !url) {
      return { success: false, error: 'Invalid request' }
    }
    try {
      const ext = path.extname(new URL(url).pathname).toLowerCase() || '.webp'
      const imageDir = path.join(dataDir, 'images', String(recordId))
      await fs.promises.mkdir(imageDir, { recursive: true })
      let fileName
      let relPath
      do {
        fileName = `preview_custom_${randomBase36Suffix(6)}${ext}`
        relPath = path.join('data', 'images', String(recordId), fileName)
      } while (await previewIdentifierExists(recordId, relPath))
      const destPath = path.join(imageDir, fileName)

      const response = await axios.get(url, {
        responseType: 'stream',
        maxRedirects: 5,
        headers: {
          'User-Agent': 'Atlas/1.0 (+https://github.com/towerwatchman/Atlas)',
        },
      })

      const totalLength = Number(response.headers?.['content-length']) || 0
      let downloaded = 0
      const writeStream = fs.createWriteStream(destPath)
      await new Promise((resolve, reject) => {
        response.data.on('data', (chunk) => {
          downloaded += chunk.length
          emitPreviewProgress(event, id, downloaded, totalLength)
        })
        response.data.pipe(writeStream)
        writeStream.on('finish', resolve)
        writeStream.on('error', reject)
        response.data.on('error', reject)
      })

      // relPath computed above (with collision-checked unique id)
      await updatePreviews(recordId, relPath, url, true)
      await insertPreviewSortRow(recordId, relPath, -1)
      const absolutePath = path.join(getAssetBasePath(), relPath).replace(/\\/g, '/')
      const displayUrl = `atlas-media://local/${encodeURIComponent(absolutePath)}`
      emitPreviewProgress(event, id, downloaded, totalLength, true, displayUrl)
      BrowserWindow.getAllWindows().forEach((win) => { if (!win.isDestroyed()) win.webContents.send('game-updated', recordId) })
      return { id, url: displayUrl }
    } catch (err) {
      emitPreviewProgress(event, id, 0, 0, true, null, err.message)
      throw err
    }
  })

  // Downloads an image from a URL and converts it into the custom banner
  // sizes, emitting progress so the caller can update the Media tab UI.
  ipcMain.handle('convert-and-save-banner-from-url', async (event, { recordId, id, url }) => {
    if (!recordId || !id || !url) {
      return { success: false, error: 'Invalid request' }
    }
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        maxRedirects: 5,
        headers: {
          'User-Agent': 'Atlas/1.0 (+https://github.com/towerwatchman/Atlas)',
        },
      })
      const totalLength = Number(response.headers?.['content-length']) || response.data?.length || 0
      emitPreviewProgress(event, id, totalLength, totalLength, false)
      const imageBytes = Buffer.from(response.data)
      const displayUrl = await saveCustomBannerFromBuffer(recordId, imageBytes, event, id)
      return { id, url: displayUrl }
    } catch (err) {
      emitPreviewProgress(event, id, 0, 0, true, null, err.message)
      throw err
    }
  })
}