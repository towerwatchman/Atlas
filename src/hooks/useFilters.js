import { useState, useMemo, useCallback } from 'react'
import { getGameTitle, safeText } from '../utils/gameDisplay.js'

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
  browseSource: 'all',
  browseDateRange: 'any',
  browseSort: 'nameAsc',
  tagLogic: 'AND',
  updateAvailable: false,
  includeUninstalled: false,
  installState: 'installed',
  multipleInstalledVersions: false,
}

const arrayFilterKeys = ['category', 'engine', 'status', 'censored', 'language', 'tags']

const toArray = (value) => {
  if (Array.isArray(value)) return value.filter((item) => item !== undefined && item !== null).map(String)
  if (value === undefined || value === null || value === '') return []
  return [String(value)]
}

export const normalizeFilterState = (filters = {}) => {
  const source = filters && typeof filters === 'object' ? filters : {}
  const merged = { ...defaultFilters, ...source }
  for (const key of arrayFilterKeys) {
    merged[key] = toArray(merged[key])
  }
  merged.text = String(merged.text || '')
  merged.type = String(merged.type || 'all')
  merged.sort = String(merged.sort || 'name')
  merged.browseSource = ['all', 'f95', 'steam', 'atlas'].includes(merged.browseSource)
    ? merged.browseSource
    : 'all'
  merged.browseDateRange = ['any', '7d', '30d', '90d', 'year'].includes(merged.browseDateRange)
    ? merged.browseDateRange
    : 'any'
  if (merged.browseSort === 'name') merged.browseSort = 'nameAsc'
  merged.browseSort = ['nameAsc', 'nameDesc', 'newest', 'oldest'].includes(merged.browseSort)
    ? merged.browseSort
    : 'nameAsc'
  merged.tagLogic = merged.tagLogic === 'OR' ? 'OR' : 'AND'
  merged.updateAvailable = merged.updateAvailable === true
  merged.multipleInstalledVersions = merged.multipleInstalledVersions === true
  if (!['installed', 'uninstalled', 'all'].includes(merged.installState)) {
    merged.installState = merged.includeUninstalled ? 'all' : 'installed'
  }
  if (merged.installState === 'installed') merged.includeUninstalled = false
  if (['all', 'uninstalled'].includes(merged.installState)) merged.includeUninstalled = true
  const dateLimit = Number(merged.dateLimit)
  merged.dateLimit = Number.isFinite(dateLimit) && dateLimit > 0 ? dateLimit : 0
  return merged
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

const parseDateParts = (year, month, day) => {
  const date = new Date(Number(year), Number(month) - 1, Number(day))
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  ) {
    return null
  }
  return date.getTime()
}

const parseBrowseDateValue = (value) => {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 100000000000 ? value : value * 1000
  }

  const normalized = String(value).trim()
  if (!normalized) return null

  const compactDate = normalized.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (compactDate) {
    return parseDateParts(compactDate[1], compactDate[2], compactDate[3])
  }

  if (/^\d+$/.test(normalized)) {
    const numericValue = Number(normalized)
    if (Number.isFinite(numericValue)) {
      return numericValue > 100000000000 ? numericValue : numericValue * 1000
    }
  }

  const parsed = Date.parse(normalized)
  if (!Number.isFinite(parsed)) return null
  return parsed
}

export const getBrowseDate = (game = {}) => {
  const candidates = [
    // Browse freshness follows the source dates stored in AtlasDB. For F95
    // records, thread_publish_date is the useful listing date; last_record_update
    // tracks package refreshes and last_thread_comment is just comment activity.
    game.thread_publish_date,
    game.release_date,
    game.steam_release_date,
  ]

  for (const candidate of candidates) {
    const parsed = parseBrowseDateValue(candidate)
    if (parsed !== null) return parsed
  }
  return null
}

export const getBrowseSources = (game = {}) => {
  const sources = []
  if (game.f95_id) sources.push('f95')
  if (game.steam_id) sources.push('steam')
  if (game.atlas_id) sources.push('atlas')
  return sources
}

