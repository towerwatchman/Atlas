'use strict'

const { ipcMain, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')
const ini = require('ini')
const { BROWSE_MODE_ENABLED } = require('../features')

const defaultConfig = {
  Interface: {
    language: 'English',
    atlasStartup: 'Do Nothing',
    gameStartup: 'Do Nothing',
    showDebugConsole: false,
    minimizeToTray: false,
    checkForAppUpdatesOnStartup: true,
    appUpdateBranch: null,
    showGameList: true,
    sidePanelMode: 'games',
  },
  Library: {
    gameFolder: '',
    gameExtensions: 'exe,swf,flv,f4v,rag,cmd,bat,jar,html',
    extractionExtensions: 'zip,7z,rar',
    libraryFolderStructure: '{creator}/{title}/{version}',
    autoSelectLatestReplaceVersion: false,
    validatePathsOnStartup: false,
    sevenZipPath: '',
  },
  Metadata: {
    downloadPreviews: false,
    mediaStorageMode: 'stream',
    sourceOrder: 'f95,lewdcorner,steam',
  },
  Importer: {
    sourceGamePath: '',
    sourceFolderStructure: '{creator}/{title}/{version}',
    useUnstructured: true,
    downloadBannerImages: null,
    downloadPreviewImages: null,
    previewLimit: 'Unlimited',
    downloadVideos: false,
    scanSize: false,
    moveFoldersToLibrary: false,
    deleteSourceArchiveAfterImport: false,
    includeUnmatched: false,
    forceReimport: false,
  },
  Performance: {
    maxHeapSize: 4096,
    mediaDownloadConcurrency: 3,
    mediaPerHostConcurrency: 2,
    mediaRequestDelayMs: 100,
  },
  Appearance: {
    // themeId selects one of the built-in themes defined in src/theme/themes.js
    // (see THEME_COLOR_KEYS / BUILT_IN_THEMES / getThemeById there).
    themeId: 'default',
    // layout is independent of theme — 'sidebar' or 'topnav' — see
    // LAYOUT_OPTIONS in src/theme/themes.js.
    layout: 'sidebar',
    // Nav button presentation ('icons' | 'iconsAndText' | 'text') and
    // whether the header's accent-bar notch strip is shown — independent
    // of theme/layout, same pattern as layout above. See
    // NAV_DISPLAY_MODE_OPTIONS / DEFAULT_NAV in src/theme/themes.js.
    navDisplayMode: 'icons',
    accentBarEnabled: true,
    // Which edge the filter sidebar docks to, and whether it overlays the
    // library grid or shares space with it inline — see
    // FILTER_SIDEBAR_SIDE_OPTIONS / FILTER_SIDEBAR_MODE_OPTIONS in
    // src/theme/themes.js. Same independent-of-theme pattern as above.
    filterSidebarSide: 'right',
    filterSidebarMode: 'overlay',
    // Reserved for a future custom theme editor: a JSON-stringified theme
    // object (same shape as the built-ins) the user has authored themselves.
    // Empty string means "no custom theme saved".
    customTheme: '',
  },
  NSFW: {
    enabled: false,
  },
}

const sanitizeFeatureSettings = (settings = {}) => {
  if (BROWSE_MODE_ENABLED) return settings
  const next = {
    ...settings,
    Interface: {
      ...(settings.Interface || {}),
    },
  }
  if (next.Interface.sidePanelMode === 'catalog') {
    next.Interface.sidePanelMode = 'games'
    next.Interface.showGameList = true
  }
  return next
}

const defaultSavedFilterState = {
  text: '',
  type: 'all',
  category: [],
  engine: [],
  status: [],
  censored: [],
  language: [],
  tags: [],
  excludedCategories: [],
  excludedEngines: [],
  excludedStatuses: [],
  excludedTags: [],
  sort: 'name',
  sortDirection: 'asc',
  dateLimit: 0,
  dateField: 'none',
  dateRange: 'any',
  dateFrom: '',
  dateTo: '',
  browseSource: 'all',
  browseDateBasis: 'thread_updated',
  browseDateRange: 'any',
  browseSort: 'nameAsc',
  tagLogic: 'AND',
  updateAvailable: false,
  favoritesOnly: false,
  steamMapped: false,
  personalRatingMin: 0,
  personalRatingRatedOnly: false,
  includeUninstalled: false,
  installState: 'installed',
  multipleInstalledVersions: false,
}

const savedFilterArrayKeys = [
  'category',
  'engine',
  'status',
  'censored',
  'language',
  'tags',
  'excludedCategories',
  'excludedEngines',
  'excludedStatuses',
  'excludedTags',
]

const toSavedFilterArray = (value) => {
  if (Array.isArray(value)) return value.filter((item) => item !== undefined && item !== null).map(String)
  if (value === undefined || value === null || value === '') return []
  return [String(value)]
}

const normalizeSavedFilterState = (filters = {}) => {
  const source = filters && typeof filters === 'object' ? filters : {}
  const merged = { ...defaultSavedFilterState, ...source }
  for (const key of savedFilterArrayKeys) merged[key] = toSavedFilterArray(merged[key])
  merged.text = String(merged.text || '')
  merged.type = String(merged.type || 'all')
  merged.sort = String(merged.sort || 'name')
  merged.sortDirection = merged.sortDirection === 'desc' ? 'desc' : 'asc'
  merged.dateField = ['none', 'releaseDate', 'lastInstalled', 'lastPlayed', 'latestUpdate', 'threadPublished', 'wishlistAdded'].includes(merged.dateField)
    ? merged.dateField
    : 'none'
  merged.dateRange = ['any', '7d', '30d', '90d', 'year', 'custom'].includes(merged.dateRange)
    ? merged.dateRange
    : 'any'
  merged.dateFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(merged.dateFrom || '')) ? String(merged.dateFrom) : ''
  merged.dateTo = /^\d{4}-\d{2}-\d{2}$/.test(String(merged.dateTo || '')) ? String(merged.dateTo) : ''
  merged.browseSource = ['all', 'f95', 'steam', 'atlas'].includes(merged.browseSource)
    ? merged.browseSource
    : 'all'
  merged.browseDateBasis = ['thread_updated', 'thread_publish_date'].includes(merged.browseDateBasis)
    ? merged.browseDateBasis
    : 'thread_updated'
  merged.browseDateRange = ['any', '7d', '30d', '90d', 'year'].includes(merged.browseDateRange)
    ? merged.browseDateRange
    : 'any'
  if (merged.browseSort === 'name') merged.browseSort = 'nameAsc'
  merged.browseSort = ['nameAsc', 'nameDesc', 'newest', 'oldest'].includes(merged.browseSort)
    ? merged.browseSort
    : 'nameAsc'
  merged.tagLogic = merged.tagLogic === 'OR' ? 'OR' : 'AND'
  merged.updateAvailable = merged.updateAvailable === true
  merged.favoritesOnly = merged.favoritesOnly === true
  merged.steamMapped = merged.steamMapped === true
  const personalRatingMin = Number(merged.personalRatingMin)
  merged.personalRatingMin = Number.isFinite(personalRatingMin)
    ? Math.max(0, Math.min(10, Math.round(personalRatingMin)))
    : 0
  merged.personalRatingRatedOnly = merged.personalRatingRatedOnly === true
  merged.multipleInstalledVersions = merged.multipleInstalledVersions === true
  if (!['installed', 'uninstalled', 'all'].includes(merged.installState)) {
    merged.installState = merged.includeUninstalled ? 'all' : 'installed'
  }
  if (merged.installState === 'installed') merged.includeUninstalled = false
  if (['all', 'uninstalled'].includes(merged.installState)) merged.includeUninstalled = true
  const dateLimit = Number(merged.dateLimit)
  merged.dateLimit = Number.isFinite(dateLimit) && dateLimit > 0 ? dateLimit : 0
  return merged
}

