import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { buildGameContextMenu } from '../src/components/library/gameContextMenu.js'

const localGame = (over = {}) => ({
  record_id: 7,
  title: 'Test Game',
  isFavorite: false,
  versions: [{ version: 'v1.0', version_id: 1, exec_path: '/g/a.exe' }],
  ...over,
})
const labels = (items) => items.filter((i) => !i.type).map((i) => i.label)
const find = (items, label) => items.find((i) => i.label === label)

// Consolidated from twelve flat entries to five rows, per the mock.
test('the top level is short: Play, Favorites, Add to, Manage, Properties', () => {
  const items = buildGameContextMenu({ game: localGame(), collections: [{ id: 1, name: 'RPG' }] })
  expect(labels(items)).toEqual([
    'Play', 'Add to Favorites', 'Add to', 'Manage', 'Properties…',
  ])
})

test('Play is the only item using the green variant', () => {
  const items = buildGameContextMenu({ game: localGame() })
  expect(items.filter((i) => i.variant === 'play').map((i) => i.label)).toEqual(['Play'])
})

// A native menu ignores clicks on any row with a submenu, which is why the old
// code needed a separate "Play (v1.2)" entry beside a "Play Version" submenu.
test('with multiple versions Play both launches and lists them', () => {
  const versions = [
    { version: 'v1.0', version_id: 1, exec_path: '/g/a.exe' },
    { version: 'v2.0', version_id: 2, exec_path: '/g/b.exe' },
  ]
  const items = buildGameContextMenu({ game: localGame({ versions, selected_version_id: 2 }) })
  const play = find(items, 'Play')
  // Clickable...
  expect(play.data).toEqual({ action: 'launch', recordId: 7, version: 'v2.0' })
  // ...and expandable.
  expect(play.submenu.map((s) => s.label)).toEqual(['v1.0', 'v2.0'])
  expect(play.hint).toBe('v2.0')
  // No second Play entry.
  expect(labels(items).filter((l) => l.startsWith('Play'))).toEqual(['Play'])
})

test('a game with no installed version offers no Play', () => {
  const items = buildGameContextMenu({ game: localGame({ versions: [] }) })
  expect(find(items, 'Play')).toBeUndefined()
})

test('the favorites entry reflects current state', () => {
  expect(find(buildGameContextMenu({ game: localGame() }), 'Add to Favorites').data.isFavorite).toBe(true)
  const on = buildGameContextMenu({ game: localGame({ isFavorite: true }) })
  expect(find(on, 'Remove from Favorites').data.isFavorite).toBe(false)
})

// Browse and wishlist rows have no local record, so only Play can apply.
test('catalog rows get nothing beyond Play', () => {
  const items = buildGameContextMenu({ game: localGame({ isCatalogEntry: true }) })
  expect(labels(items)).toEqual(['Play'])
})

test('destructive actions are grouped under Manage and flagged', () => {
  const manage = find(buildGameContextMenu({ game: localGame() }), 'Manage').submenu
  const danger = manage.filter((i) => i.danger).map((i) => i.label)
  expect(danger).toEqual(['Remove from Library', 'Delete Title and Files'])
  expect(labels(manage)).toContain('Rate Game…')
})

test('Remove from Collection only appears when the game is in one', () => {
  const collections = [{ id: 1, name: 'RPG' }]
  const without = find(buildGameContextMenu({ game: localGame(), collections }), 'Manage').submenu
  expect(labels(without)).not.toContain('Remove from Collection')

  const withMembership = find(
    buildGameContextMenu({
      game: localGame(),
      collections,
      collectionIdsByRecord: new Map([[7, [1]]]),
    }),
    'Manage',
  ).submenu
  expect(labels(withMembership)).toContain('Remove from Collection')
})

// Payloads must match what the native templates used, since they route through
// the same handleContextAction and keep its confirmations.
test('action payloads reuse the existing dispatch names', () => {
  const items = buildGameContextMenu({ game: localGame() })
  expect(find(items, 'Properties…').data.action).toBe('properties')
  const manage = find(items, 'Manage').submenu
  expect(find(manage, 'Rate Game…').data.action).toBe('rateTitleRequested')
  expect(find(manage, 'Delete Title and Files').data.action).toBe('deleteTitleAndFiles')
})

test('the main process exposes a dispatch entry point with ctx', () => {
  const windows = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'ipc', 'windows.js'), 'utf8')
  expect(windows).toContain("ipcMain.handle('run-context-action'")
  // Without ctx the collection and delete actions throw.
  expect(windows).toMatch(/handleContextAction\(data, event\.sender, ctx\)/)
})

// The listener sits in a []-dependency effect, so it must not read state.
test('the rating request is resolved by an effect, not the listener closure', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8')
  const start = app.indexOf('onRateTitleRequested')
  const body = app.slice(start, start + 500)
  expect(body).not.toMatch(/games\.find/)
  expect(app).toMatch(/if \(!pendingRatingRecordId\) return/)
})
