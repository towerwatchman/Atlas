import { useState, useRef, useCallback } from 'react'
import { getGameTitle, normalizeGameForRenderer, normalizeGamesForRenderer } from '../utils/gameDisplay.js'

const debounce = (func, delay) => {
  let timeout
  return (...args) => {
    clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), delay)
  }
}

const CATALOG_PAGE_SIZE = 250

const normalizeCatalogRows = (rows) =>
  normalizeGamesForRenderer(rows).map((game) => ({
    ...game,
    isCatalogEntry: true,
    isMetadataOnly: true,
  }))

export function useGames() {
  const [games, setGames] = useState([])
  // Sparse, index-aligned catalog array: once the initial reset fetch
  // resolves, this array's length is set to the server's reported total
  // immediately (so the Grid can size its scrollbar to the real catalog
  // size right away), with `null` placeholders at every index whose page
  // hasn't been fetched yet. Indices fill in as requestCatalogRange() is
  // called for whatever range the Grid actually scrolls to — there is no
  // requirement to load page 1, then 2, then 3 in order before reaching
  // page 40.
  const [catalogGames, setCatalogGames] = useState([])
  // True only while the initial (reset) fetch — which also resolves the
  // total count — is in flight. Drives the centered loading spinner.
  const [catalogLoading, setCatalogLoading] = useState(false)
  // True while any background page fetch is in flight (i.e. the user
  // scrolled to a range that isn't loaded yet). Not currently surfaced as
  // its own UI text — individual not-yet-loaded cells render their own
  // placeholder — but kept available for callers that want it.
  const [catalogLoadingMore, setCatalogLoadingMore] = useState(false)
  const [catalogTotal, setCatalogTotal] = useState(null)
  const [catalogLoadError, setCatalogLoadError] = useState('')
  const [wishlistGames, setWishlistGames] = useState([])
  const [totalVersions, setTotalVersions] = useState(0)
  const includeUninstalledRef = useRef(true)
  // Bumped on every reset; any page fetch already in flight from a
  // previous "generation" checks this and discards its result instead of
  // writing stale data into the current catalogGames array.
  const catalogLoadTokenRef = useRef(0)
  const catalogTotalRef = useRef(null)
  const catalogSearchRef = useRef({ text: '', type: 'all' })
  const catalogFiltersRef = useRef({})
  // Page-aligned (multiples of CATALOG_PAGE_SIZE) offsets that are fully
  // loaded / currently being fetched — lets requestCatalogRange() skip
  // re-requesting a page that's already loaded or already in flight.
  const catalogLoadedOffsetsRef = useRef(new Set())
  const catalogPendingOffsetsRef = useRef(new Set())
  const catalogRangeDebounceRef = useRef(null)

  const updateGamesState = useCallback((gamesArray) => {
    const normalizedGames = normalizeGamesForRenderer(gamesArray)
    setGames(normalizedGames)
    setTotalVersions(
      normalizedGames.reduce((sum, game) => sum + (game.versionCount || 0), 0)
    )
  }, [])

  const fetchGames = useCallback(
    (includeUninstalled = includeUninstalledRef.current, options = {}) =>
      window.electronAPI
        .getGames({ includeUninstalled, options })
        .then((allGames) => {
          const gamesArray = normalizeGamesForRenderer(allGames)
          console.log(
            `Fetched ${gamesArray.length} games; includeUninstalled=${includeUninstalled}`
          )
          updateGamesState(gamesArray)
          return gamesArray
        })
        .catch((error) => {
          console.error('Failed to fetch games:', error)
          return []
        }),
    [updateGamesState]
  )

  // Fetches a single page-aligned offset and writes it into catalogGames
  // at its absolute index position. No-ops if that offset is already
  // loaded or already being fetched. `token` ties the result back to the
  // reset "generation" it was requested under (see fetchCatalogGames) —
  // if a reset happens while this is in flight, the stale result is
  // dropped instead of corrupting the new catalogGames array.
  const fetchCatalogPage = useCallback((offset, token) => {
    if (
      catalogLoadedOffsetsRef.current.has(offset) ||
      catalogPendingOffsetsRef.current.has(offset)
    ) {
      return
    }
    catalogPendingOffsetsRef.current.add(offset)
    setCatalogLoadingMore(true)
    window.electronAPI
      .getCatalogGames({
        offset,
        limit: CATALOG_PAGE_SIZE,
        includeTotal: false,
        search: catalogSearchRef.current,
        filters: catalogFiltersRef.current,
      })
      .then((result) => {
        if (catalogLoadTokenRef.current !== token) return
        const rawRows = Array.isArray(result) ? result : result?.games || []
        const gamesArray = normalizeCatalogRows(rawRows)
        catalogLoadedOffsetsRef.current.add(offset)
        setCatalogGames((prev) => {
          const minLength = Math.max(prev.length, offset + gamesArray.length, catalogTotalRef.current || 0)
          const next = prev.length < minLength
            ? prev.concat(new Array(minLength - prev.length).fill(null))
            : prev.slice()
          gamesArray.forEach((game, i) => { next[offset + i] = game })
          return next
        })
        console.log(`Fetched AtlasDB catalog page at offset ${offset} (${gamesArray.length} rows)`)
      })
      .catch((error) => {
        console.error(`Failed to fetch AtlasDB catalog page at offset ${offset}:`, error)
        setCatalogLoadError(error?.message || String(error))
      })
      .finally(() => {
        catalogPendingOffsetsRef.current.delete(offset)
        if (catalogLoadTokenRef.current === token) {
          setCatalogLoadingMore(catalogPendingOffsetsRef.current.size > 0)
        }
      })
  }, [])

  // Resets the catalog (new search/filters, or any other "start over"
  // trigger) and loads page 0 WITH the total count, so the Grid can size
  // its scrollbar to the real catalog size before any other page loads.
  const fetchCatalogGames = useCallback(({ reset = true, search = null, filters = null } = {}) => {
    if (!reset) return Promise.resolve([])
    const token = catalogLoadTokenRef.current + 1
    catalogLoadTokenRef.current = token
    catalogSearchRef.current = {
      text: String(search?.text || '').trim(),
      type: String(search?.type || 'all'),
    }
    catalogFiltersRef.current = filters && typeof filters === 'object' ? filters : {}
    catalogLoadedOffsetsRef.current = new Set()
    catalogPendingOffsetsRef.current = new Set()
    catalogTotalRef.current = null
    if (catalogRangeDebounceRef.current) {
      clearTimeout(catalogRangeDebounceRef.current)
      catalogRangeDebounceRef.current = null
    }
    setCatalogTotal(null)
    setCatalogGames([])
    setCatalogLoadError('')
    setCatalogLoading(true)
    setCatalogLoadingMore(false)
    return window.electronAPI
      .getCatalogGames({
        offset: 0,
        limit: CATALOG_PAGE_SIZE,
        includeTotal: true,
        search: catalogSearchRef.current,
        filters: catalogFiltersRef.current,
      })
      .then((result) => {
        if (catalogLoadTokenRef.current !== token) return []
        const rawRows = Array.isArray(result) ? result : result?.games || []
        const gamesArray = normalizeCatalogRows(rawRows)
        const total = Array.isArray(result) ? gamesArray.length : Number(result?.total) || 0
        catalogTotalRef.current = total
        catalogLoadedOffsetsRef.current.add(0)
        setCatalogTotal(total)
        setCatalogGames(() => {
          const next = new Array(Math.max(total, gamesArray.length)).fill(null)
          gamesArray.forEach((game, i) => { next[i] = game })
          return next
        })
        console.log(`Fetched ${gamesArray.length} AtlasDB catalog games; total=${total}`)
        return gamesArray
      })
      .catch((error) => {
        console.error('Failed to fetch AtlasDB catalog:', error)
        setCatalogLoadError(error?.message || String(error))
        return []
      })
      .finally(() => {
        if (catalogLoadTokenRef.current === token) setCatalogLoading(false)
      })
  }, [])

  // Called from the Grid's onSectionRendered — startIndex/stopIndex are
  // absolute item indices (row*columns based), exactly the range the Grid
  // is currently trying to render (react-virtualized already pads this
  // with its own overscan). Fetches whichever page(s) cover that range and
  // aren't already loaded/loading; everything already loaded or already
  // in flight is skipped, so rapid scrolling doesn't pile up duplicate
  // requests.
  //
  // The actual dispatch is debounced: onSectionRendered fires once for
  // EVERY intermediate position the Grid passes through during a fast
  // scroll/fling, not just where it settles. Without debouncing, flinging
  // from the top to the bottom of a large catalog queues a fetch for every
  // page scrolled past on the way down — and since the underlying SQLite
  // connection processes one query at a time, the page you actually
  // stopped on ends up stuck behind dozens of irrelevant ones. Debouncing
  // means only the range still current ~120ms after motion stops actually
  // triggers a request; placeholders still render instantly regardless,
  // only the network/IPC dispatch is delayed.
  const requestCatalogRangeImmediate = useCallback((startIndex, stopIndex) => {
    const total = catalogTotalRef.current
    if (total === null || total <= 0) return
    const safeStart = Math.max(0, Math.min(startIndex, stopIndex))
    const safeStop = Math.min(total - 1, Math.max(startIndex, stopIndex))
    if (safeStop < safeStart) return
    const token = catalogLoadTokenRef.current
    const firstPage = Math.floor(safeStart / CATALOG_PAGE_SIZE)
    const lastPage = Math.floor(safeStop / CATALOG_PAGE_SIZE)
    for (let page = firstPage; page <= lastPage; page += 1) {
      fetchCatalogPage(page * CATALOG_PAGE_SIZE, token)
    }
  }, [fetchCatalogPage])
  const requestCatalogRange = useCallback((startIndex, stopIndex) => {
    if (catalogRangeDebounceRef.current) clearTimeout(catalogRangeDebounceRef.current)
    catalogRangeDebounceRef.current = setTimeout(() => {
      catalogRangeDebounceRef.current = null
      requestCatalogRangeImmediate(startIndex, stopIndex)
    }, 120)
  }, [requestCatalogRangeImmediate])

  const resetCatalogGames = useCallback(() => {
    catalogLoadTokenRef.current += 1
    catalogLoadedOffsetsRef.current = new Set()
    catalogPendingOffsetsRef.current = new Set()
    catalogTotalRef.current = null
    if (catalogRangeDebounceRef.current) {
      clearTimeout(catalogRangeDebounceRef.current)
      catalogRangeDebounceRef.current = null
    }
    setCatalogGames([])
    setCatalogLoading(false)
    setCatalogLoadingMore(false)
    setCatalogTotal(null)
    setCatalogLoadError('')
  }, [])

  const fetchWishlistGames = useCallback(
    () =>
      window.electronAPI
        .getWishlistEntries()
        .then((allGames) => {
          const gamesArray = normalizeGamesForRenderer(allGames).map((game) => ({
            ...game,
            isCatalogEntry: true,
            isMetadataOnly: true,
            isWishlistEntry: true,
            isWishlisted: true,
          }))
          console.log(`Fetched ${gamesArray.length} wishlist entries`)
          setWishlistGames(gamesArray)
          return gamesArray
        })
        .catch((error) => {
          console.error('Failed to fetch wishlist entries:', error)
          return []
        }),
    []
  )

  const replaceGameInState = useCallback((game) => {
    const normalizedGame = normalizeGameForRenderer(game)
    if (!normalizedGame?.record_id) return
    setGames((prev) => {
      const shouldHideMissing =
        !includeUninstalledRef.current && normalizedGame.hasInstalledVersion === false
      const exists = prev.some(
        (existing) => existing.record_id === normalizedGame.record_id
      )
      const newGames = shouldHideMissing
        ? prev.filter((existing) => existing.record_id !== normalizedGame.record_id)
        : exists
        ? prev.map((existing) =>
            existing.record_id === normalizedGame.record_id ? normalizedGame : existing
          )
        : [...prev, normalizedGame].sort((a, b) =>
            getGameTitle(a).localeCompare(getGameTitle(b))
          )
      setTotalVersions(
        newGames.reduce((sum, g) => sum + (g.versionCount || 0), 0)
      )
      return newGames
    })
  }, [])

  const removeGameFromState = useCallback((id) => {
    setGames((prev) => {
      const newGames = prev.filter((g) => g.record_id !== id)
      setTotalVersions(
        newGames.reduce((sum, game) => sum + (game.versionCount || 0), 0)
      )
      return newGames
    })
  }, [])

  const refreshGame = useCallback(
    debounce((recordId) => {
      console.log(`refreshGame called for recordId: ${recordId}`)
      window.electronAPI
        .getGame(recordId)
        .then((updatedGame) => {
          const normalizedGame = normalizeGameForRenderer(updatedGame)
          if (normalizedGame) {
            setGames((prev) => {
              const shouldHideMissing =
                !includeUninstalledRef.current &&
                normalizedGame.hasInstalledVersion === false
              const newGames = shouldHideMissing
                ? prev.filter((g) => g.record_id !== normalizedGame.record_id)
                : prev.map((g) =>
                    g.record_id === normalizedGame.record_id ? normalizedGame : g
                  )
              setTotalVersions(
                newGames.reduce((sum, game) => sum + (game.versionCount || 0), 0)
              )
              return newGames
            })
          } else {
            console.warn(`No game data returned for recordId: ${recordId}`)
          }
        })
        .catch((error) =>
          console.error(`Failed to update game for recordId ${recordId}:`, error)
        )
    }, 100),
    []
  )

  return {
    games,
    catalogGames,
    catalogLoading,
    catalogLoadingMore,
    catalogTotal,
    catalogLoadError,
    wishlistGames,
    totalVersions,
    fetchGames,
    fetchCatalogGames,
    requestCatalogRange,
    resetCatalogGames,
    fetchWishlistGames,
    updateGamesState,
    replaceGameInState,
    removeGameFromState,
    refreshGame,
    includeUninstalledRef,
  }
}
