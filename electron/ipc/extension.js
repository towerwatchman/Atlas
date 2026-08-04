'use strict'

const { ipcMain } = require('electron')
const {
  startExtensionServer,
  stopExtensionServer,
  isExtensionServerRunning,
} = require('../rpc/extensionServer')

function registerExtensionHandlers(ctx) {
  const getConfig = () => ctx.getConfig()
  const saveSettings = (newConfig) => ctx.saveSettings(newConfig)

  ipcMain.handle('get-extension-status', async () => {
    const config = getConfig()
    const extConfig = config.Extension || {}
    return {
      running: isExtensionServerRunning(),
      port: extConfig.rpcPort || 57096,
      rpcEnabled: extConfig.rpcEnabled ?? true,
      backgroundAdd: extConfig.backgroundAdd ?? true,
      iconGlow: extConfig.iconGlow ?? true,
      highlightTags: extConfig.highlightTags ?? false,
      tagHighlights: extConfig.tagHighlights || {},
    }
  })

  ipcMain.handle('save-extension-settings', async (_event, newExtConfig) => {
    const config = getConfig()
    const updatedConfig = {
      ...config,
      Extension: {
        ...(config.Extension || {}),
        ...newExtConfig,
      },
    }
    await saveSettings(updatedConfig)

    const extConfig = updatedConfig.Extension || {}
    if (extConfig.rpcEnabled !== false) {
      startExtensionServer({
        port: extConfig.rpcPort || 57096,
        getConfig: () => ctx.getConfig(),
      })
    } else {
      stopExtensionServer()
    }

    return {
      success: true,
      running: isExtensionServerRunning(),
      port: extConfig.rpcPort || 57096,
    }
  })
}

module.exports = {
  registerExtensionHandlers,
}
