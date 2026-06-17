import { Component, useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { AutoSizer, Grid } from 'react-virtualized'
import Sidebar from './components/ui/Sidebar.jsx'
import TopNav from './components/ui/TopNav.jsx'
import { atlasLogo } from './assets/icons/data.js'
import GameBanner from './components/library/GameBanner.jsx'
import SearchBox from './components/search/SearchBox.jsx'
import SearchButton from './components/search/SearchButton.jsx'
import SearchSidebar from './components/search/SearchSidebar.jsx'
import SavedFiltersPanel from './components/search/SavedFiltersPanel.jsx'
import GameDetailPage from './components/detail/GameDetailPage.jsx'
import { useGames } from './hooks/useGames.js'
import { builtInSavedFilters, filterGamesWithState, normalizeFilterState, useFilters } from './hooks/useFilters.js'
import { useAppUpdate } from './hooks/useAppUpdate.js'
import { useWindowState } from './hooks/useWindowState.js'
import { useTheme } from './theme/ThemeProvider.jsx'
import { getGameTitle, normalizeGameForRenderer } from './utils/gameDisplay.js'
import { getWishlistIdentityKey, withWishlistStates } from './utils/wishlistIdentity.js'
import { formatPercent, formatProgressNumber, sanitizePercentText } from './utils/formatPercent.js'

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

const knownSidePanelModes = new Set(Object.values(SIDE_PANEL_MODES))

const normalizeSidePanelMode = (value, legacyShowGameList = true) => {
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
        <div className="h-screen bg-tertiary text-text flex items-center justify-center p-6">
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
  const [columnCount, setColumnCount] = useState(1)
  const [bannerSize, setBannerSize] = useState({ bannerWidth: 537, bannerHeight: 251 })
  const [importStatus, setImportStatus] = useState({ text: '', progress: 0, total: 0 })
  const [importProgress, setImportProgress] = useState({ text: '', progress: 0, total: 0 })
  const [dbUpdateStatus, setDbUpdateStatus] = useState({ text: '', progress: 0, total: 0 })

  const gridRef = useRef(null)
  const gameGridRef = useRef(null)
  const libraryScrollTopRef = useRef(0)
  const pendingLibraryScrollTopRestoreRef = useRef(null)
  const dbUpdateRunningRef = useRef(false)
  const showGameList = sidebarMode === SIDE_PANEL_MODES.GAMES
  const showSavedFilters = sidebarMode === SIDE_PANEL_MODES.SAVED_FILTERS
  const showLibrarySidebar = showGameList || showSavedFilters

  const setAndPersistSidePanelMode = useCallback((requestedMode) => {
    const nextMode = normalizeSidePanelMode(requestedMode)
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
  }, [])

  // ── Hooks ──────────────────────────────────────────────────────────────────
  const {
    games, catalogGames, wishlistGames, totalVersions, fetchGames, fetchCatalogGames,
    fetchWishlistGames, replaceGameInState,
    removeGameFromState, refreshGame, includeUninstalledRef,
  } = useGames()

  const {
    activeFilters, handleFilterChange,
    filteredGames: localFilteredGames, installedGameCount, uninstalledGameCount,
  } = useFilters(games, includeUninstalledRef, fetchGames, setSelectedGame)
  const catalogWithWishlist = useMemo(
    () => withWishlistStates(catalogGames, wishlistIdentityKeys),
    [catalogGames, wishlistIdentityKeys],
  )
  const wishlistWithState = useMemo(
    () => withWishlistStates(wishlistGames, wishlistIdentityKeys),
    [wishlistGames, wishlistIdentityKeys],
  )
  const catalogFilteredGames = useMemo(
    () =>
      filterGamesWithState(catalogWithWishlist, {
        ...activeFilters,
        includeUninstalled: true,
        installState: 'all',
        updateAvailable: false,
        multipleInstalledVersions: false,
      }, { browseMode: true }),
    [catalogWithWishlist, activeFilters],
  )
  const wishlistFilteredGames = useMemo(
    () =>
      filterGamesWithState(wishlistWithState, {
        ...activeFilters,
        includeUninstalled: true,
        installState: 'all',
        updateAvailable: false,
        multipleInstalledVersions: false,
        browseDateRange: 'any',
      }, { browseMode: true }),
    [wishlistWithState, activeFilters],
  )
  const filteredGames =
    libraryMode === 'catalog'
      ? catalogFilteredGames
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
  const { layout } = useTheme()
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
    if (!game?.record_id || game.isMetadataOnly) return
    window.electronAPI
      .getGame(game.record_id)
      .then((updatedGame) => {
        const normalizedGame = normalizeGameForRenderer(updatedGame)
        if (normalizedGame) {
          setShowSearchSidebar(false)
          setSelectedGame(normalizedGame)
        }
      })
      .catch((error) =>
        console.error(`Failed to refresh selected game ${game.record_id}:`, error)
      )
  }, [wishlistIdentityKeys])

  // ── Grid sizing ────────────────────────────────────────────────────────────
  const getScrollbarWidth = () => {
    if (gameGridRef.current) {
      return gameGridRef.current.offsetWidth - gameGridRef.current.clientWidth
    }
    return 16
  }

  const getColumnCount = (width) => {
    const containerWidth = width || gameGridRef.current?.clientWidth || window.innerWidth - 260
    const adjustedWidth = containerWidth - getScrollbarWidth()
    return Math.max(1, Math.floor(adjustedWidth / (bannerSize.bannerWidth + 8)))
  }

  const debounceResize = debounce(() => {
    const containerWidth = gameGridRef.current?.clientWidth || window.innerWidth - 260
    const adjustedWidth = Math.max(0, containerWidth - getScrollbarWidth())
    setColumnCount(getColumnCount(adjustedWidth))
    if (gridRef.current) {
      gridRef.current.recomputeGridSize()
      gridRef.current.forceUpdate()
    }
  }, 16)

  const cellRenderer = ({ columnIndex, rowIndex, style }) => {
    const index = rowIndex * columnCount + columnIndex
    if (index >= filteredGames.length) return null
    const game = filteredGames[index]
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
    setLibraryMode('local')
    setAndPersistSidePanelMode(nextMode)
  }

  const browseCatalog = useCallback(() => {
    setLibraryMode('catalog')
    setSelectedGame(null)
    setAndPersistSidePanelMode(SIDE_PANEL_MODES.CATALOG)
    setShowSearchSidebar(false)
    fetchCatalogGames()
  }, [fetchCatalogGames, setAndPersistSidePanelMode])

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
    setLibraryMode('local')
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

  const savedFilterCounts = useMemo(() => {
    const nextCounts = {}
    for (const filter of allSavedFilters) {
      nextCounts[filter.id] = filterGamesWithState(games, filter.filters).length
    }
    return nextCounts
  }, [allSavedFilters, games])

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
  const addGame = () => window.electronAPI.openImporter()

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
    window.electronAPI.getConfig()
      .then((config) => {
        const nextMode = normalizeSidePanelMode(
          config.Interface?.sidePanelMode,
          config.Interface?.showGameList ?? true,
        )
        setSidebarMode(nextMode)
        setLibraryMode(
          nextMode === SIDE_PANEL_MODES.CATALOG
            ? 'catalog'
            : nextMode === SIDE_PANEL_MODES.WISHLIST
              ? 'wishlist'
              : 'local',
        )
        if (nextMode === SIDE_PANEL_MODES.CATALOG) fetchCatalogGames()
        if (nextMode === SIDE_PANEL_MODES.WISHLIST) fetchWishlistGames()
      })
      .catch(() => setSidebarMode(SIDE_PANEL_MODES.GAMES))

    fetchGames(false).then(() => window.electronAPI.validateLibraryPaths?.())
    loadWishlistIdentities()
    loadSavedFilters()

    window.electronAPI.getTemplate?.()
      .then((template) => {
        if (template?.bannerWidth && template?.bannerHeight) {
          setBannerSize({ bannerWidth: template.bannerWidth, bannerHeight: template.bannerHeight })
        }
      })
      .catch(() => {})

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
      if (nextProgress.progress >= nextProgress.total && nextProgress.total > 0 && nextProgress.text.includes('Import complete')) {
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
      setTimeout(() => setImportProgress({ text: '', progress: 0, total: 0 }), 2000)
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
      window.removeEventListener('resize', debounceResize)
      ;[
        'window-state-changed', 'db-update-progress', 'import-progress',
        'game-imported', 'game-updated', 'library-validation-progress',
        'import-complete', 'context-menu-command', 'game-deleted',
      ].forEach((channel) => window.electronAPI.removeAllListeners(channel))
    }
  }, [])

  useEffect(() => {
    setTimeout(() => debounceResize(), 0)
  }, [showLibrarySidebar])

  useEffect(() => {
    if (!showSavedFilters || includeUninstalledRef.current) return
    includeUninstalledRef.current = true
    fetchGames(true)
  }, [showSavedFilters, fetchGames, includeUninstalledRef])

  useEffect(() => {
    if (selectedGame) return
    restoreLibraryScrollIfNeeded()
  }, [selectedGame, filteredGames.length, columnCount, bannerSize.bannerHeight, showLibrarySidebar, restoreLibraryScrollIfNeeded])

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
    <div className="flex flex-col h-screen font-sans text-[13px]">
      {/* Header */}
      <div className="flex h-[70px] items-center z-50 fixed w-full top-0 select-none -webkit-app-region-drag">
        <div
          className="w-[60px] bg-accent flex items-center justify-center h-[70px] z-50 cursor-pointer -webkit-app-region-no-drag"
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
        <div className="flex-1 h-[70px] bg-primary relative -webkit-app-region-drag shadow-[0_4px_8px_rgba(0,0,0,0.5)]">
          {!isTopNav && (
            <>
              <div className="absolute top-0 left-[50px] right-[110px] h-[10px] bg-accentBar"></div>
              <div className="absolute top-0 left-[40px] w-[10px] h-[10px] bg-accentBar" style={{ clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%)' }}></div>
              <div className="absolute top-0 right-[100px] w-[10px] h-[10px] bg-accentBar" style={{ clipPath: 'polygon(0% 0%, 100% 0%, 0% 100%)' }}></div>
            </>
          )}
          <div className="w-full flex h-[70px] items-center">
            <div className="flex items-center ml-5">
              <div className="text-accent font-semibold cursor-pointer -webkit-app-region-no-drag" onClick={goHome} title="Back to Library">
                {viewTitle}
              </div>
            </div>
            {isTopNav ? (
              <>
                <div className="ml-2">
                  <TopNav
                    onToggleGameList={toggleGameList}
                    onCheckDbUpdates={runDbUpdateCheck}
                    onGoHome={goHome}
                    onBrowseCatalog={browseCatalog}
                    onOpenWishlist={openWishlist}
                    showGameList={showLibrarySidebar}
                    libraryMode={libraryMode}
                  />
                </div>
                <div className="flex-1" />
                <SearchButton onToggleSidebar={toggleSearchSidebar} />
              </>
            ) : (
              <div className="flex justify-center w-full">
                <SearchBox value={activeFilters.text} onSearchChange={handleSearchChange} onToggleSidebar={toggleSearchSidebar} />
              </div>
            )}
          </div>
          <div className="flex absolute top-1 right-2 h-[70px] -webkit-app-region-no-drag">
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
            showGameList={showLibrarySidebar}
            libraryMode={libraryMode}
          />
        )}

        {showGameList && (
          <div className={`w-[200px] bg-secondary fixed top-[70px] bottom-[40px] z-40 overflow-y-auto ${isTopNav ? '' : 'ml-[60px]'}`}>
            {filteredGames.length === 0 ? (
              <div className="p-2 text-center text-text">
                {libraryMode === 'catalog'
                  ? 'No browse titles match these filters.'
                  : libraryMode === 'wishlist'
                    ? 'No wishlist entries yet. Add titles from Browse.'
                    : 'No games found'}
              </div>
            ) : (
              filteredGames.map((game) => (
                <div
                  key={game.record_id}
                  className={`p-2 cursor-pointer hover:bg-selected ${selectedGame?.record_id === game.record_id ? 'bg-selected' : ''} ${game.hasInstalledVersion === false && !game.isCatalogEntry ? 'text-muted italic' : ''}`}
                  onClick={() => selectGame(game)}
                >
                  {getGameTitle(game)}
                </div>
              ))
            )}
          </div>
        )}

        {showSavedFilters && (
          <SavedFiltersPanel
            userSavedFilters={userSavedFilters}
            activeSavedFilterId={activeSavedFilterId}
            counts={savedFilterCounts}
            deleteStateById={savedFilterDeleteStateById}
            onApplyFilter={applySavedFilter}
            onDeleteFilter={deleteSavedFilter}
          />
        )}

        <div
          id="gameGrid"
          className={`flex-1 bg-tertiary overflow-y-auto ${isTopNav ? '' : showLibrarySidebar ? 'ml-[260px]' : 'ml-[60px]'}`}
          ref={gameGridRef}
          style={{ overflowX: 'hidden' }}
        >
          {selectedGame ? (
            <GameDetailPage
              game={selectedGame}
              onBack={goBackToLibrary}
              onRefresh={refreshGame}
              onWishlistChanged={handleWishlistChanged}
            />
          ) : filteredGames.length === 0 ? (
            <div className="text-center text-text">
              {libraryMode === 'catalog'
                ? 'No browse titles match these filters.'
                : libraryMode === 'wishlist'
                  ? 'No wishlist entries yet. Add titles from Browse.'
                  : 'No games available'}
            </div>
          ) : (
            <AutoSizer>
              {({ height, width }) => {
                const adjustedWidth = Math.max(0, width - getScrollbarWidth())
                return (
                  <Grid
                    ref={gridRef}
                    columnCount={columnCount}
                    columnWidth={() => columnCount > 1 ? adjustedWidth / columnCount - 8 : adjustedWidth / columnCount - 14}
                    rowCount={Math.ceil(filteredGames.length / columnCount)}
                    rowHeight={bannerSize.bannerHeight + 16}
                    height={height}
                    width={adjustedWidth}
                    cellRenderer={cellRenderer}
                    onScroll={({ scrollTop }) => {
                      if (pendingLibraryScrollTopRestoreRef.current === null) {
                        libraryScrollTopRef.current = scrollTop || 0
                      }
                    }}
                    style={{ overflowX: 'hidden' }}
                  />
                )
              }}
            </AutoSizer>
          )}
        </div>

        {showSearchSidebar && !selectedGame && (
          <SearchSidebar
            isVisible={showSearchSidebar}
            searchText={activeFilters.text}
            activeFilters={activeFilters}
            isCatalogMode={libraryMode === 'catalog'}
            userSavedFilters={userSavedFilters}
            onSearchChange={handleSearchChange}
            onFilterChange={handleFilterChange}
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
              <div className="h-[15px] bg-tertiary rounded overflow-hidden">
                <div className="h-full bg-accent" style={{ width: `${(dbUpdateStatus.progress / (dbUpdateStatus.total || 1)) * 100}%` }}></div>
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
              <div className="h-[15px] bg-tertiary rounded overflow-hidden">
                <div className="h-full bg-accent" style={{ width: `${(importStatus.progress / importStatus.total) * 100}%` }}></div>
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
              <div className="h-[15px] bg-tertiary rounded overflow-hidden">
                <div className="h-full bg-accent" style={{ width: `${(importProgress.progress / (importProgress.total || 1)) * 100}%` }}></div>
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

      {/* Footer */}
      <div className="bg-primary h-[40px] grid grid-cols-[1fr_auto_1fr] items-center px-4 fixed bottom-0 w-full border-t border-accent z-50">
        <button onClick={addGame} className="justify-self-start flex items-center bg-transparent text-text hover:text-highlight">
          <i className="fas fa-plus mr-2 text-text"></i>Add Game
        </button>
        <div className="justify-self-center flex items-center text-center">
          <i className="fas fa-gamepad mr-2 text-text"></i>
          <span>
            {libraryMode === 'catalog'
              ? `${filteredGames.length} Browse Titles`
              : libraryMode === 'wishlist'
                ? `${filteredGames.length} Wishlist ${filteredGames.length === 1 ? 'Entry' : 'Entries'}`
              : activeFilters.includeUninstalled
              ? `${installedGameCount} Games Installed, ${uninstalledGameCount} Uninstalled, ${totalVersions} Total Versions`
              : `${installedGameCount} Games Installed, ${totalVersions} Total Versions`}
          </span>
        </div>
        <div aria-hidden="true"></div>
      </div>
    </div>
  )
}

export default App
