'use strict'

const { ipcMain } = require('electron')
const fs = require('fs')
const ini = require('ini')

module.exports = function registerSettingsHandlers(ctx) {
  const { createSettingsWindow } = ctx

  ipcMain.handle('open-settings', () => {
    createSettingsWindow()
  })

  ipcMain.handle('get-settings', async () => {
    return ctx.appConfig
  })

  ipcMain.handle('save-settings', async (event, settings) => {
    try {
      fs.writeFileSync(ctx.configPath, ini.stringify(settings))
      ctx.appConfig = settings
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
