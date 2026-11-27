import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appFile = resolve(dirname(fileURLToPath(import.meta.url)), '../src/App.jsx')
const readApp = () => readFileSync(appFile, 'utf8')

const has = (src, needle) => expect(src.includes(needle), needle).toBe(true)
const lacks = (src, needle) => expect(src.includes(needle), needle).toBe(false)

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

describe('sidebar visibility across views', () => {
  it('derives view-scoped visibility beside the view state', () => {
    const src = readApp()
    const viewState = "const [libraryView, setLibraryView] = useState('grid')"
    const start = src.indexOf(viewState)
    expect(start).toBeGreaterThan(-1)
    const nearby = src.slice(start, start + 600)
    for (const name of [
      'showGameListInView', 'showLibrarySidebarInView', 'showSearchSidebarInView',
    ]) {
      has(nearby, `const ${name} =`)
    }
    for (const [name, base] of [
      ['showGameListInView', 'showGameList'],
      ['showLibrarySidebarInView', 'showLibrarySidebar'],
    ]) {
      has(src, `const ${name} = ${base} && libraryView !== 'downloads'`)
    }
  })

  it('masks both side panels and the grid offset on Downloads', () => {
    const src = readApp()
    has(src, '{showGameListInView && (')
    has(src, "{showSearchSidebarInView && !selectedGame && filterSidebarMode === 'inline' && filterSidebarSide === 'left'")
    has(src, "{showSearchSidebarInView && !selectedGame && filterSidebarMode === 'inline' && filterSidebarSide === 'right'")
    has(src, "{showSearchSidebarInView && !selectedGame && filterSidebarMode !== 'inline'")
    has(src, 'showLibrarySidebarInView && !(showSearchSidebarInView')

    // The nav buttons reflect saved visibility, which Downloads does not change.
    for (const site of src.match(/<TopNav\b[\s\S]*?\/>/g) || []) {
      has(site, 'showGameList={showGameList}')
    }
    lacks(src, '{showGameList && (')
    lacks(src, '{showSearchSidebar && !selectedGame')
    has(src, "libraryView === 'downloads' ? (")
    has(src, '<DownloadsPage')
  })

  it('stops clearing filter visibility on navigation and selection', () => {
    const src = readApp()
    for (const handler of [
      'const selectGame = useCallback(',
      'const browseCatalog = useCallback(',
      'const openWishlist = useCallback(',
      'const applySavedFilter = useCallback(',
    ]) {
      lacks(bodyOf(src, handler), 'setShowSearchSidebar(false)')
    }
    // No other handler may pick up the same reset.
    expect(src).not.toContain('setShowSearchSidebar(false)')
  })

  it('keeps the toggle and the rest of each handler', () => {
    const src = readApp()
    has(src, 'setAndPersistFilterSidebar(!showSearchSidebar)')
    has(bodyOf(src, 'const selectGame = useCallback('), 'setSelectedGame(selected)')
    has(bodyOf(src, 'const browseCatalog = useCallback('), "recordNavigation('browse'")
    has(bodyOf(src, 'const openWishlist = useCallback('), "recordNavigation('wishlist'")
    has(bodyOf(src, 'const applySavedFilter = useCallback('), 'handleFilterChange(nextFilters)')
  })

  it('leaves the game list mode alone when switching views', () => {
    const src = readApp()
    for (const declaration of [
      'const goHome = useCallback(',
      'const browseCatalog = useCallback(',
      'const openWishlist = useCallback(',
      'const handleMetadataSearch = useCallback(',
    ]) {
      const body = bodyOf(src, declaration)
      expect(body.length, declaration).toBeGreaterThan(0)
      lacks(body, 'setAndPersistSidePanelMode(')
      lacks(body, 'setSidebarMode(')
    }
  })

  it('restores a saved closed game list before the startup mode coercion', () => {
    const src = readApp()
    const start = src.indexOf('const browseOk = BROWSE_MODE_ENABLED && enabled')
    const block = src.slice(start, src.indexOf('setSidebarMode(nextMode)', start))
    has(block, 'config.Interface?.showGameList === false')
    has(block, 'SIDE_PANEL_MODES.HIDDEN')
    expect(block.indexOf('showGameList === false')).toBeLessThan(block.indexOf('SIDE_PANEL_MODES.CATALOG'))
  })

  it('persists filter visibility under its own config key', () => {
    const src = readApp()
    has(src, 'showGameList:')
    for (const forbidden of [
      'showSearchSidebar:', 'showLibrarySidebar:', 'showSearchSidebarInView:', 'sidebarVisibility:',
    ]) {
      lacks(src, forbidden)
    }
  })
})
