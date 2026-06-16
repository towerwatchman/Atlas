'use strict'

const { ipcMain } = require('electron')
const fs = require('fs')
const path = require('path')
const ini = require('ini')

const defaultConfig = {
  Interface: {
    language: 'English',
    atlasStartup: 'Do Nothing',
    gameStartup: 'Do Nothing',
    showDebugConsole: false,
    minimizeToTray: false,
    checkForAppUpdatesOnStartup: true,
    showGameList: true,
  },
  Library: {
    gameFolder: '',
    gameExtensions: 'exe,swf,flv,f4v,rag,cmd,bat,jar,html',
    extractionExtensions: 'zip,7z,rar',
    libraryFolderStructure: '{creator}/{title}/{version}',
    autoSelectLatestReplaceVersion: false,
    sevenZipPath: '',
  },
  Metadata: {
    downloadPreviews: false,
    mediaStorageMode: 'stream',
    sourceOrder: 'f95,steam',
  },
  Performance: {
    maxHeapSize: 4096,
  },
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
          result[section][key] = Number(raw) || def
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
    return mergeWithDefaults(ctx.appConfig, defaultConfig)
  })

  ipcMain.handle('save-settings', async (event, settings) => {
    try {
      ctx.appConfig = settings
      fs.writeFileSync(ctx.configPath, ini.stringify(settings))
      return { success: true }
    } catch (err) {
      console.error('save-settings error:', err)
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('get-saved-filters', async () => {
    const data = await readSavedFiltersFile()
    return data.filters.filter((filter) => filter && filter.id && filter.name)
  })

  ipcMain.handle('save-saved-filter', async (event, filter) => {
    try {
      const data = await readSavedFiltersFile()
      const cleanFilter = {
        ...filter,
        id:
          filter?.id ||
          `filter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: String(filter?.name || '').trim(),
        builtIn: false,
        filters: filter?.filters || {},
      }
      if (!cleanFilter.name) {
        return { success: false, error: 'Filter name is required' }
      }
      const existingIndex = data.filters.findIndex((item) => item.id === cleanFilter.id)
      const nextFilters = [...data.filters]
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