const normalizeSavedFilter = (filter) => {
  if (!filter || !filter.id || !filter.name) return null
  return {
    ...filter,
    id: String(filter.id),
    name: String(filter.name).trim(),
    builtIn: false,
    filters: normalizeSavedFilterState(filter.filters),
  }
}

// Deep merge parsed ini into defaults so missing keys always have a value.
// ini.parse() returns all values as strings — coerce known booleans/numbers.
function mergeWithDefaults(parsed, defaults) {
  const result = {}
  for (const section of Object.keys(defaults)) {
    result[section] = { ...defaults[section] }
    if (parsed && parsed[section]) {
      for (const key of Object.keys(defaults[section])) {
        const raw = parsed[section][key]
        if (raw === undefined) continue
        const def = defaults[section][key]
      if (typeof def === 'boolean') {
        result[section][key] = raw === true || raw === 'true'
      } else if (typeof def === 'number') {
          const parsedNumber = Number(raw)
          result[section][key] = Number.isFinite(parsedNumber) ? parsedNumber : def
      } else {
        result[section][key] = raw
      }
      }
      // Also keep any extra keys the user may have added
      for (const key of Object.keys(parsed[section])) {
        if (!(key in defaults[section])) {
          result[section][key] = parsed[section][key]
        }
      }
    }
  }
  return result
}

