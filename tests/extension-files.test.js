import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// ── The extension has to land somewhere writable ─────────────────────────────
//
// Two rounds of this bug now, and each fix exposed the next one:
//
//   1. extension/**/* was in build.files but not asarUnpack, so it sat inside
//      app.asar where Chrome cannot load it.
//   2. The copy-out used fs.cpSync, which cannot read across an asar boundary.
//   3. The copy TARGET was path.join(appDataRoot, 'extension') — and on Windows
//      appDataRoot is the install directory, so that resolved to
//      C:\Program Files\Atlas\extension. installer.nsh grants the Users group
//      modify on $INSTDIR\data and $INSTDIR\launchers and deliberately not on
//      $INSTDIR itself, and Atlas runs unelevated. Every copy failed with EPERM.
//
// scripts/check-extension-packaging.js asserts the static shape of all three.
// This exercises the function, because (3) was invisible to a source scan of the
// COPY: the copy was fine, its destination was not.
//
// electron is stubbed rather than imported. The module needs app/ipcMain/shell
// at require time and none of them are available under vitest.

import Module from 'module'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

const ipcHandlers = new Map()
let tmp
let restoreLoad

// require('electron') intercepted through Module._load, the same way
// tests/main-startup-smoke.test.js does it. vi.mock cannot reach this file:
// electron/ipc/extension.js is CommonJS and calls require('electron') at load
// time, which does not go through vitest's ESM resolver.
const electronStub = () => ({
  app: {
    getAppPath: () => process.cwd(),
    getPath: () => path.join(os.tmpdir(), 'atlas-test-userdata'),
  },
  ipcMain: { handle: (channel, fn) => ipcHandlers.set(channel, fn) },
  shell: { openPath: async () => {} },
})

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-ext-'))
  ipcHandlers.clear()
  const stub = electronStub()
  const originalLoad = Module._load
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') return stub
    return originalLoad.call(this, request, parent, isMain)
  }
  restoreLoad = () => { Module._load = originalLoad }
})

