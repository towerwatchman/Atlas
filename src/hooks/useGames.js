import { useState, useRef, useCallback } from 'react'
import { getGameTitle, normalizeGameForRenderer, normalizeGamesForRenderer } from '../utils/gameDisplay.js'

const debounce = (func, delay) => {
  let timeout
  return (...args) => {
    clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), delay)
  }
}

export function useGames() {
  const [games, setGames] = useState([])
  const [totalVersions, setTotalVersions] = useState(0)
  const includeUninstalledRef = useRef(false)

  const updateGamesState = useCallback((gamesArray) => {
    const normalizedGames = normalizeGamesForRenderer(gamesArray)
    setGames(normalizedGames)
    setTotalVersions(
      normalizedGames.reduce((sum, game) => sum + (game.versionCount || 0), 0)
    )
  }, [])

  const fetchGames = useCallback(
    (includeUninstalled = includeUninstalledRef.current) =>
      window.electronAPI
        .getGames({ includeUninstalled })
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
    totalVersions,
    fetchGames,
    updateGamesState,
    replaceGameInState,
    removeGameFromState,
    refreshGame,
    includeUninstalledRef,
  }
}
