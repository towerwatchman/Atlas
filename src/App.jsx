import { Component, useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { AutoSizer, Grid } from 'react-virtualized'
import Sidebar from './components/ui/Sidebar.jsx'
import TopNav from './components/ui/TopNav.jsx'
import WindowBorderFrame from './components/ui/WindowBorderFrame.jsx'
import ImporterSourceMenu from './components/importer/ImporterSourceMenu.jsx'
import { atlasLogo } from './assets/icons/data.js'
import GameBanner from './components/library/GameBanner.jsx'
import SearchBox from './components/search/SearchBox.jsx'
import SearchSidebar from './components/search/SearchSidebar.jsx'
import SavedFiltersPanel from './components/search/SavedFiltersPanel.jsx'
import GameDetailPage from './components/detail/GameDetailPage.jsx'
import { useGames } from './hooks/useGames.js'
import { builtInSavedFilters, defaultFilters, filterGamesWithState, normalizeFilterState, useFilters } from './hooks/useFilters.js'
import { useAppUpdate } from './hooks/useAppUpdate.js'
import { useWindowState } from './hooks/useWindowState.js'
import { useTheme } from './theme/ThemeProvider.jsx'
import { useBannerTemplate } from './theme/BannerTemplateProvider.jsx'
import { getGameTitle, normalizeGameForRenderer } from './utils/gameDisplay.js'
import { getWishlistIdentityKey, withWishlistStates } from './utils/wishlistIdentity.js'
import { formatPercent, formatProgressNumber, sanitizePercentText } from './utils/formatPercent.js'
import { BROWSE_MODE_ENABLED } from './features.js'

const debounce = (func, delay) => {
  let timeout
  return (...args) => {
    clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), delay)
  }
}

const SIDE_PANEL_MODES = {
  HIDDEN: 'hidden',
  GAMES: 'games',
  SAVED_FILTERS: 'savedFilters',
  CATALOG: 'catalog',
  WISHLIST: 'wishlist',
}

const getLocalRecordIdForCatalogRow = (game = {}) => {
  for (const value of [game.localRecordId, game.installedRecordId, game.local_record_id]) {
    const id = Number.parseInt(value, 10)
    if (Number.isInteger(id) && id > 0) return id
  }
  return null
}

const knownSidePanelModes = new Set(Object.values(SIDE_PANEL_MODES))

const normalizeSidePanelMode = (value, legacyShowGameList = true, browseAvailable = BROWSE_MODE_ENABLED) => {
  if (!browseAvailable && value === SIDE_PANEL_MODES.CATALOG) {
    return SIDE_PANEL_MODES.GAMES
  }
  if (knownSidePanelModes.has(value)) return value
  return legacyShowGameList === false ? SIDE_PANEL_MODES.HIDDEN : SIDE_PANEL_MODES.GAMES
}

const sanitizeProgressState = (progress = {}) => ({
  ...progress,
  text: sanitizePercentText(progress.text),
})

const sanitizeFooterToastText = (value, source) => {
  const raw = String(value || '')
  const formatted = sanitizePercentText(raw)
  if (formatted !== raw) {
    try {
      if (globalThis.localStorage?.getItem('atlasDebugFooterToastPercent') === 'true') {
        console.debug('footer-toast percent formatted', {
          source,
          raw,
          formatted,
        })
      }
    } catch {
      // Debug logging is best-effort only.
    }
  }
  return formatted
}

export class AppErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Atlas renderer error:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="h-screen bg-tertiary text-text flex items-center justify-center p-6 rounded-windowTheme overflow-hidden transform-gpu [clip-path:inset(0_round_var(--radius-window-active))]">
          <WindowBorderFrame />
          <div className="bg-secondary border border-border rounded p-4 max-w-xl">
            <h1 className="text-lg font-bold mb-2">Atlas hit a display error</h1>
            <p className="text-sm opacity-80 mb-3">
              This view could not render, but the app stayed open. Restart Atlas if the view does not recover.
            </p>
            <pre className="text-xs whitespace-pre-wrap break-words bg-primary p-3 rounded">
              {this.state.error?.message || String(this.state.error)}
            </pre>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