module.exports = function registerSettingsHandlers(ctx) {
  const { createSettingsWindow } = ctx
  const savedFiltersPath = () => path.join(ctx.dataDir, 'saved_filters.json')

  const readSavedFiltersFile = async () => {
    try {
      const filePath = savedFiltersPath()
      if (!fs.existsSync(filePath)) return { version: 1, filters: [] }
      const parsed = JSON.parse(await fs.promises.readFile(filePath, 'utf8'))
      return {
        ...parsed,
        version: Number(parsed?.version) || 1,
        filters: Array.isArray(parsed?.filters) ? parsed.filters : [],
      }
    } catch (err) {
      console.warn('Failed to read saved filters:', err.message)
      return { version: 1, filters: [] }
    }
  }

  const writeSavedFiltersFile = async (data) => {
    const filePath = savedFiltersPath()
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
    await fs.promises.writeFile(
      filePath,
      `${JSON.stringify({ version: 1, ...data }, null, 2)}\n`,
      'utf8',
    )
  }

  ipcMain.handle('open-settings', () => {
    createSettingsWindow()
  })

  ipcMain.handle('get-settings', async () => {
    return sanitizeFeatureSettings(mergeWithDefaults(ctx.appConfig, defaultConfig))
  })

  ipcMain.handle('save-settings', async (event, settings) => {
    try {
      const previousAppearance = ctx.appConfig?.Appearance
      const previousInterface = ctx.appConfig?.Interface
      const previousMetadata = ctx.appConfig?.Metadata
      const nextSettings = sanitizeFeatureSettings(settings)
      ctx.appConfig = nextSettings
      fs.writeFileSync(ctx.configPath, ini.stringify(nextSettings))

      // Theme changes need to apply live across every open window (main
      // library, settings, importer, game details) since each is its own
      // BrowserWindow with its own renderer process — saving to disk alone
      // doesn't update windows that are already open. Only broadcast when
      // Appearance actually changed so unrelated settings saves (e.g.
      // toggling "check for updates") don't trigger a needless re-theme in
      // every window.
      const nextAppearance = nextSettings?.Appearance
      const appearanceChanged =
        JSON.stringify(previousAppearance) !== JSON.stringify(nextAppearance)
      if (appearanceChanged && nextAppearance) {
        BrowserWindow.getAllWindows().forEach((win) => {
          if (!win.isDestroyed()) win.webContents.send('appearance-changed', nextAppearance)
        })
      }

      // Show/hide DevTools on every open window immediately when the
      // "Show debug console window" setting changes, instead of only taking
      // effect for windows created after the toggle (which previously made
      // it look like it needed a restart).
      const previousShowDebugConsole = previousInterface?.showDebugConsole === true
      const nextShowDebugConsole = nextSettings?.Interface?.showDebugConsole === true
      if (previousShowDebugConsole !== nextShowDebugConsole) {
        BrowserWindow.getAllWindows().forEach((win) => {
          if (win.isDestroyed()) return
          if (nextShowDebugConsole) {
            if (!win.webContents.isDevToolsOpened()) win.webContents.openDevTools()
          } else if (win.webContents.isDevToolsOpened()) {
            win.webContents.closeDevTools()
          }
        })
      }

      const previousUpdateBranch = ctx.getConfiguredAppUpdateBranch?.({ Interface: previousInterface })
      const nextUpdateBranch = ctx.getConfiguredAppUpdateBranch?.(nextSettings)
      if (previousUpdateBranch !== nextUpdateBranch) {
        ctx.configureAppUpdateBranch?.(nextUpdateBranch, { resetStatus: true })
      }

      // Metadata source order (and other Metadata settings) affect how
      // games are returned from get-games/get-game, but the renderer caches
      // its game list in React state — it won't see the new order until it
      // re-fetches. Broadcast so open windows know to refresh their data.
      const nextMetadata = nextSettings?.Metadata
      const metadataChanged =
        JSON.stringify(previousMetadata) !== JSON.stringify(nextMetadata)
      if (metadataChanged && nextMetadata) {
        BrowserWindow.getAllWindows().forEach((win) => {
          if (!win.isDestroyed()) win.webContents.send('metadata-changed', nextMetadata)
        })
      }

      return { success: true }
    } catch (err) {
      console.error('save-settings error:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('get-nsfw-status', async () => {
    return {
      configured: ctx.nsfwConfigured === true,
      enabled: ctx.appConfig?.NSFW?.enabled === true,
    }
  })

  ipcMain.handle('set-nsfw-enabled', async (event, enabled) => {
    try {
      const nextEnabled = enabled === true
      const nextSettings = {
        ...ctx.appConfig,
        NSFW: { ...(ctx.appConfig?.NSFW || {}), enabled: nextEnabled },
      }
      ctx.appConfig = nextSettings
      ctx.nsfwConfigured = true
      fs.writeFileSync(ctx.configPath, ini.stringify(nextSettings))
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) win.webContents.send('nsfw-changed', { enabled: nextEnabled })
      })
      return { success: true, enabled: nextEnabled }
    } catch (err) {
      console.error('set-nsfw-enabled error:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('get-saved-filters', async () => {
    const data = await readSavedFiltersFile()
    return data.filters
      .map(normalizeSavedFilter)
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name))
  })

  ipcMain.handle('save-saved-filter', async (event, filter) => {
    try {
      const data = await readSavedFiltersFile()
      const cleanFilter = normalizeSavedFilter({
        ...filter,
        id:
          filter?.id ||
          `filter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: String(filter?.name || '').trim(),
        builtIn: false,
        filters: normalizeSavedFilterState(filter?.filters),
      })
      if (!cleanFilter?.name) {
        return { success: false, error: 'Filter name is required' }
      }
      const normalizedExisting = data.filters.map(normalizeSavedFilter).filter(Boolean)
      const existingIndex = normalizedExisting.findIndex((item) => item.id === cleanFilter.id)
      const nextFilters = [...normalizedExisting]
      if (existingIndex >= 0) nextFilters[existingIndex] = cleanFilter
      else nextFilters.push(cleanFilter)
      await writeSavedFiltersFile({ ...data, filters: nextFilters })
      return { success: true, filter: cleanFilter }
    } catch (err) {
      console.error('save-saved-filter error:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('delete-saved-filter', async (event, id) => {
    try {
      const data = await readSavedFiltersFile()
      await writeSavedFiltersFile({
        ...data,
        filters: data.filters.filter((filter) => filter.id !== id),
      })
      return { success: true }
    } catch (err) {
      console.error('delete-saved-filter error:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('save-emulator-config', async (event, emulator) => {
    return await ctx.saveEmulatorConfig(emulator)
  })

  ipcMain.handle('get-emulator-config', async () => {
    return await ctx.getEmulatorConfig()
  })

  ipcMain.handle('remove-emulator-config', async (event, extension) => {
    return await ctx.removeEmulatorConfig(extension)
  })
}
