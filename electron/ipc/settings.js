'use strict'

const { ipcMain } = require('electron')
const fs = require('fs')
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