const App = () => {
  const [selectedGame, setSelectedGame] = useState(null)
  const [sidebarMode, setSidebarMode] = useState(SIDE_PANEL_MODES.GAMES)
  const [libraryMode, setLibraryMode] = useState('local')
  const [showSearchSidebar, setShowSearchSidebar] = useState(false)
  const [userSavedFilters, setUserSavedFilters] = useState([])
  const [wishlistIdentityKeys, setWishlistIdentityKeys] = useState(new Set())
  const [activeSavedFilterId, setActiveSavedFilterId] = useState('')
  const [savedFilterDeleteStateById, setSavedFilterDeleteStateById] = useState({})
  // Banner card dimensions for Grid sizing — derived from the same
  // resolved template BannerTemplateProvider already computed once for
  // <GameBanner> (see src/theme/BannerTemplateProvider.jsx), rather than
  // App.jsx independently re-fetching/resolving its own copy via IPC.
  // Legacy (pre-layout-schema) templates don't carry width/height, so they
  // fall back to the classic default — same behavior as before this was
  // centralized.
  const selectedBannerTemplate = useBannerTemplate()
  const bannerSize = useMemo(() => {
    const layout = selectedBannerTemplate?.type === 'layout' ? selectedBannerTemplate.value : null
    return {
      bannerWidth: layout?.width || 537,
      bannerHeight: layout?.height || 251,
    }
  }, [selectedBannerTemplate])
  const [importStatus, setImportStatus] = useState({ text: '', progress: 0, total: 0 })
  const [importProgress, setImportProgress] = useState({ text: '', progress: 0, total: 0 })
  const [dbUpdateStatus, setDbUpdateStatus] = useState({ text: '', progress: 0, total: 0 })
  // NSFW / adult-content ("Browse mode") opt-in — see electron/ipc/settings.js
  // get-nsfw-status / set-nsfw-enabled. nsfwPromptOpen drives the first-run
  // confirmation modal below; it only opens once getNsfwStatus() reports the
  // user has never been asked (i.e. the config.ini has no [NSFW] enabled
  // line yet), not just whenever it's currently false.
  const [nsfwEnabled, setNsfwEnabled] = useState(false)
  const [nsfwPromptOpen, setNsfwPromptOpen] = useState(false)

  const gridRef = useRef(null)
  const gameGridRef = useRef(null)
  const libraryScrollTopRef = useRef(0)
  // Tracks the {search, filters} combination of the last catalog fetch
  // actually dispatched (by either browseCatalog's immediate first-load
  // path or the debounced reset effect below) so re-entering Browse mode
  // without anything having changed doesn't wipe and reload data that's
  // already correct.
  const lastFetchedCatalogParamsKeyRef = useRef(null)
  const pendingLibraryScrollTopRestoreRef = useRef(null)
  const dbUpdateRunningRef = useRef(false)
  const showGameList = sidebarMode === SIDE_PANEL_MODES.GAMES
  const showSavedFilters = sidebarMode === SIDE_PANEL_MODES.SAVED_FILTERS
  const showLibrarySidebar = showGameList || showSavedFilters
  // Browse mode (the adult-content catalog) requires BOTH the build-time
  // BROWSE_MODE_ENABLED flag (electron/features.js — currently off pending
  // legal review) AND the user's own per-install NSFW opt-in. Either one
  // being off hides/disables Browse mode entirely.
  const browseAvailable = BROWSE_MODE_ENABLED && nsfwEnabled
  // Mirrors browseAvailable into a ref so the mount-only IPC-listener effect
  // below (deps: []) can read the latest value without becoming stale —
  // that effect's handlers are created once and never recreated, but
  // nsfwEnabled (and therefore browseAvailable) can change at runtime via
  // the Settings toggle.
  const browseAvailableRef = useRef(browseAvailable)
  useEffect(() => { browseAvailableRef.current = browseAvailable }, [browseAvailable])

  const setAndPersistSidePanelMode = useCallback((requestedMode) => {
    const nextMode = normalizeSidePanelMode(requestedMode, undefined, browseAvailable)
    setSidebarMode(nextMode)
    window.electronAPI
      .getConfig()
      .then((config) => {
        window.electronAPI.saveSettings({
          ...config,
          Interface: {
            ...config.Interface,
            sidePanelMode: nextMode,
            showGameList:
              nextMode !== SIDE_PANEL_MODES.HIDDEN &&
              nextMode !== SIDE_PANEL_MODES.CATALOG &&
              nextMode !== SIDE_PANEL_MODES.WISHLIST,
          },
        })
      })
      .catch((err) => console.error('Failed to save side panel mode:', err))
  }, [browseAvailable])

  // ── Hooks ──────────────────────────────────────────────────────────────────
  const {
    games, catalogGames, wishlistGames, totalVersions, fetchGames, fetchCatalogGames,
    requestCatalogRange, catalogLoading, catalogLoadingMore,
    catalogTotal, catalogLoadError,
    fetchWishlistGames, replaceGameInState,
    removeGameFromState, refreshGame, includeUninstalledRef,
  } = useGames()

  const {
    activeFilters, handleFilterChange, handleResetFilters,
    filteredGames: localFilteredGames, installedGameCount, uninstalledGameCount,
  } = useFilters(games, includeUninstalledRef, fetchGames, setSelectedGame)
  const catalogWithWishlist = useMemo(
    () => withWishlistStates(catalogGames, wishlistIdentityKeys),
    [catalogGames, wishlistIdentityKeys],
  )
  const catalogLoadedCount = useMemo(
    () => catalogGames.reduce((count, game) => count + (game ? 1 : 0), 0),
    [catalogGames],
  )
  const wishlistWithState = useMemo(
    () => withWishlistStates(wishlistGames, wishlistIdentityKeys),
    [wishlistGames, wishlistIdentityKeys],
  )
  const catalogSearch = useMemo(
    () => ({
      text: activeFilters.text,
      type: activeFilters.type,
    }),
    [activeFilters.text, activeFilters.type],
  )
  const catalogQueryFilters = useMemo(
    () => activeFilters,
    [activeFilters],
  )
  const catalogSearchRef = useRef(catalogSearch)
  const catalogQueryFiltersRef = useRef(catalogQueryFilters)
  useEffect(() => {
    catalogSearchRef.current = catalogSearch
  }, [catalogSearch])
  useEffect(() => {
    catalogQueryFiltersRef.current = catalogQueryFilters
  }, [catalogQueryFilters])
  // Catalog/Browse rows come back from the server already filtered and
  // sorted (see electron/db/versions.js getCatalogGames) — catalogGames is
  // re-filtered here for nothing else, just annotated with wishlist state,
  // so its array indices stay aligned 1:1 with the server's absolute
  // result positions (which is what requestCatalogRange's windowed
  // loading relies on; re-filtering client-side would shift indices and
  // break that alignment, in addition to being redundant work).
  const wishlistFilteredGames = useMemo(
    () =>
      filterGamesWithState(wishlistWithState, {
        ...activeFilters,
        includeUninstalled: true,
        installState: 'all',
        updateAvailable: false,
        multipleInstalledVersions: false,
        browseDateRange: 'any',
      }),
    [wishlistWithState, activeFilters],
  )
  const filteredGames =
    libraryMode === 'catalog'
      ? catalogWithWishlist
      : libraryMode === 'wishlist'
        ? wishlistFilteredGames
        : localFilteredGames
  const viewTitle =
    libraryMode === 'catalog'
      ? 'Browse'
      : libraryMode === 'wishlist'
        ? 'Wishlist'
        : 'Games'

  const { isMaximized, version, handleWindowStateChanged, loadVersion } = useWindowState()
  const { theme, layout, accentBarEnabled, filterSidebarSide, filterSidebarMode } = useTheme()
  const isTopNav = layout === 'topnav'

  const {
    appUpdateNotice, setAppUpdateNotice, appUpdateActionBusy,
    handleUpdateStatus, handleAppUpdateAction,
  } = useAppUpdate(setDbUpdateStatus)
  const appUpdateNoticeText =
    sanitizeFooterToastText(
      appUpdateNotice.status === 'downloading' &&
      appUpdateNotice.percent !== undefined &&
      appUpdateNotice.percent !== null
        ? `Downloading Atlas update: ${formatPercent(appUpdateNotice.percent)}`
        : appUpdateNotice.text,
      'app-update-message',
    )
  const appUpdateActionLabel = sanitizeFooterToastText((() => {
    if (appUpdateNotice.status === 'installing') return 'Installing update...'
    if (appUpdateNotice.status === 'downloaded') return 'Install and restart'
    if (appUpdateNotice.status === 'downloading') return 'Downloading...'
    if (appUpdateNotice.status === 'checking') return 'Checking...'
    if (['error', 'package_not_ready', 'not-available'].includes(appUpdateNotice.status)) {
      return 'Check for updates'
    }
    return 'Download and install'
  })(), 'app-update-action')
  const isAppUpdateActionDisabled =
    (appUpdateActionBusy && appUpdateNotice.status !== 'downloaded') ||
    ['downloading', 'checking', 'installing'].includes(appUpdateNotice.status)

  // ── Scroll restore ─────────────────────────────────────────────────────────
  const restoreLibraryScrollIfNeeded = useCallback(() => {
    const targetScrollTop = pendingLibraryScrollTopRestoreRef.current
    if (targetScrollTop === null || targetScrollTop === undefined) return
    let attempts = 0
    const tryRestore = () => {
      const grid = gridRef.current
      if (grid?.scrollToPosition) {
        grid.recomputeGridSize?.()
        grid.scrollToPosition({ scrollTop: targetScrollTop })
        libraryScrollTopRef.current = targetScrollTop
        pendingLibraryScrollTopRestoreRef.current = null
        return
      }
      attempts += 1
      if (attempts < 10) requestAnimationFrame(tryRestore)
    }
    requestAnimationFrame(tryRestore)
  }, [])

  const goBackToLibrary = useCallback(() => {
    pendingLibraryScrollTopRestoreRef.current = libraryScrollTopRef.current || 0
    setSelectedGame(null)
  }, [])

  const goHome = useCallback(() => {
    setLibraryMode('local')
    if (sidebarMode === SIDE_PANEL_MODES.CATALOG || sidebarMode === SIDE_PANEL_MODES.WISHLIST) {
      setAndPersistSidePanelMode(SIDE_PANEL_MODES.HIDDEN)
    }
    goBackToLibrary()
  }, [goBackToLibrary, setAndPersistSidePanelMode, sidebarMode])

  const selectGame = useCallback((game) => {
    setShowSearchSidebar(false)
    const selected = withWishlistStates([game], wishlistIdentityKeys)[0] || game
    setSelectedGame(selected)
    const localRecordId = game?.isMetadataOnly ? getLocalRecordIdForCatalogRow(selected) : null
    const recordIdToLoad = localRecordId || game?.record_id
    if (!recordIdToLoad || (game.isMetadataOnly && !localRecordId)) {
      if (game?.isMetadataOnly && (game.is_installed || game.isInstalled) && !localRecordId) {
        console.warn('Installed metadata row is missing a local record id:', game)
      }
      return
    }
    window.electronAPI
      .getGame(recordIdToLoad)
      .then((updatedGame) => {
        const normalizedGame = normalizeGameForRenderer(updatedGame)
        if (normalizedGame) {
          setShowSearchSidebar(false)
          setSelectedGame(localRecordId
            ? {
                ...normalizedGame,
                isWishlisted: selected.isWishlisted === true || selected.isWishlistEntry === true,
                isWishlistEntry: selected.isWishlisted === true || selected.isWishlistEntry === true,
                atlas_id: normalizedGame.atlas_id ?? selected.atlas_id,
                f95_id: normalizedGame.f95_id ?? selected.f95_id,
                lc_id: normalizedGame.lc_id ?? selected.lc_id,
                steam_id: normalizedGame.steam_id ?? selected.steam_id,
              }
            : normalizedGame)
        }
      })
      .catch((error) =>
        console.error(`Failed to refresh selected game ${recordIdToLoad}:`, error)
      )
  }, [wishlistIdentityKeys])

  const refreshDetailGame = useCallback((recordId) => {
    refreshGame(recordId)
    if (browseAvailable) fetchCatalogGames({ search: catalogSearch, filters: catalogQueryFilters })
    fetchWishlistGames()
    const id = Number.parseInt(recordId, 10)
    if (!Number.isInteger(id) || id <= 0) return
    window.electronAPI
      .getGame(id)
      .then((updatedGame) => {
        const normalizedGame = normalizeGameForRenderer(updatedGame)
        if (!normalizedGame) return
        setSelectedGame((current) => {
          if (Number.parseInt(current?.record_id, 10) !== id) return current
          return {
            ...normalizedGame,
            isWishlisted: current?.isWishlisted === true || current?.isWishlistEntry === true,
            isWishlistEntry: current?.isWishlisted === true || current?.isWishlistEntry === true,
          }
        })
      })
      .catch((error) =>
        console.error(`Failed to refresh detail game ${id}:`, error)
      )
  }, [browseAvailable, catalogQueryFilters, catalogSearch, fetchCatalogGames, fetchWishlistGames, refreshGame])

  // ── Grid sizing ────────────────────────────────────────────────────────────
  const getScrollbarWidth = () => {
    if (gameGridRef.current) {
      return gameGridRef.current.offsetWidth - gameGridRef.current.clientWidth
    }
    return 16
  }

  const getColumnCountForWidth = (width) => {
    const availableWidth = Math.max(0, Number(width) || 0)
    return Math.max(1, Math.floor(availableWidth / (bannerSize.bannerWidth + 16)))
  }

  const debounceResize = debounce(() => {
    if (gridRef.current) {
      gridRef.current.recomputeGridSize()
      gridRef.current.forceUpdate()
    }
  }, 16)

  // Re-measure the Grid whenever the resolved banner card size changes —
  // covers the initial resolution, picking a different template/layout in
  // Settings, and live theme-builder edits broadcast from another window
  // (all of which now flow through BannerTemplateProvider, see
  // src/theme/BannerTemplateProvider.jsx). Previously this recompute was
  // triggered manually at the end of loadBannerLayoutMetrics(); it's now
  // just a reaction to bannerSize itself.
  useEffect(() => {
    requestAnimationFrame(() => {
      gridRef.current?.recomputeGridSize?.()
      gridRef.current?.forceUpdate?.()
    })
  }, [bannerSize.bannerWidth, bannerSize.bannerHeight])

  const getCellRenderer = (currentColumnCount) => ({ columnIndex, rowIndex, style }) => {
    const index = rowIndex * currentColumnCount + columnIndex
    if (index >= filteredGames.length) return null
    const game = filteredGames[index]
    if (!game) {
      // Not-loaded-yet catalog slot — requestCatalogRange() (driven by the
      // Grid's onSectionRendered) will fetch the page covering this index
      // once it's actually scrolled into view; this is just a same-sized
      // placeholder so the grid doesn't jump around while that happens.
      return (
        <div
          key={`placeholder-${index}`}
          style={{
            ...style,
            display: 'flex',
            justifyContent: 'center',
            padding: '8px 4px',
            maxWidth: '100%',
          }}
        >
          <div
            className="animate-pulse rounded bg-secondary"
            style={{ width: bannerSize.bannerWidth, height: bannerSize.bannerHeight }}
          />
        </div>
      )
    }
    return (
      <div
        key={game.record_id}
        style={{
          ...style,
          display: 'flex',
          justifyContent: 'center',
          padding: '8px 4px',
          maxWidth: '100%',
        }}
      >
        <GameBanner game={game} onSelect={() => selectGame(game)} />
      </div>
    )
  }

  // ── Sidebar / list toggle ──────────────────────────────────────────────────
  const toggleGameList = () => {
    const nextMode =
      sidebarMode === SIDE_PANEL_MODES.GAMES
        ? SIDE_PANEL_MODES.SAVED_FILTERS
        : sidebarMode === SIDE_PANEL_MODES.SAVED_FILTERS
          ? SIDE_PANEL_MODES.HIDDEN
          : SIDE_PANEL_MODES.GAMES
    setAndPersistSidePanelMode(nextMode)
  }

  // Records the user's answer to the first-run NSFW/adult-content prompt.
  // Persists immediately via set-nsfw-enabled (which also marks the config
  // as "configured" so the prompt never reappears), and updates this
  // window's own state right away rather than waiting on the nsfw-changed
  // broadcast round-trip.
  const handleNsfwChoice = useCallback((enabled) => {
    setNsfwPromptOpen(false)
    setNsfwEnabled(enabled)
    window.electronAPI.setNsfwEnabled?.(enabled)
      .catch((err) => console.error('Failed to save NSFW setting:', err))
  }, [])

  const browseCatalog = useCallback(() => {
    if (!browseAvailable) {
      setLibraryMode('local')
      setSelectedGame(null)
      setAndPersistSidePanelMode(SIDE_PANEL_MODES.GAMES)
      return
    }
    const enteringFreshly = libraryMode !== 'catalog'
    setLibraryMode('catalog')
    setSelectedGame(null)
    setAndPersistSidePanelMode(SIDE_PANEL_MODES.CATALOG)
    setShowSearchSidebar(false)

    if (enteringFreshly) {
      // Browse should always open with no filters active — the full
      // catalog — rather than inheriting whatever filters were active in
      // the Library view (most commonly the local library's
      // installed-only default, or a saved filter someone left applied).
      // This also clears any saved-filter selection so Browse never opens
      // pre-narrowed to "your library" by accident.
      setActiveSavedFilterId('')
      const browseFilters = normalizeFilterState({
        ...defaultFilters,
        includeUninstalled: true,
        installState: 'all',
      })
      const browseSearch = { text: browseFilters.text, type: browseFilters.type }
      // Update the real activeFilters state (so catalogQueryFilters/
      // catalogSearch recompute to match) while also fetching immediately
      // with the same values here, and pre-marking the params key as
      // already-fetched — otherwise the debounced reset effect would see
      // its own state update land a moment later and immediately re-fetch
      // with the (momentarily stale) un-reset filters, undoing this and
      // re-triggering a flash/reload.
      handleFilterChange(browseFilters)
      lastFetchedCatalogParamsKeyRef.current = JSON.stringify({ search: browseSearch, filters: browseFilters })
      fetchCatalogGames({ reset: true, search: browseSearch, filters: browseFilters })
    } else if (catalogTotal === null) {
      lastFetchedCatalogParamsKeyRef.current = JSON.stringify({ search: catalogSearch, filters: catalogQueryFilters })
      fetchCatalogGames({ reset: true, search: catalogSearch, filters: catalogQueryFilters })
    }
  }, [
    browseAvailable,
    catalogQueryFilters,
    catalogSearch,
    catalogTotal,
    fetchCatalogGames,
    handleFilterChange,
    libraryMode,
    setAndPersistSidePanelMode,
  ])

  const loadWishlistIdentities = useCallback(() => {
    return window.electronAPI
      .getWishlistEntryIdentities?.()
      .then((ids) => {
        const next = new Set((Array.isArray(ids) ? ids : []).filter(Boolean).map(String))
        setWishlistIdentityKeys(next)
        return next
      })
      .catch((err) => {
        console.error('Failed to load wishlist identities:', err)
        return new Set()
      })
  }, [])

  const openWishlist = useCallback(() => {
    setLibraryMode('wishlist')
    setSelectedGame(null)
    setAndPersistSidePanelMode(SIDE_PANEL_MODES.WISHLIST)
    setShowSearchSidebar(false)
    Promise.all([fetchWishlistGames(), loadWishlistIdentities()])
      .catch((err) => console.error('Failed to open wishlist:', err))
  }, [fetchWishlistGames, loadWishlistIdentities, setAndPersistSidePanelMode])

  const handleWishlistChanged = useCallback(async (result = {}, sourceGame = null) => {
    const identityKey = result.identityKey || getWishlistIdentityKey(sourceGame || result.entry || {})
    setWishlistIdentityKeys((prev) => {
      const next = new Set(prev)
      if (result.isWishlisted === false || result.removed) next.delete(identityKey)
      else if (identityKey) next.add(identityKey)
      return next
    })
    await fetchWishlistGames()
    if (libraryMode === 'wishlist' && result.isWishlisted === false) {
      setSelectedGame((current) => {
        if (!current) return current
        return getWishlistIdentityKey(current) === identityKey ? null : current
      })
    } else if (sourceGame) {
      setSelectedGame((current) => {
        if (!current || getWishlistIdentityKey(current) !== identityKey) return current
        return { ...current, isWishlisted: result.isWishlisted !== false }
      })
    }
  }, [fetchWishlistGames, libraryMode])

  const toggleSearchSidebar = useCallback(() => {
    if (selectedGame) return
    setShowSearchSidebar((prev) => !prev)
  }, [selectedGame])

  const handleSearchChange = useCallback((text) => {
    setActiveSavedFilterId('')
    handleFilterChange({ text })
  }, [handleFilterChange])

  const resetFilters = useCallback(() => {
    setActiveSavedFilterId('')
    pendingLibraryScrollTopRestoreRef.current = 0
    libraryScrollTopRef.current = 0
    if (libraryMode === 'catalog') {
      // "Reset" in Browse mode should mean the whole catalog, not the
      // local library's installed-only default — otherwise resetting
      // filters while browsing collapses the view back down to just your
      // installed titles instead of showing everything.
      handleFilterChange({ ...defaultFilters, includeUninstalled: true, installState: 'all' })
    } else {
      handleResetFilters()
    }
    gridRef.current?.recomputeGridSize?.()
    gridRef.current?.forceUpdate?.()
  }, [handleResetFilters, handleFilterChange, libraryMode])

  const loadSavedFilters = useCallback(() => {
    return window.electronAPI
      .getSavedFilters?.()
      .then((filters) => {
        const normalized = (Array.isArray(filters) ? filters : [])
          .filter((filter) => filter && filter.id && filter.name)
          .map((filter) => ({
            ...filter,
            builtIn: false,
            filters: normalizeFilterState(filter.filters),
          }))
          .sort((a, b) => String(a.name).localeCompare(String(b.name)))
        setUserSavedFilters(normalized)
      })
      .catch((err) => console.error('Failed to load saved filters:', err))
  }, [])

  const handleSavedFilterSaved = useCallback((filter) => {
    if (!filter?.id) return
    const normalized = {
      ...filter,
      builtIn: false,
      filters: normalizeFilterState(filter.filters),
    }
    setUserSavedFilters((prev) => {
      const withoutExisting = prev.filter((item) => item.id !== normalized.id)
      return [...withoutExisting, normalized].sort((a, b) =>
        String(a.name).localeCompare(String(b.name)),
      )
    })
    setActiveSavedFilterId(normalized.id)
  }, [])

  const applySavedFilter = useCallback((filter) => {
    if (!filter) return
    const nextFilters = normalizeFilterState(filter.filters)
    pendingLibraryScrollTopRestoreRef.current = 0
    libraryScrollTopRef.current = 0
    setSelectedGame(null)
    setShowSearchSidebar(false)
    setActiveSavedFilterId(filter.id || '')
    handleFilterChange(nextFilters)
  }, [handleFilterChange])

  const deleteSavedFilter = useCallback(async (filter, action = 'request') => {
    if (!filter?.id || filter.builtIn) return
    if (action === 'cancel') {
      setSavedFilterDeleteStateById((prev) => {
        const next = { ...prev }
        delete next[filter.id]
        return next
      })
      return
    }
    if (action !== 'confirm') {
      setSavedFilterDeleteStateById((prev) => ({
        ...prev,
        [filter.id]: { confirming: true, busy: false, error: '' },
      }))
      return
    }

    setSavedFilterDeleteStateById((prev) => ({
      ...prev,
      [filter.id]: { confirming: true, busy: true, error: '' },
    }))
    try {
      const result = await window.electronAPI.deleteSavedFilter?.(filter.id)
      if (!result?.success) {
        setSavedFilterDeleteStateById((prev) => ({
          ...prev,
          [filter.id]: {
            confirming: true,
            busy: false,
            error: result?.error || 'Failed to delete filter.',
          },
        }))
        console.error('Failed to delete saved filter:', result?.error)
        return
      }
      setUserSavedFilters((prev) => prev.filter((item) => item.id !== filter.id))
      setSavedFilterDeleteStateById((prev) => {
        const next = { ...prev }
        delete next[filter.id]
        return next
      })
      if (activeSavedFilterId === filter.id) setActiveSavedFilterId('')
    } catch (err) {
      setSavedFilterDeleteStateById((prev) => ({
        ...prev,
        [filter.id]: {
          confirming: true,
          busy: false,
          error: err.message || 'Failed to delete filter.',
        },
      }))
      console.error('Failed to delete saved filter:', err)
    }
  }, [activeSavedFilterId])

  const allSavedFilters = useMemo(
    () => [...builtInSavedFilters, ...userSavedFilters],
    [userSavedFilters],
  )

  const localSavedFilterCounts = useMemo(() => {
    const nextCounts = {}
    for (const filter of allSavedFilters) {
      nextCounts[filter.id] = filterGamesWithState(games, filter.filters).length
    }
    return nextCounts
  }, [allSavedFilters, games])

  // Browse/catalog entries live entirely server-side (and are only ever
  // partially loaded client-side — see requestCatalogRange in
  // useGames.js), so a saved filter's match count for Browse mode can't be
  // computed against the local `games` array the way localSavedFilterCounts
  // does above; that's why every saved filter showed "0 matches" while
  // browsing. Ask the backend for the real count instead, via the
  // count-only catalog query (get-catalog-count — see
  // electron/db/versions.js getCatalogGames' countOnly option), one per
  // saved filter, using that filter's OWN search/filters — same "what
  // would applying this filter as-is return" semantics as the local-mode
  // counts, not combined with whatever's currently typed in the search box.
  const [catalogSavedFilterCounts, setCatalogSavedFilterCounts] = useState({})
  useEffect(() => {
    if (libraryMode !== 'catalog' || !showSavedFilters || !browseAvailable) return
    let cancelled = false
    setCatalogSavedFilterCounts((prev) => {
      const next = {}
      for (const filter of allSavedFilters) next[filter.id] = prev[filter.id] ?? null
      return next
    })
    allSavedFilters.forEach((filter) => {
      const filters = normalizeFilterState(filter.filters)
      window.electronAPI.getCatalogCount({
        search: { text: filters.text, type: filters.type },
        filters,
      }).then((result) => {
        if (cancelled) return
        setCatalogSavedFilterCounts((prev) => ({ ...prev, [filter.id]: Number(result?.total || 0) }))
      }).catch((error) => {
        console.error(`Failed to get catalog count for saved filter "${filter.name}":`, error)
        if (cancelled) return
        setCatalogSavedFilterCounts((prev) => ({ ...prev, [filter.id]: 0 }))
      })
    })
    return () => { cancelled = true }
  }, [allSavedFilters, browseAvailable, libraryMode, showSavedFilters])

  const savedFilterCounts = libraryMode === 'catalog' ? catalogSavedFilterCounts : localSavedFilterCounts

  // ── DB update check ────────────────────────────────────────────────────────
  const clearDbUpdateStatusSoon = useCallback(() => {
    setTimeout(() => setDbUpdateStatus({ text: '', progress: 0, total: 0 }), 2000)
  }, [])

  const runDbUpdateCheck = useCallback(async () => {
    if (dbUpdateRunningRef.current) return
    dbUpdateRunningRef.current = true
    setDbUpdateStatus({ text: 'Checking database updates...', progress: 0, total: 0 })
    try {
      const result = await window.electronAPI.checkDbUpdates()
      if (!result.success) {
        setDbUpdateStatus({ text: `Error: ${result.error}`, progress: 0, total: 100 })
      } else if (result.total === 0) {
        setDbUpdateStatus({ text: result.message, progress: 0, total: 0 })
      } else {
        setDbUpdateStatus({
          text: result.message || 'Database updates complete',
          progress: result.processed || result.total,
          total: result.total,
        })
      }
      clearDbUpdateStatusSoon()
    } catch (error) {
      console.error('Failed to check database updates:', error)
      setDbUpdateStatus({ text: `Error: ${error.message}`, progress: 0, total: 100 })
      clearDbUpdateStatusSoon()
    } finally {
      dbUpdateRunningRef.current = false
    }
  }, [clearDbUpdateStatusSoon])

  // ── Actions ────────────────────────────────────────────────────────────────
  const addGame = (source = 'atlas') => window.electronAPI.openImporter(source)

  // Stub — no help destination wired up yet (no docs site / in-app help
  // content exists today). See navItems.js's Help item for more context;
  // only this handler needs to change once a real destination is decided.
  const openHelp = () => {
    console.log('Help clicked (not yet implemented)')
  }

  const cancelImport = async () => {
    try {
      setImportProgress((prev) => ({
        ...prev,
        text: 'Cancel requested. Cleaning up current import...',
        canCancel: false,
        canceling: true,
      }))
      await window.electronAPI.cancelImport()
    } catch (error) {
      console.error('Failed to cancel import:', error)
    }
  }

  const unzipGame = async () => {
    const zipPath = await window.electronAPI.selectFile()
    if (!zipPath) return
    const extractPath = await window.electronAPI.selectDirectory()
    if (!extractPath) return
    setImportStatus({ text: 'Unzipping game', progress: 50, total: 100 })
    try {
      const result = await window.electronAPI.unzipGame({ zipPath, extractPath })
      setImportStatus({
        text: result.success ? 'Unzip complete' : `Error: ${result.error}`,
        progress: result.success ? 100 : 50,
        total: 100,
      })
    } catch (error) {
      setImportStatus({ text: `Error: ${error.message}`, progress: 50, total: 100 })
    } finally {
      setTimeout(() => setImportStatus({ text: '', progress: 0, total: 0 }), 2000)
    }
  }

  const isTextInputTarget = (target) => {
    if (!target) return false
    const tagName = target.tagName?.toLowerCase()
    return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable
  }

  // ── IPC listeners + init ───────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      window.electronAPI.getNsfwStatus?.().catch(() => null),
      window.electronAPI.getConfig(),
    ])
      .then(([nsfwStatus, config]) => {
        const enabled = nsfwStatus?.enabled === true
        setNsfwEnabled(enabled)
        // Only ever show the prompt when the config has never recorded an
        // answer at all (configured === false) — not just whenever the
        // current answer happens to be "no".
        if (nsfwStatus && nsfwStatus.configured === false) setNsfwPromptOpen(true)

        const browseOk = BROWSE_MODE_ENABLED && enabled
        let nextMode = normalizeSidePanelMode(
          config.Interface?.sidePanelMode,
          config.Interface?.showGameList ?? true,
          browseOk,
        )
        // Atlas should always open to the local library on launch. The
        // persisted sidePanelMode is still used to restore the sidebar style
        // (game list vs. saved filters) the user last had, but a persisted
        // Browse (catalog) or Wishlist mode must NOT be used as the startup
        // destination — those are only entered via explicit navigation
        // during the session.
        if (nextMode === SIDE_PANEL_MODES.CATALOG || nextMode === SIDE_PANEL_MODES.WISHLIST) {
          nextMode = SIDE_PANEL_MODES.GAMES
        }
        setSidebarMode(nextMode)
        setLibraryMode('local')
      })
      .catch(() => setSidebarMode(SIDE_PANEL_MODES.GAMES))

    fetchGames(false, { skipPathValidation: true }).then(() => {
      window.electronAPI.getConfig()
        .then((config) => {
          const shouldValidate = config?.Library?.validatePathsOnStartup === true ||
            config?.Library?.validatePathsOnStartup === 'true'
          if (!shouldValidate) return
          const runValidation = () => window.electronAPI.validateLibraryPaths?.()
          if (window.requestIdleCallback) {
            window.requestIdleCallback(runValidation, { timeout: 5000 })
          } else {
            setTimeout(runValidation, 1500)
          }
        })
        .catch((error) => console.error('Failed to read startup validation setting:', error))
    })
    loadWishlistIdentities()
    loadSavedFilters()

    loadVersion()
    runDbUpdateCheck()

    // IPC handlers
    const handleDbUpdateProgress = (progress) => {
      setDbUpdateStatus(sanitizeProgressState(progress))
      if (progress.progress >= progress.total && progress.total > 0) {
        setTimeout(() => setDbUpdateStatus({ text: '', progress: 0, total: 0 }), 2000)
      }
    }

    const handleImportProgress = (progress) => {
      const nextProgress = sanitizeProgressState(progress)
      setImportProgress(nextProgress)
      const isComplete =
        nextProgress.done === true ||
        nextProgress.complete === true ||
        nextProgress.canceled === true ||
        nextProgress.phase === 'done' ||
        nextProgress.phase === 'failed' ||
        nextProgress.phase === 'canceled' ||
        (
          nextProgress.progress >= nextProgress.total &&
          nextProgress.total > 0 &&
          nextProgress.canCancel === false
        )
      if (isComplete) {
        setTimeout(() => setImportProgress({ text: '', progress: 0, total: 0 }), 2000)
      }
    }

    const handleGameImported = (event, recordId) => {
      console.log(`Game imported: recordId ${recordId}`)
      window.electronAPI.getGame(recordId)
        .then((game) => { if (game) replaceGameInState(game) })
        .catch((error) => console.error(`Failed to get game for recordId ${recordId}:`, error))
    }

    const handleGameUpdated = (event, payload) => {
      if (payload && typeof payload === 'object') {
        replaceGameInState(payload)
        return
      }
      refreshGame(payload)
    }

    const handleGameDeleted = (recordId) => {
      removeGameFromState(recordId)
      setSelectedGame((current) => (current?.record_id === recordId ? null : current))
      if (gridRef.current) {
        gridRef.current.recomputeGridSize()
        gridRef.current.forceUpdate()
      }
    }

    const handleLibraryValidationProgress = (progress) => {
      if (progress?.error) { console.error('Library validation error:', progress.error); return }
      if (progress?.total) {
        setDbUpdateStatus({
          text: 'Validating installed paths...',
          progress: progress.processed,
          total: progress.total,
        })
        if (progress.processed >= progress.total) {
          setTimeout(() => setDbUpdateStatus({ text: '', progress: 0, total: 0 }), 1200)
        }
      }
    }

  const handleImportComplete = () => {
    fetchGames()
      if (browseAvailableRef.current) {
        fetchCatalogGames({ search: catalogSearchRef.current, filters: catalogQueryFiltersRef.current })
      }
      fetchWishlistGames()
      setTimeout(() => setImportProgress({ text: '', progress: 0, total: 0 }), 2000)
    }

    // Metadata settings (e.g. source order for banner/hero art) are applied
    // server-side on every get-games/get-game call, but the renderer caches
    // its game list in state — refetch so the change is visible immediately
    // instead of requiring a restart. This effect only runs once on mount,
    // so it can't safely read the latest libraryMode from a stale closure;
    // refreshing all three lists is cheap and keeps each one correct
    // whenever the user does switch to it.
    const handleMetadataChanged = () => {
      fetchGames()
      if (browseAvailableRef.current) {
        fetchCatalogGames({ search: catalogSearchRef.current, filters: catalogQueryFiltersRef.current })
      }
      fetchWishlistGames()
    }

    window.electronAPI.onWindowStateChanged(handleWindowStateChanged)
    window.electronAPI.onDbUpdateProgress(handleDbUpdateProgress)
    window.electronAPI.onImportProgress(handleImportProgress)
    window.electronAPI.onGameImported(handleGameImported)
    window.electronAPI.onGameUpdated(handleGameUpdated)
    window.electronAPI.onGameDeleted(handleGameDeleted)
    window.electronAPI.onLibraryValidationProgress?.(handleLibraryValidationProgress)
    window.electronAPI.onImportComplete(handleImportComplete)
    window.electronAPI.onUpdateStatus(handleUpdateStatus)
    const removeMetadataListener = window.electronAPI.onMetadataChanged?.(handleMetadataChanged)
    const removeNsfwListener = window.electronAPI.onNsfwChanged?.((data) => {
      // Keeps this window's Browse availability in sync when the NSFW
      // setting is changed from elsewhere — e.g. the Settings window's
      // toggle, or this same prompt answered in another open window.
      setNsfwEnabled(data?.enabled === true)
    })
    window.electronAPI.getAppUpdateState?.()
      .then((status) => { if (status?.status && status.status !== 'idle') handleUpdateStatus(status) })
      .catch((error) => console.error('Failed to load app update state:', error))

    window.electronAPI.onContextMenuCommand((event, data) => {
      if (data.action === 'properties') {
        window.electronAPI.getGame(data.recordId)
          .then((updatedGame) => { setShowSearchSidebar(false); setSelectedGame(updatedGame) })
          .catch((error) => console.error('Failed to get game for properties:', error))
      }
    })

    window.addEventListener('resize', debounceResize)
    debounceResize()

    return () => {
      window.electronAPI.removeUpdateStatusListener?.()
      if (typeof removeMetadataListener === 'function') removeMetadataListener()
      if (typeof removeNsfwListener === 'function') removeNsfwListener()
      window.removeEventListener('resize', debounceResize)
      ;[
        'window-state-changed', 'db-update-progress', 'import-progress',
        'game-imported', 'game-updated', 'library-validation-progress',
        'import-complete', 'context-menu-command', 'game-deleted',
      ].forEach((channel) => window.electronAPI.removeAllListeners(channel))
    }
  }, [])

  useEffect(() => {
    requestAnimationFrame(() => debounceResize())
  }, [showLibrarySidebar, showSearchSidebar, filterSidebarMode, filterSidebarSide, libraryMode])

  const catalogResetDebounceRef = useRef(null)
  useEffect(() => {
    if (libraryMode !== 'catalog' || !browseAvailable) return
    const paramsKey = JSON.stringify({ search: catalogSearch, filters: catalogQueryFilters })
    if (lastFetchedCatalogParamsKeyRef.current === paramsKey) {
      // Nothing about the search/filters actually changed since the last
      // fetch we dispatched — this effect only re-ran because some other
      // dependency changed (most commonly: entering Browse mode itself, or
      // catalogTotal updating once that fetch resolved). Re-fetching here
      // would wipe and reload data that's already correct, which is exactly
      // the "banners flash, spinner, banners reload" sequence this fixes.
      return
    }
    if (catalogResetDebounceRef.current) clearTimeout(catalogResetDebounceRef.current)
    catalogResetDebounceRef.current = setTimeout(() => {
      catalogResetDebounceRef.current = null
      lastFetchedCatalogParamsKeyRef.current = paramsKey
      fetchCatalogGames({ reset: true, search: catalogSearch, filters: catalogQueryFilters })
    }, 300)
    return () => {
      if (catalogResetDebounceRef.current) {
        clearTimeout(catalogResetDebounceRef.current)
        catalogResetDebounceRef.current = null
      }
    }
  }, [browseAvailable, catalogQueryFilters, catalogSearch, catalogTotal, fetchCatalogGames, libraryMode])

  useEffect(() => {
    if (!showSavedFilters || includeUninstalledRef.current) return
    includeUninstalledRef.current = true
    fetchGames(true)
  }, [showSavedFilters, fetchGames, includeUninstalledRef])

  useEffect(() => {
    if (selectedGame) return
    restoreLibraryScrollIfNeeded()
  }, [
    selectedGame,
    filteredGames.length,
    bannerSize.bannerHeight,
    showLibrarySidebar,
    showSearchSidebar,
    filterSidebarMode,
    filterSidebarSide,
    libraryMode,
    restoreLibraryScrollIfNeeded,
  ])

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!selectedGame || event.key !== 'Backspace' || isTextInputTarget(event.target)) return
      event.preventDefault()
      goBackToLibrary()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedGame, goBackToLibrary])

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen font-sans text-[13px] rounded-windowTheme overflow-hidden transform-gpu [clip-path:inset(0_round_var(--radius-window-active))]">
      {/* windowBorderHideOnMain lets the border show on every other window
          (Settings, Theme Builder, etc. — see their own unconditional
          <WindowBorderFrame /> usage) while staying off on just this, the
          main library window. windowBorderEnabled (the global on/off
          switch) is still respected first via colors.windowBorder/
          applyTheme.js — this only ever narrows that further, never
          overrides it back on. */}
      {!theme.windowBorderHideOnMain && <WindowBorderFrame />}
      {/* Header — position:fixed (see comment above WindowBorderFrame.jsx
          for why: so it can't visually cover the border overlay), which
          means it also escapes the root div's own overflow-hidden/rounded
          clip above. The logo block and the bg-primary block below it
          each get their own matching top-corner rounding directly (NOT
          overflow-hidden on this whole header — the TopNav "Add Game"
          dropdown is absolutely positioned and extends below this 70px
          bar, and would get clipped off if this clipped its own
          overflow) — without that, those two blocks would paint a
          square corner poking out past the border overlay's curve at
          the window's actual top corners. */}
      <div className="flex h-[70px] items-center z-50 fixed w-full top-0 select-none -webkit-app-region-drag">
        <div
          className="w-[60px] bg-accent flex items-center justify-center h-[70px] z-50 cursor-pointer -webkit-app-region-no-drag rounded-tl-windowTheme transform-gpu"
          onClick={goHome}
          title="Back to Library"
        >
          <svg
            className="w-[50px] h-[50px] text-atlasLogo"
            viewBox="0 0 24 24"
            style={{ shapeRendering: 'geometricPrecision' }}
            fill="currentColor"
            dangerouslySetInnerHTML={{ __html: atlasLogo.path }}
          />
        </div>
        <div className="flex-1 h-[70px] bg-primary relative -webkit-app-region-drag shadow-[0_4px_8px_rgba(0,0,0,0.5)] rounded-tr-windowTheme transform-gpu">
          {/* Accent bar: the notched strip tucked behind the logo block.
              Shown in both layouts as long as the active theme's
              nav.accentBarEnabled hasn't been turned off (see
              ThemeProvider.jsx / Appearance.jsx) — previously this was
              hardcoded to sidebar-only. */}
          {accentBarEnabled && (
            <>
              <div className="absolute top-0 left-[50px] right-[110px] h-[10px] bg-accentBar"></div>
              <div className="absolute top-0 left-[40px] w-[10px] h-[10px] bg-accentBar" style={{ clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%)' }}></div>
              <div className="absolute top-0 right-[100px] w-[10px] h-[10px] bg-accentBar" style={{ clipPath: 'polygon(0% 0%, 100% 0%, 0% 100%)' }}></div>
            </>
          )}
          <div className="w-full flex h-[70px] items-center">
            {!isTopNav && (
              <div className="flex items-center ml-5">
                <div
                  className="text-shadow-fx text-glow-fx page-titles text-accent font-semibold cursor-pointer -webkit-app-region-no-drag"
                  onClick={goHome}
                  title="Back to Library"
                >
                  {viewTitle}
                </div>
              </div>
            )}
            {isTopNav ? (
              <>
                {/* mt-[14px] nudges this whole row down from dead-center
                    (the parent row is vertically centered across the full
                    70px header) so it visually clears the min/max/close
                    row, which sits near the very top of the header. Both
                    the left and right TopNav groups share this same
                    mt-[14px]/flex row so they stay vertically aligned with
                    each other — see the absolutely positioned
                    window-controls block below for min/max/close. */}
                <div className="ml-5 mt-[14px]">
                  <TopNav
                    group="left"
                    onToggleGameList={toggleGameList}
                    onCheckDbUpdates={runDbUpdateCheck}
                    onGoHome={goHome}
                    onBrowseCatalog={browseCatalog}
                    onOpenWishlist={openWishlist}
                    onToggleSearchSidebar={toggleSearchSidebar}
                    onOpenHelp={openHelp}
                    showGameList={showLibrarySidebar}
                    libraryMode={libraryMode}
                    browseAvailable={browseAvailable}
                  />
                </div>
                <div className="flex-1" />
                {/* Shifted in from the right edge so it doesn't sit flush
                    against the corner. Version text now lives in this same
                    flex row, right after the icon group, so the icons are
                    guaranteed to sit to its left with no overlap (rather
                    than two independently-positioned absolute blocks that
                    could collide). forceIconsOnly keeps this group
                    icon-only regardless of the active theme's
                    navDisplayMode, per the current request — Filters/Help
                    etc. on the left can still show text if the theme says
                    so. */}
                <div className="mt-[14px] mr-[16px] flex items-center gap-3">
                  <TopNav
                    group="right"
                    forceIconsOnly
                    onToggleGameList={toggleGameList}
                    onCheckDbUpdates={runDbUpdateCheck}
                    onGoHome={goHome}
                    onBrowseCatalog={browseCatalog}
                    onOpenWishlist={openWishlist}
                    onToggleSearchSidebar={toggleSearchSidebar}
                    onOpenHelp={openHelp}
                    showGameList={showLibrarySidebar}
                    libraryMode={libraryMode}
                    browseAvailable={browseAvailable}
                  />
                  <span className="text-text text-xs whitespace-nowrap">Version: {version} <span style={{ color: 'Goldenrod' }}>α</span></span>
                </div>
              </>
            ) : (
              <div className="flex justify-center w-full">
                <SearchBox value={activeFilters.text} onSearchChange={handleSearchChange} onToggleSidebar={toggleSearchSidebar} />
              </div>
            )}
          </div>
          <div className="flex absolute top-1 right-2 h-[28px] -webkit-app-region-no-drag">
            <button onClick={() => window.electronAPI.minimizeWindow()} className="w-7 h-7 flex items-center justify-center bg-transparent hover:bg-tertiary transition-colors duration-200">
              <i className="fas fa-minus text-text fa-sm"></i>
            </button>
            <button onClick={() => window.electronAPI.maximizeWindow()} className="w-7 h-7 flex items-center justify-center bg-transparent hover:bg-tertiary transition-colors duration-200">
              <i className={isMaximized ? 'fas fa-window-restore text-text fa-sm' : 'fas fa-window-maximize text-text fa-sm'}></i>
            </button>
            <button onClick={() => window.electronAPI.closeWindow()} className="w-7 h-7 flex items-center justify-center bg-transparent hover:bg-danger transition-colors duration-200">
              <i className="fas fa-times text-text fa-sm"></i>
            </button>
          </div>
          {/* Sidebar-mode version readout — topnav mode's version text now
              lives inline next to the right TopNav group above instead, so
              it isn't duplicated here. */}
          {!isTopNav && (
            <div className="absolute mt-10 top-0 right-0 flex h-[10px]">
              <span className="text-text text-xs mr-4">Version: {version} <span style={{ color: 'Goldenrod' }}>α</span></span>
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 bg-tertiary fixed w-full top-[70px] bottom-[40px]">
        {!isTopNav && (
          <Sidebar
            onToggleGameList={toggleGameList}
            onCheckDbUpdates={runDbUpdateCheck}
            onGoHome={goHome}
            onBrowseCatalog={browseCatalog}
            onOpenWishlist={openWishlist}
            onToggleSearchSidebar={toggleSearchSidebar}
            onOpenHelp={openHelp}
            showGameList={showLibrarySidebar}
            libraryMode={libraryMode}
            browseAvailable={browseAvailable}
          />
        )}

        {showGameList && (
          <div className={`w-[200px] bg-secondary fixed top-[70px] bottom-[40px] z-40 overflow-y-auto ${isTopNav ? '' : 'ml-[60px]'}`}>
            {filteredGames.length === 0 ? (
              <div className="p-2 text-center text-text">
                {libraryMode === 'catalog'
                  ? 'No browse titles match these filters.'
                  : libraryMode === 'wishlist'
                    ? 'No wishlist entries yet.'
                    : 'No games found'}
              </div>
            ) : (
              filteredGames.filter(Boolean).map((game) => {
                const isSelected = selectedGame?.record_id === game.record_id
                return (
                  <div
                    key={game.record_id}
                    className={`text-shadow-fx text-glow-fx game-titles p-2 cursor-pointer hover:bg-selected ${isSelected ? 'bg-selected selected' : ''} ${game.hasInstalledVersion === false && !game.isCatalogEntry ? 'text-muted italic' : ''}`}
                    onClick={() => selectGame(game)}
                  >
                    {getGameTitle(game)}
                  </div>
                )
              })
            )}
          </div>
        )}

        {showSavedFilters && (
          <SavedFiltersPanel
            userSavedFilters={userSavedFilters}
            activeSavedFilterId={activeSavedFilterId}
            counts={savedFilterCounts}
            deleteStateById={savedFilterDeleteStateById}
            leftOffsetClassName={isTopNav ? '' : 'ml-[60px]'}
            onApplyFilter={applySavedFilter}
            onDeleteFilter={deleteSavedFilter}
          />
        )}

        {/* Filter sidebar placement: side ('left'/'right') and mode
            ('overlay'/'inline') both come from the active theme's
            nav.filterSidebar block by default, independently overridable
            in Settings > Appearance — see useTheme()/ThemeProvider.jsx.
            In 'inline' mode the panel is a normal flex sibling of
            #gameGrid (sharing horizontal space), so its DOM position
            relative to #gameGrid — rendered before vs. after — is what
            puts it on the left or right. When inline+left in sidebar
            layout, it needs the SAME ml-[60px]/ml-[260px] left offset
            #gameGrid uses below, since Sidebar.jsx and the library-list
            panel are both `fixed` (out of flex flow) — without this
            margin the inline panel would render underneath them instead
            of after them. */}
        {showSearchSidebar && !selectedGame && filterSidebarMode === 'inline' && filterSidebarSide === 'left' && (
          <div className={isTopNav ? '' : showLibrarySidebar ? 'ml-[260px]' : 'ml-[60px]'}>
            <SearchSidebar
              isVisible={showSearchSidebar}
              searchText={activeFilters.text}
              activeFilters={activeFilters}
              isCatalogMode={libraryMode === 'catalog'}
              userSavedFilters={userSavedFilters}
              mode="inline"
              side="left"
              onSearchChange={handleSearchChange}
              onFilterChange={handleFilterChange}
              onResetFilters={resetFilters}
              onSavedFilterSaved={handleSavedFilterSaved}
              onClose={() => setShowSearchSidebar(false)}
            />
          </div>
        )}

        <div
          id="gameGrid"
          className={`flex-1 bg-tertiary overflow-y-auto ${
            isTopNav
              ? ''
              // When the inline-left filter sidebar is showing, IT already
              // carries the ml-[60px]/ml-[260px] offset (see above) to
              // clear the fixed Sidebar/library-list panel — applying the
              // same margin here too would double it up as an extra gap
              // between the filter panel and the grid.
              : (showSearchSidebar && filterSidebarMode === 'inline' && filterSidebarSide === 'left' && !selectedGame)
                ? ''
                : showLibrarySidebar ? 'ml-[260px]' : 'ml-[60px]'
          }`}
          ref={gameGridRef}
          style={{ overflowX: 'hidden' }}
        >
          {selectedGame ? (
            <GameDetailPage
              game={selectedGame}
              onBack={goBackToLibrary}
              onRefresh={refreshDetailGame}
              onWishlistChanged={handleWishlistChanged}
            />
          ) : filteredGames.length === 0 ? (
            libraryMode === 'catalog' && catalogLoading ? (
              <div className="flex h-full items-center justify-center">
                <div
                  className="h-10 w-10 animate-spin rounded-full border-4 border-border border-t-accent"
                  role="status"
                  aria-label="Loading Browse titles"
                />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-center text-text">
                {libraryMode === 'catalog'
                  ? 'No browse titles match these filters.'
                  : libraryMode === 'wishlist'
                    ? 'No wishlist entries yet.'
                    : 'No games available'}
              </div>
            )
          ) : (
            <AutoSizer>
              {({ height, width }) => {
                const availableWidth = Math.max(0, width)
                const adjustedWidth = Math.max(0, availableWidth - getScrollbarWidth())
                const currentColumnCount = getColumnCountForWidth(adjustedWidth)
                const currentColumnWidth = currentColumnCount > 1
                  ? Math.max(bannerSize.bannerWidth + 16, adjustedWidth / currentColumnCount)
                  : Math.max(adjustedWidth, bannerSize.bannerWidth + 16)
                const currentRowCount = Math.ceil(filteredGames.length / currentColumnCount)
                return (
                  <Grid
                    ref={gridRef}
                    columnCount={currentColumnCount}
                    columnWidth={currentColumnWidth}
                    rowCount={currentRowCount}
                    rowHeight={bannerSize.bannerHeight + 16}
                    height={height}
                    width={adjustedWidth}
                    cellRenderer={getCellRenderer(currentColumnCount)}
                    onScroll={({ scrollTop }) => {
                      if (pendingLibraryScrollTopRestoreRef.current === null) {
                        libraryScrollTopRef.current = scrollTop || 0
                      }
                    }}
                    onSectionRendered={({ rowStartIndex, rowStopIndex }) => {
                      if (libraryMode !== 'catalog') return
                      requestCatalogRange(
                        rowStartIndex * currentColumnCount,
                        (rowStopIndex + 1) * currentColumnCount - 1,
                      )
                    }}
                    style={{ overflowX: 'hidden' }}
                  />
                )
              }}
            </AutoSizer>
          )}
          {!selectedGame && libraryMode === 'catalog' && catalogLoadError && (
            <div className="py-4 text-center text-sm text-danger">
              Browse load failed: {catalogLoadError}
            </div>
          )}
        </div>

        {showSearchSidebar && !selectedGame && filterSidebarMode === 'inline' && filterSidebarSide === 'right' && (
          <SearchSidebar
            isVisible={showSearchSidebar}
            searchText={activeFilters.text}
            activeFilters={activeFilters}
            isCatalogMode={libraryMode === 'catalog'}
            userSavedFilters={userSavedFilters}
            mode="inline"
            side="right"
            onSearchChange={handleSearchChange}
            onFilterChange={handleFilterChange}
            onResetFilters={resetFilters}
            onSavedFilterSaved={handleSavedFilterSaved}
            onClose={() => setShowSearchSidebar(false)}
          />
        )}

        {showSearchSidebar && !selectedGame && filterSidebarMode !== 'inline' && (
          <SearchSidebar
            isVisible={showSearchSidebar}
            searchText={activeFilters.text}
            activeFilters={activeFilters}
            isCatalogMode={libraryMode === 'catalog'}
            userSavedFilters={userSavedFilters}
            mode="overlay"
            side={filterSidebarSide}
            onSearchChange={handleSearchChange}
            onFilterChange={handleFilterChange}
            onResetFilters={resetFilters}
            onSavedFilterSaved={handleSavedFilterSaved}
            onClose={() => setShowSearchSidebar(false)}
          />
        )}
      </div>

      {/* Progress bars */}
      {dbUpdateStatus.text && (
        <div className="absolute bottom-[44px] left-1/2 transform -translate-x-1/2 w-[600px] bg-primary flex items-center justify-center p-2 z-[1500] border border-border opacity-95">
          <div className="flex items-center w-[540px]">
            <span className="w-[300px] text-[10px] text-text">{dbUpdateStatus.text}</span>
            <div className="relative w-[300px]">
              <div className="h-[15px] bg-progressBackground rounded overflow-hidden">
                <div className="h-full bg-progressForeground" style={{ width: `${(dbUpdateStatus.progress / (dbUpdateStatus.total || 1)) * 100}%` }}></div>
              </div>
              <span className="absolute inset-0 flex items-center justify-center text-[10px] text-text">
                Update {formatProgressNumber(dbUpdateStatus.progress)}/{formatProgressNumber(dbUpdateStatus.total)}
              </span>
            </div>
          </div>
        </div>
      )}

      {importStatus.text && (
        <div className="absolute bottom-[60px] left-1/2 transform -translate-x-1/2 w-[600px] bg-primary flex items-center justify-center p-2 z-[1500]">
          <div className="flex items-center w-[540px]">
            <span className="w-[300px] text-[10px] text-text">{importStatus.text}</span>
            <div className="relative w-[300px]">
              <div className="h-[15px] bg-progressBackground rounded overflow-hidden">
                <div className="h-full bg-progressForeground" style={{ width: `${(importStatus.progress / importStatus.total) * 100}%` }}></div>
              </div>
              <span className="absolute inset-0 flex items-center justify-center text-[10px] text-text">
                File {formatProgressNumber(importStatus.progress, { clamp: false })}/{formatProgressNumber(importStatus.total, { clamp: false })}
              </span>
            </div>
          </div>
        </div>
      )}

      {importProgress.text && (
        <div className="absolute bottom-[60px] left-1/2 transform -translate-x-1/2 w-[900px] bg-primary flex items-center justify-center p-2 z-[1500] border border-border opacity-95">
          <div className="flex items-center w-[880px] gap-2">
            <span className="w-[450px] text-[10px] text-text">{importProgress.text}</span>
            <div className="relative w-[300px]">
              <div className="h-[15px] bg-progressBackground rounded overflow-hidden">
                <div className="h-full bg-progressForeground" style={{ width: `${(importProgress.progress / (importProgress.total || 1)) * 100}%` }}></div>
              </div>
              <span className="absolute inset-0 flex items-center justify-center text-[10px] text-text">
                Game {formatProgressNumber(importProgress.progress, { clamp: false })}/{formatProgressNumber(importProgress.total, { clamp: false })}
              </span>
            </div>
            {importProgress.canCancel && (
              <button onClick={cancelImport} className="bg-danger hover:bg-dangerHover px-3 py-1 text-[10px] text-white">
                Cancel Import
              </button>
            )}
          </div>
        </div>
      )}

      {appUpdateNotice.visible && (
        <div className="fixed bottom-[40px] left-0 right-0 z-50 bg-primary border-t border-accent px-4 py-2 text-text flex items-center justify-between gap-3">
          <div className="flex items-center min-w-0">
            <i className="fas fa-arrow-circle-up mr-2 text-highlight"></i>
            <span className="truncate">{appUpdateNoticeText}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleAppUpdateAction}
              disabled={isAppUpdateActionDisabled}
              className={`bg-accent px-3 py-1 hover:bg-accentHover ${isAppUpdateActionDisabled ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              {appUpdateActionLabel}
            </button>
            <button onClick={() => setAppUpdateNotice((n) => ({ ...n, visible: false }))} className="bg-transparent px-2 py-1 hover:text-highlight" aria-label="Dismiss update notice">
              <i className="fas fa-times"></i>
            </button>
          </div>
        </div>
      )}

      {/* Footer — position:fixed, same reasoning as the header above: it
          escapes the root div's own rounded clip, so it needs its own
          matching bottom-corner rounding directly (just border-radius,
          no overflow-hidden — the Add Game dropdown above opens upward
          past this bar's top edge and would get clipped off by it). */}
      <div className="bg-primary h-[40px] grid grid-cols-[1fr_auto_1fr] items-center px-4 fixed bottom-0 w-full border-t border-accent z-50 rounded-b-windowTheme transform-gpu">
        <ImporterSourceMenu placement="footer" onSelect={addGame}>
          {({ toggle, buttonProps }) => (
            <button
              type="button"
              onClick={toggle}
              className="justify-self-start flex items-center bg-transparent text-text hover:text-highlight"
              {...buttonProps}
            >
              <i className="fas fa-plus mr-2 text-text"></i>Add Game
            </button>
          )}
        </ImporterSourceMenu>
        <div className="justify-self-center flex items-center text-center">
          <i className="fas fa-gamepad mr-2 text-text"></i>
          <span>
            {libraryMode === 'catalog'
              ? `${catalogTotal !== null ? catalogTotal : filteredGames.length} Browse Titles${catalogTotal !== null ? ` (${catalogLoadedCount} loaded)` : ''}`
              : libraryMode === 'wishlist'
                ? `${filteredGames.length} Wishlist ${filteredGames.length === 1 ? 'Entry' : 'Entries'}`
              : activeFilters.includeUninstalled
              ? `${installedGameCount} Games Installed, ${uninstalledGameCount} Uninstalled, ${totalVersions} Total Versions`
              : `${installedGameCount} Games Installed, ${totalVersions} Total Versions`}
          </span>
        </div>
        <div aria-hidden="true"></div>
      </div>

      {/* First-run NSFW / adult-content opt-in prompt. Shown once, only
          when config.ini has never recorded an answer (see
          electron/ipc/settings.js's get-nsfw-status `configured` flag) —
          not whenever the answer happens to be "no". Answering either way
          persists immediately via setNsfwEnabled and never shows again;
          the choice can still be changed later from Settings > Interface. */}
      {nsfwPromptOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-secondary p-6 rounded-cardTheme max-w-md w-full text-text">
            <h2 className="text-lg font-semibold mb-3">Enable Adult (18+) Content?</h2>
            <p className="text-sm opacity-80 mb-5">
              Atlas can optionally include adult-oriented games and visual novels in
              Browse mode, with metadata sourced from third-party sites. This content
              is intended for adults only. Would you like to enable it?
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => handleNsfwChoice(false)}
                className="px-4 py-2 rounded bg-tertiary hover:bg-buttonHover transition-colors duration-200"
              >
                No
              </button>
              <button
                onClick={() => handleNsfwChoice(true)}
                className="px-4 py-2 rounded bg-accent hover:bg-accentHover transition-colors duration-200"
              >
                Yes, I am 18 or older
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
