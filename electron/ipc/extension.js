'use strict'

const { app, ipcMain, shell } = require('electron')
const fs = require('fs')
const path = require('path')
const {
  startExtensionServer,
  stopExtensionServer,
  isExtensionServerRunning,
} = require('../rpc/extensionServer')

function ensureExtensionFiles(ctx) {
  const rootPath =
    ctx?.appDataRoot ||
    (ctx?.dataDir ? path.dirname(ctx.dataDir) : app.getPath('userData'))
  const targetDir = path.join(rootPath, 'extension')

  const appPath = app?.getAppPath ? app.getAppPath() : process.cwd()
  const candidates = [
    path.join(appPath, 'extension'),
    path.join(__dirname, '../../extension'),
    path.join(process.resourcesPath || '', 'extension'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'extension'),
  ]

  const sourceDir = candidates.find((p) => fs.existsSync(p))
  if (sourceDir && path.resolve(sourceDir) !== path.resolve(targetDir)) {
    try {
      const targetManifest = path.join(targetDir, 'manifest.json')
      const sourceManifest = path.join(sourceDir, 'manifest.json')
      let shouldCopy = false

      if (!fs.existsSync(targetDir) || !fs.existsSync(targetManifest)) {
        shouldCopy = true
      } else if (fs.existsSync(sourceManifest)) {
        const sourceStat = fs.statSync(sourceManifest)
        const targetStat = fs.statSync(targetManifest)
        if (sourceStat.mtimeMs > targetStat.mtimeMs) {
          shouldCopy = true
        }
      }

      if (shouldCopy) {
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true })
        }
        fs.cpSync(sourceDir, targetDir, { recursive: true, force: true })
      }
    } catch (err) {
      console.error('Failed to sync extension files:', err)
    }
  }

  return targetDir
}

function registerExtensionHandlers(ctx) {
  const getConfig = () => ctx.getConfig()
  const saveSettings = (newConfig) => ctx.saveSettings(newConfig)

  ipcMain.handle('get-extension-status', async () => {
    const config = getConfig()
    const extConfig = config.Extension || {}
    const port = extConfig.rpcPort || 57096
    const rpcEnabled = extConfig.rpcEnabled ?? true

    const extensionPath = ensureExtensionFiles(ctx)

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
      extensionPath,
    }
  })

  // Chrome cannot load an unpacked extension from inside app.asar, which is
  // why ensureExtensionFiles copies it out to the user data directory first.
  // Settings shows this path so the user can paste it into 'Load unpacked'.
  ipcMain.handle('get-extension-path', async () => {
    const extensionPath = ensureExtensionFiles(ctx)
    return { extensionPath, exists: fs.existsSync(extensionPath) }
  })

  // Same copy-out as get-extension-path, then reveals the folder in the OS file
  // manager -- the path is long and buried in appdata, so asking the user to
  // navigate there by hand is a reliable way to lose them.
  ipcMain.handle('open-extension-folder', async () => {
    const extensionPath = ensureExtensionFiles(ctx)
    if (fs.existsSync(extensionPath)) {
      await shell.openPath(extensionPath)
      return { success: true, extensionPath }
    }
    return { success: false, error: 'Extension directory does not exist' }
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
  ensureExtensionFiles,
  registerExtensionHandlers,
}
