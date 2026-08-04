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
    const port = extConfig.rpcPort || 57096
    const rpcEnabled = extConfig.rpcEnabled ?? true

    const isRunning = await isExtensionServerRunning()
    if (rpcEnabled && !isRunning) {
      startExtensionServer({
        port,
        getConfig: () => ctx.getConfig(),
      })
      // Small delay for server to start listening
      await new Promise((resolve) => setTimeout(resolve, 50))
    }

    return {
      running: await isExtensionServerRunning(),
      port,
      rpcEnabled,
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
      running: await isExtensionServerRunning(),
      port: extConfig.rpcPort || 57096,
    }
  })
}

module.exports = {
  registerExtensionHandlers,
}
