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

// Consolidated from twelve flat entries to four rows. Favorites moved inside
// "Add to": it is the same kind of action as adding to a collection.
test('the top level is four rows', () => {
  const items = buildGameContextMenu({ game: localGame(), collections: [{ id: 1, name: 'RPG' }] })
  expect(labels(items)).toEqual(['Play', 'Add to', 'Manage', 'Properties…'])
})

test('Favorites sits inside Add to, above the collections', () => {
  const items = buildGameContextMenu({ game: localGame(), collections: [{ id: 1, name: 'RPG' }] })
  const addTo = find(items, 'Add to')
  expect(labels(addTo.submenu)).toEqual(['Favorites', 'RPG', '+ New Collection'])
  expect(addTo.submenu[0].data.action).toBe('favorite')
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

// One entry serves as both add and remove, ticked when already a favorite —
// matching how the version submenu marks the current selection.
test('the favorites entry toggles and shows a tick when set', () => {
  const off = find(buildGameContextMenu({ game: localGame() }), 'Add to').submenu[0]
  expect(off.data.isFavorite).toBe(true)
  expect(off.icon).not.toBe('fa-check')

  const on = find(buildGameContextMenu({ game: localGame({ isFavorite: true }) }), 'Add to').submenu[0]
  expect(on.data.isFavorite).toBe(false)
  expect(on.icon).toBe('fa-check')
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

// ── Menu rendering ──────────────────────────────────────────────────────────

const menuSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'components', 'ui', 'ContextMenu.jsx'),
  'utf8',
)

// Submenus are absolutely positioned at left:100%, entirely outside the root's
// box, so overflow-hidden on the root made every one of them invisible.
test('the root menu does not clip its submenus', () => {
  const start = menuSource.indexOf('ref={rootRef}')
  const rootTag = menuSource.slice(start, menuSource.indexOf('>', start))
  expect(rootTag).not.toContain('overflow-hidden')
})

// A single open-key meant a nested submenu set the key to its own, which made
// the parent's condition false and unmounted the branch the cursor was inside.
test('submenu open state is tracked per depth', () => {
  expect(menuSource).toContain('openPath')
  expect(menuSource).toMatch(/openPath\[depth\] === submenuKey/)
  expect(menuSource).not.toContain('openSubmenu')
})

test('opening a submenu closes any deeper ones', () => {
  expect(menuSource).toMatch(/current\.slice\(0, depth\)/)
})

// Two levels deep: Manage > Remove from Collection > <collection>.
test('nested submenus are produced for the Manage branch', () => {
  const items = buildGameContextMenu({
    game: localGame(),
    collections: [{ id: 1, name: 'RPG' }],
    collectionIdsByRecord: new Map([[7, [1]]]),
  })
  const nested = find(find(items, 'Manage').submenu, 'Remove from Collection')
  expect(nested.submenu.map((c) => c.label)).toEqual(['RPG'])
})
