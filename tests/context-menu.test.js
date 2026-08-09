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
  expect(addTo.submenu[0].data.action).toBe('setFavorite')
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
  // Clickable... The payload also carries versionId and the version's source now
  // (see tests/open-folder-version-aware.test.js); this asserts the routing part.
  expect(play.data).toMatchObject({ action: 'launch', recordId: 7, version: 'v2.0' })
  // ...and expandable, newest first.
  expect(play.submenu.map((s) => s.label)).toEqual(['v2.0', 'v1.0'])
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

// Favorites silently did nothing for a while because the menu emitted
// 'favorite' and the switch only had 'setFavorite' — a mismatch that no unit
// test on either side could catch. This walks the whole built tree and asserts
// every action name has a matching case, so the next rename fails loudly here.
test('every action the menu emits has a case in handleContextAction', () => {
  const windows = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'ipc', 'windows.js'), 'utf8')
  const handled = new Set(
    [...windows.matchAll(/case\s+["']([A-Za-z]+)["']\s*:/g)].map((m) => m[1]))

  const collect = (items, out = new Set()) => {
    for (const item of items) {
      if (item?.data?.action) out.add(item.data.action)
      if (item?.submenu) collect(item.submenu, out)
    }
    return out
  }

  // A game with every optional branch turned on, so no action goes unvisited.
  const game = localGame({
    isFavorite: false,
    siteUrl: 'https://f95zone.to/threads/game.12345/',
    steam_id: '620',
    versions: [
      { version: 'v1.0', version_id: 1, exec_path: '/g/a.exe' },
      { version: 'v1.1', version_id: 2, exec_path: '/g/b.exe' },
    ],
  })
  const items = buildGameContextMenu({
    game,
    collections: [{ id: 1, name: 'RPG' }, { id: 2, name: 'Done' }],
    collectionIdsByRecord: new Map([[7, [2]]]),
  })

  const unhandled = [...collect(items)].filter((action) => !handled.has(action))
  expect(unhandled).toEqual([])
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

// "Remove from Collection" (Manage > Remove from Collection > <collection>) was
// invisible. Not z-index: a submenu panel needs overflow-y:auto so a long
// collection list can scroll, and any overflow other than `visible` makes that
// panel a clipping box — so the third-level panel was drawn outside its
// scrolling parent and clipped away entirely. No z-index could fix that, because
// the pixels were never painted. Panels are portaled to the body instead, which
// takes them out of every ancestor's clip box.
test('submenu panels are portaled out of their scrolling parent', () => {
  expect(menuSource).toContain('createPortal')
  expect(menuSource).toMatch(/document\.body/)
  // A portaled panel is positioned against the viewport, not its parent, so it
  // cannot use left:100% any more.
  expect(menuSource).not.toContain("left: '100%'")
})

// A portaled panel is not a DOM descendant of the root, so the outside-click
// handler has to know about it or pointerdown would close the menu before the
// click on a submenu item ever landed.
test('the outside-click check accounts for portaled panels', () => {
  expect(menuSource).toContain('panelsRef')
  const start = menuSource.indexOf('const onPointerDown')
  const body = menuSource.slice(start, start + 400)
  expect(body).toMatch(/panelsRef\.current/)
})

// Link icons come through as full Font Awesome classes ('fab fa-steam'), so a
// hardcoded `fas` prefix would silently break every brand glyph in Links.
test('icons keep an explicit Font Awesome family', () => {
  expect(menuSource).toContain('iconClassName')
  expect(menuSource).not.toMatch(/className=\{`fas \$\{item\.icon\}/)
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

// ── Links ───────────────────────────────────────────────────────

test('the Links submenu lists every resolvable link', () => {
  const items = buildGameContextMenu({
    game: localGame({
      siteUrl: 'https://f95zone.to/threads/game.12345/',
      steam_id: '620',
      external_ids: { patreon: 'somedev', discord: 'https://discord.gg/abc' },
    }),
  })
  const links = find(items, 'Links')
  expect(labels(links.submenu)).toEqual(['F95 Thread', 'Steam', 'Patreon', 'Discord'])
  // Every row must carry a resolved url, since the main process only has
  // openUrl and it reads data.url.
  for (const row of links.submenu) {
    expect(row.data.action).toBe('openUrl')
    expect(row.data.url).toMatch(/^https?:\/\//)
  }
})

// The whole point of #1: a title can be listed without being owned, so the link
// has to be the public store page and never an account-scoped library page.
test('Steam and GOG links point at the public store page', () => {
  const steam = find(buildGameContextMenu({ game: localGame({ steam_id: '620' }) }), 'Links')
  expect(find(steam.submenu, 'Steam').data.url).toBe('https://store.steampowered.com/app/620')

  const gog = find(buildGameContextMenu({
    game: localGame({ gog_id: '1207658930', gog_store_url: 'https://www.gog.com/game/the_witcher' }),
  }), 'Links')
  expect(find(gog.submenu, 'GOG').data.url).toBe('https://www.gog.com/game/the_witcher')

  for (const menu of [steam, gog]) {
    for (const row of menu.submenu) {
      expect(row.data.url).not.toMatch(/\/account\//)
      expect(row.data.url).not.toMatch(/steamcommunity|\/id\/|\/profiles\//)
    }
  }
})

// A mapped id and the same id in external_ids resolve to one URL, so the game
// must not get two Steam rows.
test('a mapped id and the same external id collapse to one link', () => {
  const items = buildGameContextMenu({
    game: localGame({ steam_id: '620', external_ids: { steam_appid: '620' } }),
  })
  expect(labels(find(items, 'Links').submenu)).toEqual(['Steam'])
})

test('there is no Links row when the game has no links', () => {
  expect(find(buildGameContextMenu({ game: localGame() }), 'Links')).toBeUndefined()
})

// Browse/catalog rows have no local record, but they do have external_ids — and
// the store link matters most for a title that isn't in the library yet.
test('catalog rows still get their links', () => {
  const items = buildGameContextMenu({
    game: {
      title: 'Catalog Game',
      isMetadataOnly: true,
      external_ids: { steam_appid: '440' },
      versions: [],
    },
  })
  expect(labels(items)).toEqual(['Links'])
  expect(find(items, 'Links').submenu[0].data.url).toBe('https://store.steampowered.com/app/440')
})

// The menu and the details page must not drift apart, which is the reason the
// builder was extracted instead of copied.
test('the menu and the details page share one link builder', () => {
  const menu = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'components', 'library', 'gameContextMenu.js'), 'utf8')
  const page = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'components', 'detail', 'GameDetailPage.jsx'), 'utf8')
  expect(menu).toMatch(/from '\.\.\/detail\/gameLinks\.js'/)
  expect(page).toMatch(/from '\.\/gameLinks\.js'/)
  expect(page).not.toContain('buildDetailExternalLinks')
})

// ── Version ordering ────────────────────────────────────────────────────────

const versionMenu = (versions, over = {}) =>
  buildGameContextMenu({ game: localGame({ versions, ...over }) })

test('versions are listed newest first', () => {
  const items = versionMenu([
    { version: 'v0.9.11', version_id: 1, exec_path: '/a' },
    { version: 'v1.2', version_id: 2, exec_path: '/b' },
    { version: 'v0.2', version_id: 3, exec_path: '/c' },
  ])
  expect(find(items, 'Play').submenu.map((v) => v.label)).toEqual(['v1.2', 'v0.9.11', 'v0.2'])
})

// 0.10 is newer than 0.9.11 numerically but earlier lexically, so a plain string
// sort gets this backwards.
test('version segments compare numerically, not lexically', () => {
  const items = versionMenu([
    { version: 'v0.9.11', version_id: 1, exec_path: '/a' },
    { version: 'v0.10.0', version_id: 2, exec_path: '/b' },
  ])
  expect(find(items, 'Play').submenu.map((v) => v.label)).toEqual(['v0.10.0', 'v0.9.11'])
})

test('the Open Game Folder submenu uses the same order', () => {
  const items = versionMenu([
    { version: 'v1.0', version_id: 1, exec_path: '/a/g.exe', game_path: '/a' },
    { version: 'v3.0', version_id: 2, exec_path: '/b/g.exe', game_path: '/b' },
    { version: 'v2.0', version_id: 3, exec_path: '/c/g.exe', game_path: '/c' },
  ])
  const folder = find(find(items, 'Manage').submenu, 'Open Game Folder')
  expect(folder.submenu.map((v) => v.label)).toEqual(['v3.0', 'v2.0', 'v1.0'])
})

// Without an explicit selection the default is now the newest version rather
// than whichever came first out of the database.
test('Play defaults to the newest version when none is selected', () => {
  const items = versionMenu([
    { version: 'v1.0', version_id: 1, exec_path: '/a' },
    { version: 'v4.5', version_id: 2, exec_path: '/b' },
  ])
  expect(find(items, 'Play').data.version).toBe('v4.5')
})

test('an explicitly selected version still wins over the newest', () => {
  const items = versionMenu(
    [
      { version: 'v1.0', version_id: 1, exec_path: '/a' },
      { version: 'v4.5', version_id: 2, exec_path: '/b' },
    ],
    { selected_version_id: 1 },
  )
  const play = find(items, 'Play')
  expect(play.data.version).toBe('v1.0')
  // ...but the list is still newest-first.
  expect(play.submenu.map((v) => v.label)).toEqual(['v4.5', 'v1.0'])
})

// Sharing one comparator with the detail page matters: a menu ordered
// differently from the page it opens is worse than either order alone.
test('the menu reuses the detail page comparator', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'components', 'library', 'gameContextMenu.js'),
    'utf8',
  )
  expect(src).toContain('sortVersionsDesc')
  expect(src).toContain('gameDetailUtils.js')
})
