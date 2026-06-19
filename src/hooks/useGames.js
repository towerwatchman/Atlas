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

const getCatalogIdentity = (game = {}) =>
  String(game.catalogKey || game.record_id || '').trim()

const mergeCatalogRows = (previous, nextRows, { reset = false } = {}) => {
  const merged = reset ? [] : [...previous]
  const seen = new Set(merged.map(getCatalogIdentity).filter(Boolean))
  for (const game of nextRows) {
    const key = getCatalogIdentity(game)
    if (key && seen.has(key)) continue
    if (key) seen.add(key)
    merged.push(game)
  }
  return merged
}

export function useGames() {
  const [games, setGames] = useState([])
  const [catalogGames, setCatalogGames] = useState([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogLoadingMore, setCatalogLoadingMore] = useState(false)
  const [catalogHasMore, setCatalogHasMore] = useState(false)
  const [catalogOffset, setCatalogOffset] = useState(0)
  const [catalogTotal, setCatalogTotal] = useState(null)
  const [catalogLoadError, setCatalogLoadError] = useState('')
  const [wishlistGames, setWishlistGames] = useState([])
  const [totalVersions, setTotalVersions] = useState(0)
  const includeUninstalledRef = useRef(false)
  const catalogLoadTokenRef = useRef(0)
  const catalogLoadingRef = useRef(false)
  const catalogOffsetRef = useRef(0)
  const catalogHasMoreRef = useRef(false)
  const catalogSearchRef = useRef({ text: '', type: 'all' })
  const catalogFiltersRef = useRef({})

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

  const loadCatalogPage = useCallback(async ({ reset = false, search = null, filters = null } = {}) => {
    if (catalogLoadingRef.current && !reset) return []
    const token = reset ? catalogLoadTokenRef.current + 1 : catalogLoadTokenRef.current
    if (reset) {
      catalogLoadTokenRef.current = token
      catalogOffsetRef.current = 0
      catalogHasMoreRef.current = false
      catalogSearchRef.current = {
        text: String(search?.text || '').trim(),
        type: String(search?.type || 'all'),
      }
      catalogFiltersRef.current = filters && typeof filters === 'object' ? filters : {}
      setCatalogOffset(0)
      setCatalogHasMore(false)
      setCatalogTotal(null)
      setCatalogGames([])
    } else if (!catalogHasMoreRef.current) {
      return []
    }

    const offset = reset ? 0 : catalogOffsetRef.current
    catalogLoadingRef.current = true
    setCatalogLoadError('')
    setCatalogLoading(reset)
    setCatalogLoadingMore(!reset)
    try {
      const result = await window.electronAPI.getCatalogGames({
        offset,
        limit: CATALOG_PAGE_SIZE,
        includeTotal: reset,
        search: catalogSearchRef.current,
        filters: catalogFiltersRef.current,
      })
      if (catalogLoadTokenRef.current !== token) return []
      const rawRows = Array.isArray(result) ? result : result?.games || []
      const gamesArray = normalizeCatalogRows(rawRows)
      setCatalogGames((prev) => mergeCatalogRows(prev, gamesArray, { reset }))
      const nextOffset = Number.isFinite(Number(result?.offset))
        ? Number(result.offset) + gamesArray.length
        : offset + gamesArray.length
      const hasMore = Array.isArray(result)
        ? gamesArray.length >= CATALOG_PAGE_SIZE
        : result?.hasMore === true
      catalogOffsetRef.current = nextOffset
      catalogHasMoreRef.current = hasMore
      setCatalogOffset(nextOffset)
      setCatalogHasMore(hasMore)
      if (!Array.isArray(result) && result?.total !== undefined && result?.total !== null) {
        setCatalogTotal(Number(result.total) || 0)
      }
      console.log(`Fetched ${gamesArray.length} AtlasDB catalog games; offset=${nextOffset}; hasMore=${hasMore}`)
      return gamesArray
    } catch (error) {
      console.error('Failed to fetch AtlasDB catalog:', error)
      setCatalogLoadError(error?.message || String(error))
      return []
    } finally {
      if (catalogLoadTokenRef.current === token) {
        catalogLoadingRef.current = false
        setCatalogLoading(false)
        setCatalogLoadingMore(false)
      }
    }
  }, [])

  const fetchCatalogGames = useCallback(
    ({ reset = true, search = null, filters = null } = {}) => loadCatalogPage({ reset, search, filters }),
    [loadCatalogPage]
  )

  const fetchMoreCatalogGames = useCallback(
    () => loadCatalogPage({ reset: false }),
    [loadCatalogPage]
  )

  const resetCatalogGames = useCallback(() => {
    catalogLoadTokenRef.current += 1
    catalogLoadingRef.current = false
    catalogOffsetRef.current = 0
    catalogHasMoreRef.current = false
    setCatalogGames([])
    setCatalogLoading(false)
    setCatalogLoadingMore(false)
    setCatalogHasMore(false)
    setCatalogOffset(0)
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
    catalogHasMore,
    catalogOffset,
    catalogTotal,
    catalogLoadError,
    wishlistGames,
    totalVersions,
    fetchGames,
    fetchCatalogGames,
    fetchMoreCatalogGames,
    resetCatalogGames,
    fetchWishlistGames,
    updateGamesState,
    replaceGameInState,
    removeGameFromState,
    refreshGame,
    includeUninstalledRef,
  }
}
