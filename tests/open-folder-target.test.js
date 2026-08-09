import { describe, test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { createGameFolderOpener } from '../electron/library/gameFolder.js'

// Resolving a folder to open is a DIFFERENT question from resolving a version
// to launch, which is why this module exists beside getTrustedVersion rather
// than reusing it.
//
//   launch  needs an executable on disk, OR a Steam appid, OR a GOG id. The
//           handoff branches in launchGame do not need game_path to exist.
//   folder  needs one thing: a directory on disk.
//
// Sharing getTrustedVersion's "is this version installed" gate meant the folder
// was judged by rules written for launching. It also meant Steam and GOG had to
// be special-cased here, which is exactly the divergence that made GOG
// unreliable -- getVersionForRecord joins only steam_mappings, so it has no GOG
// branch at all.
//
// Nothing in here consults source, source_app_id, in_place or exec_path. That
// is the point.

const rows = {
  11: { version_id: 11, version: 'v1.0', game_path: '/games/Test/v1.0', exec_path: '/games/Test/v1.0/game.exe' },
  // Steam and GOG versions have NO executable. They must still open.
  22: { version_id: 22, version: 'Steam', game_path: '/steam/steamapps/common/Test', exec_path: '', source: 'steam' },
  33: { version_id: 33, version: 'GOG', game_path: '/gog/Test', exec_path: '', source: 'gog' },
  44: { version_id: 44, version: 'v0.9', game_path: '/games/Test/gone', exec_path: '' },
  55: { version_id: 55, version: 'v0.8', game_path: '', exec_path: '' },
  66: { version_id: 66, version: 'v0.7', game_path: '/games/Test/afile.zip', exec_path: '' },
}

const existing = new Set([
  '/games/Test/v1.0',
  '/steam/steamapps/common/Test',
  '/gog/Test',
  '/games/Test/afile.zip',
])
const files = new Set(['/games/Test/afile.zip'])

const build = (over = {}) => {
  const opened = []
  const opener = createGameFolderOpener({
    getVersionById: async (recordId, versionId) =>
      (Number(recordId) === 7 ? rows[versionId] : null) || null,
    getVersionForRecord: async (recordId, version) =>
      (Number(recordId) === 7
        ? Object.values(rows).find((r) => r.version === version)
        : null) || null,
    shell: {
      openPath: async (target) => {
        opened.push(target)
        return over.openPathError || ''
      },
    },
    fs: {
      promises: {
        stat: async (target) => {
          if (!existing.has(target)) {
            const err = new Error(`ENOENT: no such file or directory, stat '${target}'`)
            err.code = 'ENOENT'
            throw err
          }
          return { isDirectory: () => !files.has(target) }
        },
      },
    },
  })
  return { opener, opened }
}

describe('openGameFolderForVersion', () => {
  test('opens the folder addressed by version_id', async () => {
    const { opener, opened } = build()
    const result = await opener({ recordId: 7, versionId: 11 })
    expect(result.success).toBe(true)
    expect(opened).toEqual(['/games/Test/v1.0'])
  })

  // The reported bug, at the other end of the wire. A Steam version has no
  // exec_path, so getTrustedVersion's install rule was the only thing standing
  // between it and the folder.
  test('opens a Steam version with no executable', async () => {
    const { opener, opened } = build()
    const result = await opener({ recordId: 7, versionId: 22 })
    expect(result.success).toBe(true)
    expect(opened).toEqual(['/steam/steamapps/common/Test'])
  })

  test('opens a GOG version with no executable', async () => {
    const { opener, opened } = build()
    const result = await opener({ recordId: 7, versionId: 33 })
    expect(result.success).toBe(true)
    expect(opened).toEqual(['/gog/Test'])
  })

  // version_id is a bare rowid (versions has no INTEGER PRIMARY KEY), and
  // rowids are not guaranteed stable across the VACUUM that clientAudit runs.
  // Scoping the lookup by record_id means a rotated id resolves to nothing
  // rather than to some other game's folder.
  test('a version id belonging to another record resolves to nothing', async () => {
    const { opener, opened } = build()
    const result = await opener({ recordId: 8, versionId: 11 })
    expect(result.success).toBe(false)
    expect(opened).toEqual([])
  })

  // ── Error reasons ─────────────────────────────────────────────────────────
  //
  // These were all one silent no-op. windows.js ended in
  // `.catch(err => console.error(...))`, games.js returned {success,error} that
  // GameDetailPage discarded, and shell.openPath returns an error STRING rather
  // than throwing -- which neither handler inspected, so a path that did not
  // exist reported success.

  test('a missing folder is reported, and names the path', async () => {
    const { opener, opened } = build()
    const result = await opener({ recordId: 7, versionId: 44 })
    expect(result.success).toBe(false)
    expect(result.error).toContain('/games/Test/gone')
    expect(opened).toEqual([])
  })

  test('a version with no path recorded is reported as such', async () => {
    const { opener, opened } = build()
    const result = await opener({ recordId: 7, versionId: 55 })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/no folder/i)
    expect(opened).toEqual([])
  })

  test('a path that is a file rather than a directory is refused', async () => {
    const { opener, opened } = build()
    const result = await opener({ recordId: 7, versionId: 66 })
    expect(result.success).toBe(false)
    expect(opened).toEqual([])
  })

  // shell.openPath resolves with a non-empty string on failure. Discarding it
  // is how "success" was reported for a folder that never opened.
  test("openPath's error string is surfaced, not discarded", async () => {
    const { opener } = build({ openPathError: 'Failed to open path' })
    const result = await opener({ recordId: 7, versionId: 11 })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Failed to open path')
  })

  test('an unknown version id is reported rather than opening something else', async () => {
    const { opener, opened } = build()
    const result = await opener({ recordId: 7, versionId: 999 })
    expect(result.success).toBe(false)
    expect(opened).toEqual([])
  })

  // The IPC payload kept its version-string form for callers that have not been
  // migrated. It resolves the same way; it is only ambiguous where the database
  // holds duplicate or blank version labels, which is why nothing NEW sends it.
  test('a version string still resolves when no id is given', async () => {
    const { opener, opened } = build()
    const result = await opener({ recordId: 7, version: 'v1.0' })
    expect(result.success).toBe(true)
    expect(opened).toEqual(['/games/Test/v1.0'])
  })

  test('an id wins over a string when both are sent', async () => {
    const { opener, opened } = build()
    await opener({ recordId: 7, versionId: 33, version: 'v1.0' })
    expect(opened).toEqual(['/gog/Test'])
  })

  test('a missing record id is refused without touching the shell', async () => {
    const { opener, opened } = build()
    const result = await opener({ versionId: 11 })
    expect(result.success).toBe(false)
    expect(opened).toEqual([])
  })
})

