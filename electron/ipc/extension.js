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
  // ── Why the target is dataDir and not the install root ────────────────────
  //
  // This used to be `path.join(appDataRoot, 'extension')`, and on Windows
  // appDataRoot IS the install directory — dataLocation.js resolveDataRoot
  // returns installDir on win32. So the target was
  // `C:\Program Files\Atlas\extension`, and the copy failed with EPERM every
  // time, because:
  //
  //   * build/installer.nsh grants the Users group modify rights on
  //     `$INSTDIR\data` and `$INSTDIR\launchers` and DELIBERATELY not on
  //     $INSTDIR itself — that folder holds Atlas.exe, and a user-writable
  //     directory of executables that something elevated later runs is a
  //     privilege-escalation route. The comment there says so explicitly.
  //   * Atlas runs unelevated after install, on purpose: it launches game
  //     executables and a child process inherits its parent's elevation.
  //
  // So the old target was a folder the app is never permitted to write to, by a
  // security decision that is correct and is not going to change. `data\` is
  // where every other piece of runtime state already lives (config.ini, images,
  // logs, the database) for exactly this reason.
  //
  // It also survives updates. installer.nsh's DeleteLoop wipes every subfolder
  // of $INSTDIR except data and launchers, so even a writable
  // `$INSTDIR\extension` would have been deleted on every upgrade — and Chrome
  // would have lost the unpacked extension it was pointed at.
  //
  // Older per-user installs (the perMachine:false builds) landed in
  // %LOCALAPPDATA%, which IS writable, so this worked there. That is why it
  // looked like a regression introduced by the per-machine switch rather than a
  // wrong path all along. Any stale copy left at the old location is removed by
  // the next installer run.
  const dataDir =
    ctx?.dataDir ||
    path.join(ctx?.appDataRoot || app.getPath('userData'), 'data')
  const targetDir = path.join(dataDir, 'extension')

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
  if (!sourceDir) {
    const error = `No extension source directory found. Looked in: ${candidates.join(', ')}`
    console.error(error)
    return { extensionPath: targetDir, ok: false, error, sourceDir: '' }
  }
  if (path.resolve(sourceDir) === path.resolve(targetDir)) {
    return { extensionPath: targetDir, ok: true, error: '', sourceDir }
  }

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
    // ── Reported, not swallowed ─────────────────────────────────────────────
    //
    // This used to log and return the target path regardless, so every caller
    // got a path that looked fine and a folder that was not there. The settings
    // page then said "Extension directory does not exist", which is true and
    // useless: it describes the symptom and names neither the source it tried
    // nor the reason it failed. An EPERM on Program Files and a missing build
    // artefact produced identical output.
    const error =
      `Could not copy the extension from ${sourceDir} to ${targetDir}: `
      + `${err.message || String(err)}`
    console.error(error)
    return { extensionPath: targetDir, ok: false, error, sourceDir }
  }

  return {
    extensionPath: targetDir,
    ok: fs.existsSync(path.join(targetDir, 'manifest.json')),
    error: '',
    sourceDir,
  }
}

function registerExtensionHandlers(ctx) {
  const getConfig = () => ctx.getConfig()
  const saveSettings = (newConfig) => ctx.saveSettings(newConfig)

  // Done once at startup, not only when the settings page asks. Every call site
  // below is behind a screen the user has to go looking for, so until one of
  // them ran, the folder Chrome needs simply did not exist — and someone who
  // installed Atlas and went straight to `Load unpacked` found nothing there,
  // with nothing having gone wrong from Atlas's point of view.
  //
  // Cheap enough to be unconditional: seven small files, and the mtime check
  // means the copy itself is skipped on every launch after the first.
  const initial = ensureExtensionFiles(ctx)
  if (!initial.ok) {
    console.error('Extension files are not ready:', initial.error)
  }

  ipcMain.handle('get-extension-status', async () => {
    const config = getConfig()
    const extConfig = config.Extension || {}
    const port = extConfig.rpcPort || 57096
    const rpcEnabled = extConfig.rpcEnabled ?? true

    const extension = ensureExtensionFiles(ctx)

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
      extensionPath: extension.extensionPath,
      // The settings page can now say WHY the folder is missing instead of
      // only that it is. An unwritable install directory and a build with no
      // extension in it are different problems with different remedies, and
      // they used to produce the same sentence.
      extensionReady: extension.ok,
      extensionError: extension.error,
    }
  })

  // Chrome cannot load an unpacked extension from inside app.asar, which is
  // why ensureExtensionFiles copies it out to the user data directory first.
  // Settings shows this path so the user can paste it into 'Load unpacked'.
  ipcMain.handle('get-extension-path', async () => {
    const extension = ensureExtensionFiles(ctx)
    return {
      extensionPath: extension.extensionPath,
      exists: fs.existsSync(extension.extensionPath),
      ready: extension.ok,
      error: extension.error,
      sourceDir: extension.sourceDir,
    }
  })

  // Same copy-out as get-extension-path, then reveals the folder in the OS file
  // manager -- the path is long and buried in appdata, so asking the user to
  // navigate there by hand is a reliable way to lose them.
  ipcMain.handle('open-extension-folder', async () => {
    const extension = ensureExtensionFiles(ctx)
    if (fs.existsSync(extension.extensionPath)) {
      await shell.openPath(extension.extensionPath)
      return { success: true, extensionPath: extension.extensionPath }
    }
    // Carries the real reason. 'Extension directory does not exist' was true
    // and unactionable -- it named neither the source tried nor the failure.
    return {
      success: false,
      extensionPath: extension.extensionPath,
      error: extension.error || `Extension directory does not exist: ${extension.extensionPath}`,
    }
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
