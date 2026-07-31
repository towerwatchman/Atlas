import { describe, test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// electron-updater's quitAndInstall(isSilent, isForceRunAfter) appends /S to the
// NSIS installer when isSilent is true. With /S the update applied with no
// window and no progress of any kind, which was indistinguishable from Atlas
// hanging on quit. Every call site must now pass isSilent = false.
//
// This is a source-level test on purpose: the call sites live in app.whenReady
// and ipcMain handlers that cannot be exercised without a real Electron main
// process, and the thing being protected is a single boolean argument that no
// behavioural test would ever notice changing.

const readSource = (relativePath) =>
  fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')

const SOURCES = ['electron/main.js', 'electron/ipc/updater.js']

const findQuitAndInstallCalls = (source) =>
  [...source.matchAll(/autoUpdater\.quitAndInstall\(([^)]*)\)/g)].map((match) => ({
    raw: match[0],
    args: match[1].split(',').map((arg) => arg.trim()).filter(Boolean),
  }))

describe('update installs are not silent', () => {
  test('every call site exists and is accounted for', () => {
    const total = SOURCES.reduce(
      (count, file) => count + findQuitAndInstallCalls(readSource(file)).length,
      0,
    )
    // 3 today: the ipc install handler, the ipc download-and-install handler,
    // and the auto-install-after-download path in main.js. A new call site
    // should trip this and be reviewed rather than silently inherit defaults.
    expect(total).toBe(3)
  })

  for (const file of SOURCES) {
    test(`${file} never requests a silent install`, () => {
      const calls = findQuitAndInstallCalls(readSource(file))
      expect(calls.length).toBeGreaterThan(0)
      for (const call of calls) {
        // isSilent must be passed explicitly as false. Omitting it would leave
        // electron-updater's own default in play, which is not something we want
        // this behaviour to depend on.
        expect(call.args.length).toBeGreaterThanOrEqual(1)
        expect(call.args[0]).toBe('false')
      }
    })
  }

  test('the app is still relaunched after the installer finishes', () => {
    for (const file of SOURCES) {
      for (const call of findQuitAndInstallCalls(readSource(file))) {
        expect(call.args[1]).toBe('true')
      }
    }
  })

  test('installDirectory is still supplied so the NSIS directory pages stay skipped', () => {
    // Dropping /S brings the installer UI back; without /D= (which
    // autoUpdater.installDirectory provides) a moved copy would reinstall to
    // the stale location recorded in the registry.
    const main = readSource('electron/main.js')
    expect(main).toMatch(/autoUpdater\.installDirectory\s*=\s*path\.dirname\(process\.execPath\)/)
  })
})