const getBrowseDateRangeBounds = (range) => {
  const now = Date.now()
  if (range === '7d') return { min: now - 7 * 86400000, max: now }
  if (range === '30d') return { min: now - 30 * 86400000, max: now }
  if (range === '90d') return { min: now - 90 * 86400000, max: now }
  if (range === 'year') {
    const currentYear = new Date(now).getFullYear()
    return {
      min: new Date(currentYear, 0, 1).getTime(),
      max: new Date(currentYear + 1, 0, 1).getTime() - 1,
    }
  }
  return null
}

const compareBrowseTitle = (a, b, direction = 'asc') => {
  const result = getGameTitle(a).localeCompare(getGameTitle(b))
  return direction === 'desc' ? -result : result
}

const shouldLogBrowseDateDebug = () => {
  try {
    return globalThis.localStorage?.getItem('atlasDebugBrowseDates') === 'true'
  } catch {
    return false
  }
}

const logBrowseDateDebug = (games, activeFilters, bounds) => {
  if (
    activeFilters.browseDateRange === 'any' ||
    !shouldLogBrowseDateDebug()
  ) {
    return
  }

  console.debug(
    'Browse date filter sample',
    games.slice(0, 5).map((game) => {
      const resolvedDate = getBrowseDate(game)
      return {
        title: getGameTitle(game),
        range: activeFilters.browseDateRange,
        rawDates: {
          thread_publish_date: game.thread_publish_date,
          release_date: game.release_date,
          steam_release_date: game.steam_release_date,
        },
        resolvedDate: resolvedDate ? new Date(resolvedDate).toISOString() : null,
        passes: resolvedDate !== null && resolvedDate >= bounds.min && resolvedDate <= bounds.max,
      }
    }),
  )
}

