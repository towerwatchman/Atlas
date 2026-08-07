'use strict'

const { app, ipcMain, shell } = require('electron')
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const path = require('path')
const {
  startExtensionServer,
  stopExtensionServer,
  isExtensionServerRunning,
} = require('../rpc/extensionServer')

// The pairing secret between the browser extension and this process. Created
// on first use and persisted in config, because a token regenerated on every
// launch would silently unpair the extension each time Atlas restarted.
//
// 32 bytes of CSPRNG output as hex. Long enough that guessing it over a
// localhost HTTP endpoint is not a threat worth modelling.
async function ensureExtensionToken(ctx) {
  const config = ctx.getConfig() || {}
  const existing = config.Extension?.rpcToken
  if (typeof existing === 'string' && existing.length >= 32) return existing

  const token = crypto.randomBytes(32).toString('hex')
  await ctx.saveSettings({
    ...config,
    Extension: { ...(config.Extension || {}), rpcToken: token },
  })
  return token
}

// ── Getting the extension onto disk ──────────────────────────────────────────
//
// Chrome cannot load an unpacked extension from inside app.asar, so the files
// are copied out to the user data directory. Two things about that copy are
// load-bearing and both were wrong:
//
// 1. THE CANDIDATE ORDER. `candidates.find(fs.existsSync)` takes the first hit,
//    and the first entry used to be `path.join(app.getAppPath(), 'extension')`
//    — which in a packaged build is `resources/app.asar/extension`. Electron
//    patches fs.existsSync to see inside asar archives, so that returned true
//    and the three real-directory fallbacks below were never reached. Real
//    directories are tried first now; the asar path is the last resort, kept
//    only so a build that somehow lacks the unpacked copy still has something
//    to point at.
//
// 2. THE COPY ITSELF. This used fs.cpSync, which does NOT work across an asar
//    boundary. Electron's asar support works by patching the PUBLIC fs module,
//    and cpSync routes almost everything through internal bindings instead —
//    measured on Node 22, the only public fs method it calls is lstatSync.
//    readdirSync, copyFileSync and mkdirSync all bypass the patched layer, see
//    app.asar as a plain file rather than a directory, and throw. The catch
//    below swallowed it, ensureExtensionFiles returned the target path anyway,
//    and get-extension-path reported a folder that was never written.
//
//    copyDirectoryRecursive is built from readdirSync/copyFileSync/mkdirSync
//    directly, which ARE the patched entry points, so it reads out of an asar
//    correctly if it ever has to.
//
// This only ever broke in packaged builds. In dev app.getAppPath() is the
// project root, so candidate 1 was a real directory and cpSync had no asar to
// cross — which is why it worked on every machine it was written on.
function copyDirectoryRecursive(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true })
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const from = path.join(sourceDir, entry.name)
    const to = path.join(targetDir, entry.name)
    if (entry.isDirectory()) copyDirectoryRecursive(from, to)
    // Symlinks are copied as their target rather than recreated. Nothing in
    // extension/ is a link today, and a dangling link in a folder the user is
    // about to hand to Chrome is worse than an extra file.
    else fs.copyFileSync(from, to)
  }
}

function ensureExtensionFiles(ctx) {
  const rootPath =
    ctx?.appDataRoot ||
    (ctx?.dataDir ? path.dirname(ctx.dataDir) : app.getPath('userData'))
  const targetDir = path.join(rootPath, 'extension')

  const appPath = app?.getAppPath ? app.getAppPath() : process.cwd()
  const resources = process.resourcesPath || ''
  // Ordered real-directories-first. `extension/**/*` is in build.asarUnpack, so
  // app.asar.unpacked/extension is where a packaged build actually keeps these
  // files; the two dev paths cover running from source; the asar path is last.
  const candidates = [
    path.join(resources, 'app.asar.unpacked', 'extension'),
    path.join(resources, 'extension'),
    path.join(__dirname, '../../extension'),
    path.join(appPath, 'extension'),
  ]

  const sourceDir = candidates.find((p) => p && fs.existsSync(p))
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
        copyDirectoryRecursive(sourceDir, targetDir)
      }
    } catch (err) {
      // Still not fatal — the settings page reports `exists: false` and the user
      // can be told rather than left with a path that is not there. The source
      // is named because "which of the four candidates did it pick" is the first
      // question worth asking when this fails.
      console.error(`Failed to sync extension files from ${sourceDir}:`, err)
    }
  } else if (!sourceDir) {
    console.error('No extension source directory found. Looked in:', candidates.join(', '))
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

  // Settings displays this so the user can paste it into the extension popup.
  // Generated on first read rather than at startup, so a user who never installs
  // the extension never has a secret sitting in their config file.
  ipcMain.handle('get-extension-token', async () => {
    const token = await ensureExtensionToken(ctx)
    return { token }
  })

  // Rotation for when a token has been pasted somewhere it shouldn't have been.
  // Deliberately unpairs the extension -- the user has to re-paste -- because a
  // rotation that left the old token working would not be a rotation.
  ipcMain.handle('regenerate-extension-token', async () => {
    const config = ctx.getConfig() || {}
    const token = crypto.randomBytes(32).toString('hex')
    await ctx.saveSettings({
      ...config,
      Extension: { ...(config.Extension || {}), rpcToken: token },
    })
    return { token }
  })

  // Runs from the main process rather than the renderer on purpose: main is not
  // subject to CORS, so Settings can verify the server without the renderer
  // origin needing to appear in the allowlist or the token reaching the page.
  ipcMain.handle('test-extension-connection', async () => {
    const config = ctx.getConfig() || {}
    const port = config.Extension?.rpcPort || 57096
    const token = await ensureExtensionToken(ctx)

    return new Promise((resolve) => {
      const req = http.get(
        { host: '127.0.0.1', port, path: '/api/status', headers: { 'X-Atlas-Token': token } },
        (res) => {
          let body = ''
          res.on('data', (chunk) => { body += chunk })
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                resolve({ success: true, data: JSON.parse(body) })
              } catch {
                resolve({ success: false, error: 'Server returned a malformed response' })
              }
            } else if (res.statusCode === 401) {
              resolve({ success: false, error: 'Server rejected the token. Try regenerating it.' })
            } else {
              resolve({ success: false, error: `Server responded with ${res.statusCode}` })
            }
          })
        },
      )
      req.on('error', () => resolve({ success: false, error: 'Atlas RPC server is not reachable' }))
      req.setTimeout(3000, () => { req.destroy(); resolve({ success: false, error: 'Connection timed out' }) })
    })
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
