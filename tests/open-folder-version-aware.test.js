import { test, expect } from 'vitest'
import { buildGameContextMenu } from '../src/components/library/gameContextMenu.js'

// "Open Game Folder" is version-aware: one row per version, each opening ITS
// folder. The row and the Play row are built from DIFFERENT candidate lists on
// purpose -- see the header of gameContextMenu.js for why one shared list was
// wrong.
//
// Every test here failed against the pre-fix builder except where noted.

const find = (items, label) => items.find((i) => i.label === label)
const manage = (items) => find(items, 'Manage').submenu
const folderRow = (items) => find(manage(items), 'Open Game Folder')

const game = (versions, over = {}) => ({
  record_id: 7,
  title: 'Test Game',
  versions,
  ...over,
})

// A normal F95/manual import: a real executable on disk.
const localVersion = (over = {}) => ({
  version: 'v1.0',
  version_id: 1,
  game_path: '/games/Test/v1.0',
  exec_path: '/games/Test/v1.0/game.exe',
  isInstalled: true,
  ...over,
})

// Steam and GOG versions are written with an EMPTY executable -- they launch
// through steam://run and goggalaxy://openGameView. See the upsertVersion calls
// in electron/ipc/importer.js.
const steamVersion = (over = {}) => ({
  version: 'Steam',
  version_id: 2,
  game_path: '/steam/steamapps/common/Test',
  exec_path: '',
  source: 'steam',
  source_app_id: '620',
  isInstalled: true,
  ...over,
})

const gogVersion = (over = {}) => ({
  version: 'GOG',
  version_id: 3,
  game_path: '/gog/Test',
  exec_path: '',
  source: 'gog',
  source_app_id: '1207658930',
  isInstalled: true,
  ...over,
})

// ── The reported bug ────────────────────────────────────────────────────────
//
// The candidate list was `versions.filter(v => v.exec_path && ...)`, so a Steam
// or GOG version -- which has no exec_path by design -- was filtered out before
// either row was built. The submenu was correct; it just never rendered for
// those titles.

test('a Steam-only title gets an Open Game Folder row', () => {
  const items = buildGameContextMenu({ game: game([steamVersion()]) })
  expect(folderRow(items)).toBeDefined()
})

test('a GOG-only title gets an Open Game Folder row', () => {
  const items = buildGameContextMenu({ game: game([gogVersion()]) })
  expect(folderRow(items)).toBeDefined()
})

// The same filter fed Play, so fixing one without the other would leave Steam
// and GOG titles unlaunchable from the menu.
test('a Steam-only title gets a Play row', () => {
  expect(find(buildGameContextMenu({ game: game([steamVersion()]) }), 'Play')).toBeDefined()
})

test('a GOG-only title gets a Play row', () => {
  expect(find(buildGameContextMenu({ game: game([gogVersion()]) }), 'Play')).toBeDefined()
})

test('a title mixing F95, Steam and GOG lists all three folders', () => {
  const items = buildGameContextMenu({
    game: game([localVersion(), steamVersion(), gogVersion()]),
  })
  expect(folderRow(items).submenu.map((r) => r.label).sort())
    .toEqual(['GOG', 'Steam', 'v1.0'])
})

// ── Version identity ────────────────────────────────────────────────────────
//
// The payload carried the version STRING, resolved with `WHERE version = ?
// ... LIMIT 1`. versions has UNIQUE(record_id, version), so that is unambiguous
// on a current-schema database -- but clientAudit.js counts duplicate version
// rows and reports them as "not auto-repaired", so legacy databases carry them,
// and SQLite treats NULLs as distinct under UNIQUE so blank-version rows slip
// past it entirely. versionId is exact in every one of those cases.

test('every folder row carries the version_id it belongs to', () => {
  const items = buildGameContextMenu({
    game: game([localVersion(), steamVersion(), gogVersion()]),
  })
  for (const row of folderRow(items).submenu) {
    expect(row.data.action).toBe('openFolder')
    expect(row.data.recordId).toBe(7)
    expect(typeof row.data.versionId).toBe('number')
  }
})

