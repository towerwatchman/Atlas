import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appFile = resolve(dirname(fileURLToPath(import.meta.url)), '../src/App.jsx')
const readApp = () => readFileSync(appFile, 'utf8')

// Boolean assertions keep a failure readable: toContain on the whole App would
// print the entire file into the test log.
const has = (src, needle) => expect(src.includes(needle), needle).toBe(true)
const lacks = (src, needle) => expect(src.includes(needle), needle).toBe(false)
const matches = (src, pattern) => expect(pattern.test(src), String(pattern)).toBe(true)

// Pull one declaration's body out so an assertion cannot accidentally match a
// different handler that happens to call the same helper.
const bodyOf = (src, declaration) => {
  const start = src.indexOf(declaration)
  if (start < 0) return ''
  const open = src.indexOf('{', start)
  let depth = 0
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1)
  }
  return ''
}

describe('view history wired into App', () => {
  it('keeps a session history with a boot snapshot and config guard refs', () => {
    const src = readApp()
    has(src, "from './lib/navigationHistory.js'")
    for (const name of ['createHistory', 'currentSnapshot', 'loadHistory', 'pushSnapshot', 'saveHistory', 'goBack', 'goForward']) {
      has(src, name)
    }
    has(src, 'useState(() => loadHistory() ?? createHistory())')
    has(src, 'hadSavedHistoryRef')
    has(src, 'bootSnapshotRef')
    has(src, 'configReadyRef')
    has(src, 'saveHistory(viewHistory)')
  })

  it('records explicit page visits with their filter identity', () => {
    const src = readApp()
    const visits = [
      ['const goHome = useCallback(', "recordNavigation('library', null, { savedFilterId: '', collectionId: null })"],
      ['const browseCatalog = useCallback(', "recordNavigation('browse', null, { savedFilterId: '', collectionId: null })"],
      ['const openWishlist = useCallback(', "recordNavigation('wishlist', null, { savedFilterId: '', collectionId: null })"],
      ['const openFavorites = useCallback(', "recordNavigation('favorites', null, { savedFilterId: 'builtin-favorites', collectionId: null })"],
      ['const openCollections = useCallback(', "recordNavigation('collections', null, { savedFilterId: '', collectionId: null })"],
      ['const openCollection = useCallback(', "recordNavigation('collections', null, { savedFilterId: '', collectionId: String(collection.id) })"],
      ['const openDownloads = useCallback(', "recordNavigation('downloads', null, { savedFilterId: '', collectionId: null })"],
      ['const selectGame = useCallback(', "recordNavigation('detail', selected)"],
    ]
    for (const [declaration, call] of visits) {
      has(bodyOf(src, declaration), call)
    }
    lacks(bodyOf(src, 'const handleGoBack = useCallback('), 'recordNavigation')
    lacks(bodyOf(src, 'const handleGoForward = useCallback('), 'recordNavigation')
  })

  it('falls back to the active filter identity when a visit passes none', () => {
    const src = readApp()
    const body = src.slice(
      src.indexOf('const recordNavigation = useCallback('),
      src.indexOf('const applySnapshot = useCallback('),
    )
    has(body, 'savedFilterId: identity.savedFilterId ?? activeSavedFilterId')
    has(body, 'collectionId: identity.collectionId ?? activeFilters.collectionIds?.[0] ?? null')
  })

  it('restores page and filter identity, leaving scroll state alone', () => {
    const body = bodyOf(readApp(), 'const applySnapshot = useCallback(')
    has(body, 'setSelectedGame(snapshot.game')
    has(body, 'setSelectedGame(null)')
    has(body, "setLibraryMode('catalog')")
    has(body, "setLibraryView('collections')")
    has(body, "setLibraryView('downloads')")
    has(body, "setActiveSavedFilterId('builtin-favorites')")
    has(body, 'favoritesOnly: true')
    has(body, "setActiveSavedFilterId(snapshot.savedFilterId || '')")
    has(body, 'snapshot.collectionId')
    has(body, 'handleFilterChange(')
    for (const forbidden of ['setActiveFilters(', 'ScrollTop', 'setShowSearchSidebar']) {
      lacks(body, forbidden)
    }
  })

  it('does not reset to local on boot when a saved history exists', () => {
    const src = readApp()
    matches(src, /setSidebarMode\(nextMode\)[\s\S]{0,300}if \(!hadSavedHistoryRef\.current\) setLibraryMode\('local'\)/)
    has(src, 'if (!configReadyRef.current && bootSnapshotRef.current)')
    has(src, 'configReadyRef.current = true')
    has(src, 'applySnapshot(bootSnapshotRef.current)')
  })

  it('renders no Back or Forward control in the header', () => {
    const src = readApp()
    for (const forbidden of [
      'aria-label="Back"',
      'aria-label="Forward"',
      'renderNavArrows',
      'fa-chevron-left',
      'fa-chevron-right',
      'canGoBack',
      'canGoForward',
    ]) {
      lacks(src, forbidden)
    }
  })

  it('moves the history index and applies the returned snapshot', () => {
    const src = readApp()
    const back = bodyOf(src, 'const handleGoBack = useCallback(')
    const forward = bodyOf(src, 'const handleGoForward = useCallback(')
    has(back, 'goBack(viewHistory)')
    has(forward, 'goForward(viewHistory)')
    has(back, 'setViewHistory(result.history)')
    has(forward, 'setViewHistory(result.history)')
    has(back, 'applySnapshot(result.snapshot)')
    has(forward, 'applySnapshot(result.snapshot)')
  })

  it('does not enter or record Browse when browsing is unavailable', () => {
    const src = readApp()
    const apply = bodyOf(src, 'const applySnapshot = useCallback(')
    matches(apply, /snapshot\.view === 'browse' && !browseAvailableRef\.current/)
    const guarded = bodyOf(apply, "if (snapshot.view === 'browse' && !browseAvailableRef.current)")
    has(guarded, "setLibraryMode('local')")
    has(guarded, "setLibraryView('grid')")

    const browse = bodyOf(src, 'const browseCatalog = useCallback(')
    const gate = browse.indexOf('if (!browseAvailable)')
    const record = browse.indexOf("recordNavigation('browse',")
    expect(gate).toBeGreaterThan(-1)
    expect(record, 'browse visit is recorded before the availability gate').toBeGreaterThan(gate)
  })
})