// main.js is not loadable in a test (it builds windows and opens a database), so
// the wiring is read instead. Without this the opener could be entirely correct
// and never reach a handler -- the "handler with no caller" shape CLAUDE.md
// warns about, in the other direction.
describe('main.js wiring', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8')

  test('the opener is built with the real lookups and io', () => {
    expect(main).toContain('createGameFolderOpener')
    const start = main.indexOf('createGameFolderOpener({')
    const call = main.slice(start, main.indexOf('})', start))
    for (const dep of ['getVersionById', 'getVersionForRecord', 'shell', 'fs']) {
      expect(call).toContain(dep)
    }
  })

  test('it is exposed on ctx, where both handlers read it', () => {
    expect(main).toMatch(/openGameFolderForVersion,/)
  })

  // The gate this exists to stay clear of. Opening a folder must not start
  // asking whether the version is installed again.
  test('the folder path does not go through getTrustedVersion', () => {
    const games = fs.readFileSync(
      path.join(__dirname, '..', 'electron', 'ipc', 'games.js'), 'utf8')
    const start = games.indexOf("ipcMain.handle('open-game-folder'")
    const body = games.slice(start, start + 300)
    expect(body).not.toContain('getTrustedVersion')

    const windows = fs.readFileSync(
      path.join(__dirname, '..', 'electron', 'ipc', 'windows.js'), 'utf8')
    const openFolder = windows.slice(
      windows.indexOf('case "openFolder"'), windows.indexOf('case "openUrl"'))
    expect(openFolder).not.toContain('getTrustedVersion')
    expect(openFolder).toContain('openGameFolderForVersion')
  })
})
