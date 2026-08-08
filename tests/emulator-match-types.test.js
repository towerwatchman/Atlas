import { test, expect } from 'vitest'
const fs = require('fs')
const os = require('os')
const path = require('path')
const sqlite3 = require('sqlite3').verbose()

const dbIndex = require('../electron/db/index.js')
const {
  saveEmulatorConfig,
  getEmulatorConfig,
  removeEmulatorConfig,
  getEmulatorByExtension,
  getEmulatorForFile,
} = require('../electron/db/settings.js')

// ── Emulator mappings match an extension OR a whole file name ────────────────
//
// The table used to be keyed on `extension` alone, which made ".sh" the only
// thing a user could say. There was no way to express "this ONE launcher needs
// a different wrapper" without changing how every shell script in the library
// runs — and because the key was a single column, a file-name mapping and an
// extension mapping that happened to spell the same could not have coexisted
// anyway: INSERT OR REPLACE would have deleted one to write the other.
//
// These drive the real db/settings.js against a real sqlite file, because the
// interesting parts are the schema migration and the SQL normalisation, and a
// stub would assert neither.

const freshDataDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-emulators-'))

const tableInfo = () => new Promise((resolve, reject) => {
  dbIndex.db.all('PRAGMA table_info(emulators)', (err, rows) =>
    (err ? reject(err) : resolve(rows || [])))
})

// initializeDatabase queues its DDL and then runs the key-widening rebuild from
// a PRAGMA callback, so it finishes after any statement issued straight after
// the call. Polling the schema is the only honest way to know it has landed.
const waitForCompositeKey = async () => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const columns = await tableInfo()
    const matchType = columns.find((column) => column.name === 'match_type')
    if (matchType && matchType.pk > 0) return columns
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('the emulators table never gained its (match_type, extension) key')
}

const openFreshDatabase = async () => {
  dbIndex.initializeDatabase(freshDataDir())
  return waitForCompositeKey()
}

test('the emulators table is keyed on both the match type and the key', async () => {
  const columns = await openFreshDatabase()
  const keyColumns = columns.filter((column) => column.pk > 0).map((column) => column.name)
  expect(keyColumns.sort()).toEqual(['extension', 'match_type'])
})

test('an extension mapping and a file-name mapping can share a key string', async () => {
  await openFreshDatabase()
  // A Linux build with no suffix really can be called "sh". Under the old
  // single-column key the second write silently replaced the first.
  await saveEmulatorConfig({ extension: 'sh', match_type: 'extension', program_path: '/usr/bin/bash' })
  await saveEmulatorConfig({ extension: 'sh', match_type: 'filename', program_path: '/usr/bin/zsh' })

  const rows = await getEmulatorConfig()
  expect(rows).toHaveLength(2)
  expect(rows.map((row) => row.match_type).sort()).toEqual(['extension', 'filename'])
})

test('a file-name mapping beats the extension mapping for that one file', async () => {
  await openFreshDatabase()
  await saveEmulatorConfig({ extension: 'sh', match_type: 'extension', program_path: '/usr/bin/bash' })
  await saveEmulatorConfig({ extension: 'game.sh', match_type: 'filename', program_path: '/opt/special/run' })

  // The whole point of the file-name mapping: it is the exception, so it wins.
  const exception = await getEmulatorForFile({ fileName: 'game.sh', extension: 'sh' })
  expect(exception.program_path).toBe('/opt/special/run')

  // Everything else still falls through to the extension rule.
  const general = await getEmulatorForFile({ fileName: 'other.sh', extension: 'sh' })
  expect(general.program_path).toBe('/usr/bin/bash')
})

test('a file name is stored by base name and matched case-insensitively', async () => {
  await openFreshDatabase()
  // Users browse to the launcher rather than typing it, so a full path arrives.
  // Keeping the directory would tie the mapping to one install location.
  await saveEmulatorConfig({
    extension: 'C:\\Games\\Thing\\Game.SH',
    match_type: 'filename',
    program_path: '/opt/special/run',
  })

  const [row] = await getEmulatorConfig()
  expect(row.extension).toBe('game.sh')
  expect(await getEmulatorForFile({ fileName: 'game.sh', extension: 'sh' })).toBeTruthy()
})

test('an extension mapping ignores a file that merely ends the same way', async () => {
  await openFreshDatabase()
  await saveEmulatorConfig({ extension: 'game.sh', match_type: 'filename', program_path: '/opt/special/run' })

  // "game.sh" is a file name, not an extension, so the extension lookup must
  // not see it — otherwise a file-name mapping would leak into every .sh title.
  expect(await getEmulatorByExtension('sh')).toBeUndefined()
  expect(await getEmulatorForFile({ fileName: 'other.sh', extension: 'sh' })).toBeUndefined()
})

test('removing one kind of mapping leaves the other in place', async () => {
  await openFreshDatabase()
  await saveEmulatorConfig({ extension: 'sh', match_type: 'extension', program_path: '/usr/bin/bash' })
  await saveEmulatorConfig({ extension: 'sh', match_type: 'filename', program_path: '/usr/bin/zsh' })

  await removeEmulatorConfig('sh', 'filename')

  const rows = await getEmulatorConfig()
  expect(rows).toHaveLength(1)
  expect(rows[0].match_type).toBe('extension')
  expect((await getEmulatorByExtension('sh')).program_path).toBe('/usr/bin/bash')
})

test('a database written before file-name matching keeps its mappings', async () => {
  const dataDir = freshDataDir()
  await new Promise((resolve, reject) => {
    const legacy = new sqlite3.Database(path.join(dataDir, 'data.db'))
    legacy.serialize(() => {
      legacy.run(`
        CREATE TABLE emulators
        (
          extension TEXT PRIMARY KEY,
          program_path TEXT NOT NULL,
          parameters TEXT
        );
      `)
      legacy.run(
        'INSERT INTO emulators (extension, program_path, parameters) VALUES (?, ?, ?)',
        ['.SH', '/usr/bin/bash', '-x'],
        (err) => (err ? reject(err) : legacy.close(resolve)),
      )
    })
  })

  dbIndex.initializeDatabase(dataDir)
  await waitForCompositeKey()

  // The row survives the rebuild, is treated as an extension mapping, and is
  // still found through the dot-and-case tolerance it was stored with.
  const existing = await getEmulatorByExtension('sh')
  expect(existing).toBeTruthy()
  expect(existing.program_path).toBe('/usr/bin/bash')
  expect(existing.parameters).toBe('-x')

  // And the thing the migration exists for now works on that same database.
  await saveEmulatorConfig({ extension: 'sh', match_type: 'filename', program_path: '/opt/special/run' })
  expect(await getEmulatorConfig()).toHaveLength(2)
})