export const filterGamesWithState = (games, filters = {}, options = {}) => {
  const activeFilters = normalizeFilterState(filters)
  const browseMode = options.browseMode === true
  let result = [...(Array.isArray(games) ? games : [])]

  if (activeFilters.text) {
    const lower = activeFilters.text.toLowerCase()
    result = result.filter((game) => {
      const title = getGameTitle(game).toLowerCase()
      const creator = safeText(game.creator).toLowerCase()
      if (activeFilters.type === 'title') return title.includes(lower)
      if (activeFilters.type === 'creator') return creator.includes(lower)
      return title.includes(lower) || creator.includes(lower)
    })
  }

  if (activeFilters.updateAvailable) {
    result = result.filter((game) => game.isUpdateAvailable === true)
  }

  if (activeFilters.installState === 'installed') {
    result = result.filter((game) => game.hasInstalledVersion !== false)
  } else if (activeFilters.installState === 'uninstalled') {
    result = result.filter((game) => game.hasInstalledVersion === false)
  }

  if (activeFilters.category.length > 0) {
    result = result.filter((game) => activeFilters.category.includes(game.category))
  }

  if (activeFilters.engine.length > 0) {
    result = result.filter((game) => activeFilters.engine.includes(game.engine))
  }

  if (activeFilters.status.length > 0) {
    result = result.filter((game) => activeFilters.status.includes(game.status))
  }

  if (activeFilters.censored.length > 0) {
    result = result.filter((game) => activeFilters.censored.includes(game.censored))
  }

  if (activeFilters.language.length > 0) {
    result = result.filter((game) => {
      const langs = safeText(game.language).split(',').map((l) => l.trim())
      return activeFilters.language.some((l) => langs.includes(l))
    })
  }

  if (activeFilters.tags.length > 0) {
    result = result.filter((game) => {
      const gameTags = safeText(game.f95_tags).split(',').map((t) => t.trim())
      if (activeFilters.tagLogic === 'AND') {
        return activeFilters.tags.every((tag) => gameTags.includes(tag))
      }
      return activeFilters.tags.some((tag) => gameTags.includes(tag))
    })
  }

  if (activeFilters.dateLimit > 0) {
    const cutoff = Date.now() / 1000 - activeFilters.dateLimit * 86400
    result = result.filter((game) => (game.release_date || 0) >= cutoff)
  }

  if (browseMode && activeFilters.browseSource !== 'all') {
    result = result.filter((game) =>
      getBrowseSources(game).includes(activeFilters.browseSource)
    )
  }

  if (browseMode && activeFilters.browseDateRange !== 'any') {
    const bounds = getBrowseDateRangeBounds(activeFilters.browseDateRange)
    if (bounds !== null) {
      logBrowseDateDebug(result, activeFilters, bounds)
      result = result.filter((game) => {
        const browseDate = getBrowseDate(game)
        return browseDate !== null && browseDate >= bounds.min && browseDate <= bounds.max
      })
    }
  }

  if (activeFilters.multipleInstalledVersions) {
    result = result.filter((game) => {
      const installedCount =
        game.installedVersionCount ??
        game.versionCount ??
        (game.versions || []).filter((version) => version.isInstalled !== false).length
      return installedCount > 1
    })
  }

  result.sort((a, b) => {
    if (browseMode) {
      if (['newest', 'oldest'].includes(activeFilters.browseSort)) {
        const aDate = getBrowseDate(a)
        const bDate = getBrowseDate(b)
        const aMissing = aDate === null
        const bMissing = bDate === null
        if (aMissing !== bMissing) return aMissing ? 1 : -1
        if (!aMissing && aDate !== bDate) {
          return activeFilters.browseSort === 'oldest' ? aDate - bDate : bDate - aDate
        }
      }
      return compareBrowseTitle(
        a,
        b,
        activeFilters.browseSort === 'nameDesc' ? 'desc' : 'asc'
      )
    }
    if (activeFilters.sort === 'date') {
      return (b.release_date || 0) - (a.release_date || 0)
    }
    if (['likes', 'views', 'rating'].includes(activeFilters.sort)) {
      return parseMetric(b[activeFilters.sort]) - parseMetric(a[activeFilters.sort])
    }
    return getGameTitle(a).localeCompare(getGameTitle(b))
  })

  return result
}

export const builtInSavedFilters = [
  {
    id: 'builtin-installed',
    name: 'Installed titles',
    builtIn: true,
    filters: normalizeFilterState({ installState: 'installed' }),
  },
  {
    id: 'builtin-all',
    name: 'All titles',
    builtIn: true,
    filters: normalizeFilterState({ includeUninstalled: true, installState: 'all' }),
  },
  {
    id: 'builtin-uninstalled',
    name: 'Uninstalled titles',
    builtIn: true,
    filters: normalizeFilterState({ includeUninstalled: true, installState: 'uninstalled' }),
  },
  {
    id: 'builtin-updates',
    name: 'Updates available',
    builtIn: true,
    filters: normalizeFilterState({ updateAvailable: true }),
  },
  {
    id: 'builtin-recent',
    name: 'Recently released',
    builtIn: true,
    filters: normalizeFilterState({ sort: 'date', includeUninstalled: true, installState: 'all' }),
  },
]

export function useFilters(games, includeUninstalledRef, fetchGames, setSelectedGame) {
  const [activeFilters, setActiveFilters] = useState(() => normalizeFilterState(defaultFilters))

  const handleFilterChange = useCallback(
    (filters) => {
      const nextFilters = normalizeFilterState({
        ...activeFilters,
        ...filters,
        text: Object.prototype.hasOwnProperty.call(filters, 'text')
          ? filters.text
          : activeFilters.text,
      })
      const nextIncludeUninstalled =
        nextFilters.includeUninstalled === true ||
        ['all', 'uninstalled'].includes(nextFilters.installState)
      setActiveFilters(nextFilters)
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
    [activeFilters, includeUninstalledRef, fetchGames, setSelectedGame]
  )

  const filteredGames = useMemo(() => {
    return filterGamesWithState(games, activeFilters)
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
