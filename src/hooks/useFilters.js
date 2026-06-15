import { useState, useMemo, useCallback } from 'react'

export const defaultFilters = {
  text: '',
  type: 'all',
  category: [],
  engine: [],
  status: [],
  censored: [],
  language: [],
  tags: [],
  sort: 'name',
  dateLimit: 0,
  tagLogic: 'AND',
  updateAvailable: false,
  includeUninstalled: false,
  multipleInstalledVersions: false,
}

export function useFilters(games, includeUninstalledRef, fetchGames, setSelectedGame) {
  const [activeFilters, setActiveFilters] = useState(defaultFilters)

  const handleFilterChange = useCallback(
    (filters) => {
      setActiveFilters((prev) => ({ ...prev, ...filters, text: prev.text }))
      const nextIncludeUninstalled = filters.includeUninstalled === true
      if (includeUninstalledRef.current !== nextIncludeUninstalled) {
        includeUninstalledRef.current = nextIncludeUninstalled
        fetchGames(nextIncludeUninstalled).then(() => {
          if (!nextIncludeUninstalled) {
            setSelectedGame((current) =>
              current?.hasInstalledVersion === false ? null : current
            )
          }
        })
      }
    },
    [includeUninstalledRef, fetchGames, setSelectedGame]
  )

  const filteredGames = useMemo(() => {
    let result = [...games]

    if (activeFilters.text) {
      const lower = activeFilters.text.toLowerCase()
      result = result.filter((game) => {
        const title = (game.title || '').toLowerCase()
        const creator = (game.creator || '').toLowerCase()
        if (activeFilters.type === 'title') return title.includes(lower)
        if (activeFilters.type === 'creator') return creator.includes(lower)
        return title.includes(lower) || creator.includes(lower)
      })
    }

    if (activeFilters.updateAvailable) {
      result = result.filter((game) => game.isUpdateAvailable === true)
    }

    if (activeFilters.category.length > 0) {
      result = result.filter((game) =>
        activeFilters.category.includes(game.category)
      )
    }

    if (activeFilters.engine.length > 0) {
      result = result.filter((game) =>
        activeFilters.engine.includes(game.engine)
      )
    }

    if (activeFilters.status.length > 0) {
      result = result.filter((game) =>
        activeFilters.status.includes(game.status)
      )
    }

    if (activeFilters.censored.length > 0) {
      result = result.filter((game) =>
        activeFilters.censored.includes(game.censored)
      )
    }

    if (activeFilters.language.length > 0) {
      result = result.filter((game) => {
        const langs = (game.language || '').split(',').map((l) => l.trim())
        return activeFilters.language.some((l) => langs.includes(l))
      })
    }

    if (activeFilters.tags.length > 0) {
      result = result.filter((game) => {
        const gameTags = (game.f95_tags || '').split(',').map((t) => t.trim())
        if (activeFilters.tagLogic === 'AND') {
          return activeFilters.tags.every((tag) => gameTags.includes(tag))
        } else {
          return activeFilters.tags.some((tag) => gameTags.includes(tag))
        }
      })
    }

    if (activeFilters.dateLimit > 0) {
      const cutoff = Date.now() / 1000 - activeFilters.dateLimit * 86400
      result = result.filter((game) => (game.release_date || 0) >= cutoff)
    }

    if (activeFilters.multipleInstalledVersions) {
      result = result.filter((game) => {
        const installedCount =
          game.installedVersionCount ??
          game.versionCount ??
          (game.versions || []).filter(
            (version) => version.isInstalled !== false
          ).length
        return installedCount > 1
      })
    }

    const parseMetric = (value) => {
      if (typeof value === 'number') return value
      const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/,/g, '')
      const match = normalized.match(/([0-9]+(?:\.[0-9]+)?)\s*([km])?/)
      if (!match) return 0
      const amount = Number(match[1])
      const multiplier =
        match[2] === 'm' ? 1000000 : match[2] === 'k' ? 1000 : 1
      return amount * multiplier
    }

    result.sort((a, b) => {
      if (activeFilters.sort === 'date') {
        return (b.release_date || 0) - (a.release_date || 0)
      }
      if (['likes', 'views', 'rating'].includes(activeFilters.sort)) {
        return (
          parseMetric(b[activeFilters.sort]) -
          parseMetric(a[activeFilters.sort])
        )
      }
      return (a.title || '').localeCompare(b.title || '')
    })

    return result
  }, [games, activeFilters])

  const installedGameCount = useMemo(
    () => games.filter((game) => game.hasInstalledVersion !== false).length,
    [games]
  )
  const uninstalledGameCount = Math.max(0, games.length - installedGameCount)

  return {
    activeFilters,
    setActiveFilters,
    handleFilterChange,
    filteredGames,
    installedGameCount,
    uninstalledGameCount,
  }
}
