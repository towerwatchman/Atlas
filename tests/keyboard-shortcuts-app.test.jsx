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

const caseBody = (switchBody, id) => {
  const start = switchBody.indexOf(`case '${id}':`)
  if (start < 0) return ''
  const next = switchBody.indexOf('case ', start + 1)
  return switchBody.slice(start, next < 0 ? switchBody.length : next)
}

describe('global shortcut handler wired into App', () => {
  it('imports the helper and seeds bindings and the lookup index', () => {
    const src = readApp()
    has(src, "from './lib/keyboardShortcuts.js'")
    for (const name of ['comboFromEvent', 'readBindings', 'buildShortcutIndex']) has(src, name)
    has(src, 'const [shortcutBindings, setShortcutBindings] = useState(() => readBindings({}))')
    has(src, 'const shortcutIndex = useMemo(() => buildShortcutIndex(shortcutBindings), [shortcutBindings])')
  })

  it('reloads bindings from config and from the shortcuts-changed broadcast', () => {
    const src = readApp()
    has(src, 'setShortcutBindings(readBindings(config))')
    has(src, 'window.electronAPI?.onShortcutsChanged?.(')
    has(src, 'setShortcutBindings(readBindings(bindings))')
    has(src, 'return () => unsubscribeShortcuts?.()')
  })

  it('dispatches exactly the eighteen agreed actions', () => {
    const body = bodyOf(readApp(), 'const runShortcut = useCallback(')
    const expectedIds = [
      'openViewLibrary', 'openViewBrowse', 'openViewFavorites', 'openViewWishlist',
      'openViewCollections', 'openViewDownloads', 'navigateBack', 'navigateForward',
      'focusSearch', 'toggleFilterSidebar', 'toggleGameList', 'wishlistCurrentGame',
      'blacklistCurrentGame', 'installCurrentGame', 'openImporter',
      'importManually', 'quit', 'openSettings',
    ]
    const caseIds = [...body.matchAll(/case '([^']+)':/g)].map((match) => match[1])
    expect(caseIds).toEqual(expectedIds)

    for (const call of [
      'goHome()', 'browseCatalog()', 'openFavorites()', 'openWishlist()', 'openCollections()',
      'openDownloads()', 'handleGoBack()', 'handleGoForward()',
      'setSearchFocusSignal((value) => value + 1)',
      'toggleSearchSidebar()', 'toggleGameList()',
      'window.electronAPI.openImporter?.(\'atlas\')', 'window.electronAPI.openSettings?.()',
    ]) {
      has(body, call)
    }
  })

  it('keeps focus search and the filter sidebar as separate actions', () => {
    const body = bodyOf(readApp(), 'const runShortcut = useCallback(')
    const focus = caseBody(body, 'focusSearch')
    const filter = caseBody(body, 'toggleFilterSidebar')
    has(focus, 'setSearchFocusSignal((value) => value + 1)')
    lacks(focus, 'setShowSearchSidebar(true)')
    has(filter, 'toggleSearchSidebar()')
  })

  it('dispatches restored game actions against the selected game only', () => {
    const src = readApp()
    has(src, "from './utils/wishlistPayload.js'")
    for (const name of ['buildWishlistPayload', 'canToggleWishlist', 'isGameInstalled']) has(src, name)

    const body = bodyOf(src, 'const runShortcut = useCallback(')

    const wishlist = caseBody(body, 'wishlistCurrentGame')
    has(wishlist, 'if (!selectedGame || !canToggleWishlist(selectedGame)) break')
    has(wishlist, "runGameContextAction({ ...buildWishlistPayload(selectedGame), action: 'toggleWishlist' })")

    const blacklist = caseBody(body, 'blacklistCurrentGame')
    has(blacklist, 'if (!selectedGame || isGameInstalled(selectedGame)) break')
    has(blacklist, '...buildWishlistPayload(selectedGame)')
    has(blacklist, '...(selectedGame.gog_id !== undefined ? { gog_id: selectedGame.gog_id } : {})')
    has(blacklist, "action: 'blacklistGame'")

    const install = caseBody(body, 'installCurrentGame')
    has(install, 'if (!selectedGame || isGameInstalled(selectedGame)) break')
    has(install, 'openUpdateModal(selectedGame)')
    lacks(install, 'runGameContextAction')

    has(caseBody(body, 'openImporter'), "window.electronAPI.openImporter?.('atlas')")
    has(caseBody(body, 'importManually'), "window.electronAPI.openImporter?.('manual')")
    has(caseBody(body, 'quit'), 'window.electronAPI.quitApp?.()')
  })

  it('exposes one global quit IPC that closes every window', () => {
    const root = resolve(dirname(appFile), '..')
    const preload = readFileSync(resolve(root, 'electron/preload.js'), 'utf8')
    const windows = readFileSync(resolve(root, 'electron/ipc/windows.js'), 'utf8')
    has(preload, 'quitApp: () => ipcRenderer.invoke("quit-app")')
    has(windows, "ipcMain.handle('quit-app'")
    const handler = bodyOf(windows, "ipcMain.handle('quit-app'")
    has(handler, 'ctx.quitFromMainWindow()')
  })

  it('guards repeats, typing targets and unbound combos before dispatching', () => {
    const body = bodyOf(readApp(), 'const handleShortcutKeyDown = (event) =>')
    has(body, 'if (event.repeat) return')
    has(body, 'isTextInputTarget(event.target)')
    has(body, 'comboFromEvent(event)')
    has(body, 'if (!combo) return')
    has(body, 'shortcutIndex[combo]')
    has(body, 'if (!actionId) return')
    has(body, 'event.preventDefault()')
    has(body, 'runShortcut(actionId)')
  })

  it('registers its own keydown listener and removes it on unmount', () => {
    const src = readApp()
    has(src, "window.addEventListener('keydown', handleShortcutKeyDown)")
    has(src, "window.removeEventListener('keydown', handleShortcutKeyDown)")
    matches(src, /\[shortcutIndex, runShortcut\]/)
  })

  it('dispatches mouse 3/4 combos through its own mousedown listener', () => {
    const src = readApp()
    has(src, 'comboFromMouseEvent')

    const body = bodyOf(src, 'const handleShortcutMouseDown = (event) =>')
    has(body, 'comboFromMouseEvent(event)')
    has(body, 'if (!combo) return')
    has(body, 'shortcutIndex[combo]')
    has(body, 'if (!actionId) return')
    has(body, 'event.preventDefault()')
    has(body, 'runShortcut(actionId)')

    has(src, "window.addEventListener('mousedown', handleShortcutMouseDown, true)")
    has(src, "window.removeEventListener('mousedown', handleShortcutMouseDown, true)")
  })

  it('routes settings-page ids to openSettings only for visible tabs', () => {
    const src = readApp()
    has(src, "from './components/settings/settingsIcons.js'")
    has(src, 'settingsPageActionId')
    has(src, 'visibleSettingsPages = new Set(settingsIcons.filter((item) => !item.hidden)')

    const body = bodyOf(src, 'const runShortcut = useCallback(')
    has(body, 'actionId.startsWith(SETTINGS_PAGE_PREFIX)')
    has(body, 'const tab = actionId.slice(SETTINGS_PAGE_PREFIX.length)')
    has(body, 'visibleSettingsPages.has(tab)')
    has(body, 'window.electronAPI.openSettings?.({ tab })')
    expect(body.indexOf('visibleSettingsPages.has(tab)'))
      .toBeLessThan(body.indexOf('window.electronAPI.openSettings?.({ tab })'))
  })

  it('has no forbidden action ids, lifecycle combos or extra behaviors', () => {
    const src = readApp()
    const body = bodyOf(src, 'const runShortcut = useCallback(')
    for (const id of [
      'openView', 'openSubCategory', 'openSettingsPage', 'openQuickCustomizations',
      'togglePrivacy', 'cyclePrivacyBlur', 'restart', 'reload', 'currentShortcutGame',
    ]) {
      lacks(body, `case '${id}':`)
    }
    for (const forbidden of [
      'expandedCollection', 'restoreLibraryScroll', 'hoveredGameAtPointer',
      'data-flip-id', 'currentShortcutGame', 'hover', 'Hover',
    ]) {
      lacks(body, forbidden)
    }
    for (const combo of ["'Ctrl+R'", "'Ctrl+Shift+T'", "'Alt+F4'"]) lacks(src, combo)
  })
})
