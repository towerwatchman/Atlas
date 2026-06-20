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

const isVideoUrl = (url) => /\.(mp4|webm|m4v)(\?|#|$)/i.test(String(url || ''))

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
    getRemoteBannerUrl, getRemotePreviewUrls,
    GetAtlasIDbyRecord, firstMediaPath, getBrowsePreviewUrls,
    getAllDownloadableAssetUrlsForRecord, upsertMediaAsset,
    configPath,
    getMetadataSourceOrder,
  } = ctx

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
      const raw = ctx.appConfig?.Appearance?.userBannerLayouts
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch (err) {
      console.error('get-user-banner-layouts error:', err)
      return []
    }
  })

  ipcMain.handle('set-user-banner-layouts', async (event, presets) => {
    try {
      const ini = require('ini')
      const newConfig = {
        ...ctx.appConfig,
        Appearance: {
          ...ctx.appConfig.Appearance,
          userBannerLayouts: JSON.stringify(Array.isArray(presets) ? presets : []),
        },
      }
      fs.writeFileSync(configPath, ini.stringify(newConfig))
      ctx.appConfig = newConfig
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

  ipcMain.handle('get-browse-preview-urls', async (event, record = {}) => {
    try {
      const urls = await getBrowsePreviewUrls({
        atlasId: record.atlasId ?? record.atlas_id,
        f95Id: record.f95Id ?? record.f95_id,
        lcId: record.lcId ?? record.lc_id ?? record.lewdCornerId ?? record.lewdcornerId,
        steamId: record.steamId ?? record.steam_id ?? record.steam_appid,
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

  ipcMain.handle('refresh-game-media', async (event, recordId) => {
    try {
      // For Steam-mapped games, re-fetch live metadata so steam_data,
      // steam_screens and steam_movies (trailers) are repopulated — this is the
      // only way games imported before a given enrichment get refreshed.
      const steamId = await getSteamIDbyRecord(recordId)
      if (steamId) {
        await fetchAndStoreSteamData(null, steamId)
      }
      const atlasId = await GetAtlasIDbyRecord(recordId)
      const sourceOrder = getMetadataSourceOrder()
      const bannerUrl = await getRemoteBannerUrl(recordId, { sourceOrder })
      const rawPreviewUrls = await getRemotePreviewUrls(recordId, { sourceOrder })
      const screenUrls = rawPreviewUrls
        .map((url) => String(url || '').trim())
        .filter(Boolean)
        .filter((url) => !isVideoUrl(url))
        .map((url) => ({ url, source: inferMediaSource(url) }))
      const additionalAssets = (await getAllDownloadableAssetUrlsForRecord(recordId, { downloadVideos: false, sourceOrder }))
        .filter((asset) => asset.targetKind !== 'preview' && asset.url !== bannerUrl)

      const downloadResult = await downloadImages(
        recordId,
        atlasId || steamId || recordId,
        (current, totalImages) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('game-details-import-progress', {
              text: `Downloading media assets ${current}/${totalImages}`,
              progress: current,
              total: totalImages,
            })
          }
        },
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
        },
      )
      const previewUrls = orderPreviewsBySource(
        await getPreviews(recordId, getAssetBasePath(), process.defaultApp, { mode: getMediaStorageMode(), sourceOrder }),
        sourceOrder,
      )
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) win.webContents.send('game-updated', recordId)
      })
      return { success: downloadResult.success, previewUrls, downloadResult }
    } catch (err) {
      console.error('refresh-game-media error:', err)
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