test('a folder row resolves to its OWN version, not the newest', () => {
  const items = buildGameContextMenu({
    game: game([
      localVersion({ version: 'v1.0', version_id: 11, game_path: '/games/a' }),
      localVersion({ version: 'v2.0', version_id: 22, game_path: '/games/b' }),
    ]),
  })
  const rows = folderRow(items).submenu
  expect(rows.find((r) => r.label === 'v1.0').data.versionId).toBe(11)
  expect(rows.find((r) => r.label === 'v2.0').data.versionId).toBe(22)
})

// Two rows sharing a label is exactly the case the string could not express.
test('duplicate version labels still address distinct folders', () => {
  const items = buildGameContextMenu({
    game: game([
      localVersion({ version: 'v1.0', version_id: 11, game_path: '/games/f95' }),
      steamVersion({ version: 'v1.0', version_id: 22 }),
    ]),
  })
  const ids = folderRow(items).submenu.map((r) => r.data.versionId)
  expect(new Set(ids).size).toBe(2)
})

test('the launch payload carries version_id and the version source', () => {
  const items = buildGameContextMenu({ game: game([steamVersion()]) })
  const play = find(items, 'Play')
  expect(play.data.versionId).toBe(2)
  // launchGame picks steam:// over goggalaxy:// from `source`, and prefers the
  // VERSION's appid over the title-level mapping. handleContextAction dropped
  // both, so a title holding two Steam versions launched whichever one the
  // title mapping pointed at.
  expect(play.data.source).toBe('steam')
  expect(play.data.sourceAppId).toBe('620')
})

// ── Missing versions ────────────────────────────────────────────────────────
//
// Shown rather than hidden: a row that silently vanishes tells the user
// nothing. installState already distinguishes installed / pending / missing.

test('a version whose folder is gone is listed, disabled and marked', () => {
  const items = buildGameContextMenu({
    game: game([
      localVersion(),
      localVersion({ version: 'v0.9', version_id: 9, isInstalled: false }),
    ]),
  })
  const missing = folderRow(items).submenu.find((r) => r.label === 'v0.9')
  expect(missing).toBeDefined()
  expect(missing.disabled).toBe(true)
  expect(missing.hint).toMatch(/missing/i)
})

test('a missing version is not offered for Play', () => {
  const items = buildGameContextMenu({
    game: game([
      localVersion(),
      localVersion({ version: 'v0.9', version_id: 9, isInstalled: false }),
    ]),
  })
  expect(find(items, 'Play').submenu ?? []).not.toContainEqual(
    expect.objectContaining({ label: 'v0.9' }),
  )
})

// A version with no path recorded has no folder to open under any
// circumstances, so it is not a folder candidate at all.
test('a version with no game_path is left out of the folder list', () => {
  const items = buildGameContextMenu({
    game: game([localVersion(), localVersion({ version: 'v0.8', version_id: 8, game_path: '' })]),
  })
  // One candidate left, so the row is direct rather than a submenu of one.
  const row = folderRow(items)
  expect(row.submenu).toBeUndefined()
  expect(row.data.versionId).toBe(1)
})

// ── Guards (pass before and after) ──────────────────────────────────────────

test('a single-version title still gets a directly clickable folder row', () => {
  const items = buildGameContextMenu({ game: game([localVersion()]) })
  const row = folderRow(items)
  expect(row.data.action).toBe('openFolder')
  expect(row.submenu).toBeUndefined()
})

test('the folder submenu keeps the detail page ordering', () => {
  const items = buildGameContextMenu({
    game: game([
      localVersion({ version: 'v0.9.11', version_id: 1 }),
      localVersion({ version: 'v0.10.0', version_id: 2 }),
      localVersion({ version: 'v1.2', version_id: 3 }),
    ]),
  })
  expect(folderRow(items).submenu.map((r) => r.label))
    .toEqual(['v1.2', 'v0.10.0', 'v0.9.11'])
})

test('a title with no versions gets no folder row', () => {
  const items = buildGameContextMenu({ game: game([]) })
  expect(folderRow(items)).toBeUndefined()
})