afterEach(() => {
  restoreLoad?.()
  fs.rmSync(tmp, { recursive: true, force: true })
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}electron${path.sep}`)) delete require.cache[key]
  }
})

// registerExtensionHandlers calls ensureExtensionFiles once at startup and then
// registers the handlers -- so registering IS the copy.
const load = () =>
  require(path.join(__dirname, '..', 'electron', 'ipc', 'extension.js')).registerExtensionHandlers

const makeCtx = (overrides = {}) => ({
  appDataRoot: path.join(tmp, 'install'),
  dataDir: path.join(tmp, 'install', 'data'),
  getConfig: () => ({ Extension: {} }),
  saveSettings: vi.fn(async () => {}),
  ...overrides,
})

test('the extension is copied into dataDir, never into the install root', () => {
  const register = load()
  const ctx = makeCtx()
  fs.mkdirSync(ctx.dataDir, { recursive: true })

  register(ctx)

  const landed = path.join(ctx.dataDir, 'extension', 'manifest.json')
  expect(fs.existsSync(landed)).toBe(true)
  // The regression, stated as its own assertion: the install root is where the
  // old code put it, and where the app has no write permission in a real
  // install. installer.nsh also wipes every $INSTDIR subfolder except data and
  // launchers on upgrade, so anything here would not survive one either.
  expect(fs.existsSync(path.join(ctx.appDataRoot, 'extension'))).toBe(false)
})

test('the whole tree is copied, not just the top level', () => {
  const register = load()
  const ctx = makeCtx()
  fs.mkdirSync(ctx.dataDir, { recursive: true })

  register(ctx)

  const dir = path.join(ctx.dataDir, 'extension')
  // popup/ and icons/ are subdirectories. A copy that only walked one level
  // would produce a manifest Chrome loads and then refuses.
  expect(fs.existsSync(path.join(dir, 'popup', 'popup.html'))).toBe(true)
  expect(fs.existsSync(path.join(dir, 'icons', 'logo.png'))).toBe(true)
  expect(fs.existsSync(path.join(dir, 'background.js'))).toBe(true)
})

test('the folder exists before anyone opens the settings page', () => {
  // It used to be created lazily by the three IPC handlers, all of which sit
  // behind a screen the user has to go looking for. Someone who installed Atlas
  // and went straight to Chrome's Load unpacked found nothing there.
  const register = load()
  const ctx = makeCtx()
  fs.mkdirSync(ctx.dataDir, { recursive: true })

  register(ctx)

  expect(fs.existsSync(path.join(ctx.dataDir, 'extension', 'manifest.json'))).toBe(true)
  expect(ipcHandlers.has('get-extension-path')).toBe(true)
})

test('a failed copy is reported with its reason, not swallowed', async () => {
  const register = load()
  const ctx = makeCtx()
  fs.mkdirSync(ctx.dataDir, { recursive: true })
  register(ctx)

  // Stand in for the EPERM a real Program Files target produced. The old code
  // logged, returned the path anyway, and left the settings page saying
  // "Extension directory does not exist" — true, and naming neither the source
  // nor the cause.
  const dir = path.join(ctx.dataDir, 'extension')
  fs.rmSync(dir, { recursive: true, force: true })
  const spy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {
    const err = new Error('EPERM: operation not permitted')
    err.code = 'EPERM'
    throw err
  })

  const result = await ipcHandlers.get('get-extension-path')()
  spy.mockRestore()

  expect(result.ready).toBe(false)
  expect(result.error).toContain('EPERM')
  // Both ends of the copy are named, because "which of the four candidates was
  // picked" is the first question worth asking when this fails.
  expect(result.error).toContain(result.extensionPath)
  expect(result.sourceDir).toBeTruthy()
})

test('an unchanged extension is not recopied on every launch', async () => {
  const register = load()
  const ctx = makeCtx()
  fs.mkdirSync(ctx.dataDir, { recursive: true })
  register(ctx)

  const manifest = path.join(ctx.dataDir, 'extension', 'manifest.json')
  const before = fs.statSync(manifest).mtimeMs

  await ipcHandlers.get('get-extension-path')()

  // The mtime is the assertion. This test used to also drop a scratch file in
  // the target and require it to survive, which was a proxy for "nothing was
  // rewritten" back when the copy overwrote unconditionally. The sync now
  // prunes -- see the test below -- so that proxy asserts the opposite of the
  // intended behaviour. mtime measures the thing the test is named after
  // directly, and does not care what else is in the folder.
  expect(fs.statSync(manifest).mtimeMs).toBe(before)
})

test('files the source no longer ships are removed from the target', async () => {
  const register = load()
  const ctx = makeCtx()
  fs.mkdirSync(ctx.dataDir, { recursive: true })
  register(ctx)

  // The copy-out only ever added or overwrote, so the target accumulated every
  // file it had ever been given. That went from untidy to wrong when
  // extension/icons/ changed shape: a single committed 501 KB logo.png became
  // generated 16/32/48/128 PNGs, and every existing install kept the old file
  // sitting in the folder it hands to the browser. A stale manifest or script
  // left behind is loaded exactly as if it belonged there.
  const target = path.join(ctx.dataDir, 'extension')
  const stale = path.join(target, 'icons', 'logo-old.png')
  const staleDir = path.join(target, 'removed-subsystem')
  fs.mkdirSync(path.dirname(stale), { recursive: true })
  fs.writeFileSync(stale, 'left over from a previous layout')
  fs.mkdirSync(staleDir, { recursive: true })
  fs.writeFileSync(path.join(staleDir, 'old.js'), '// gone from source')

  await ipcHandlers.get('get-extension-path')()

  expect(fs.existsSync(stale)).toBe(false)
  expect(fs.existsSync(staleDir)).toBe(false)
  // Pruning must not take the real files with it.
  expect(fs.existsSync(path.join(target, 'manifest.json'))).toBe(true)
  expect(fs.existsSync(path.join(target, 'background.js'))).toBe(true)
})
