import { useState, useMemo, useCallback } from 'react'
import { getGameTitle, safeText } from '../utils/gameDisplay.js'

export const defaultFilters = {
  text: '',
  type: 'all',
  source: 'all',
  category: [],
  engine: [],
  status: [],
  censored: [],
  language: [],
  tags: [],
  excludedCategories: [],
  excludedEngines: [],
  excludedStatuses: [],
  excludedTags: [],
  sort: 'name',
  sortDirection: 'asc',
  dateLimit: 0,
  dateField: 'none',
  dateRange: 'any',
  dateFrom: '',
  dateTo: '',
  browseSource: 'all',
  browseDateBasis: 'thread_updated',
  browseDateRange: 'any',
  browseSort: 'nameAsc',
  tagLogic: 'AND',
  updateAvailable: false,
  favoritesOnly: false,
  steamMapped: false,
  personalRatingMin: 0,
  personalRatingRatedOnly: false,
  includeUninstalled: false,
  installState: 'installed',
  multipleInstalledVersions: false,
}

const arrayFilterKeys = [
  'category',
  'engine',
  'status',
  'censored',
  'language',
  'tags',
  'excludedCategories',
  'excludedEngines',
  'excludedStatuses',
  'excludedTags',
]
const searchTypes = ['all', 'title', 'creator', 'atlasId', 'f95Id', 'lewdcornerId', 'steamId', 'anyId']
const sourceTypes = ['all', 'f95', 'lewdcorner', 'steam', 'atlas']
const dateFields = ['none', 'releaseDate', 'lastInstalled', 'lastPlayed', 'latestUpdate', 'threadPublished', 'wishlistAdded']
const dateRanges = ['any', '7d', '30d', '90d', 'year', 'custom']
const sortTypes = [
  'name',
  'creator',
  'date',
  'likes',
  'views',
  'rating',
  'installedVersionCount',
  'newlyInstalled',
  'newlyPlayed',
  'playtime',
  'fileSize',
  'personalRating',
]
const defaultDescSortTypes = ['date', 'likes', 'views', 'rating', 'newlyInstalled', 'newlyPlayed', 'playtime', 'fileSize', 'personalRating']

const toArray = (value) => {
  if (Array.isArray(value)) return value.filter((item) => item !== undefined && item !== null).map(String)
  if (value === undefined || value === null || value === '') return []
  return [String(value)]
}

const normalizeSearchType = (value) => {
  const normalized = String(value || 'all')
  return searchTypes.includes(normalized) ? normalized : 'all'
}

const normalizeSourceType = (value) => {
  const normalized = String(value || 'all').toLowerCase()
  return sourceTypes.includes(normalized) ? normalized : 'all'
}

const normalizeSortType = (value) => {
  const normalized = String(value || 'name')
  return sortTypes.includes(normalized) ? normalized : 'name'
}

const normalizeDateField = (value) => {
  const normalized = String(value || 'none')
  return dateFields.includes(normalized) ? normalized : 'none'
}

const normalizeDateRange = (value) => {
  const normalized = String(value || 'any')
  return dateRanges.includes(normalized) ? normalized : 'any'
}

const normalizeIsoDateInput = (value) => {
  const text = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return ''
  const parsed = new Date(`${text}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? '' : text
}

export const normalizeFilterState = (filters = {}) => {
  const source = filters && typeof filters === 'object' ? filters : {}
  const hasSortDirection = Object.prototype.hasOwnProperty.call(source, 'sortDirection')
  const merged = { ...defaultFilters, ...source }
  for (const key of arrayFilterKeys) {
    merged[key] = toArray(merged[key])
  }
  merged.excludedCategories = merged.excludedCategories.filter((value) => !includesExact(merged.category, value))
  merged.excludedEngines = merged.excludedEngines.filter((value) => !includesExact(merged.engine, value))
  merged.excludedStatuses = merged.excludedStatuses.filter((value) => !includesExact(merged.status, value))
  merged.excludedTags = merged.excludedTags.filter((value) => !includesTag(merged.tags, value))
  merged.text = String(merged.text || '').trim()
  merged.type = normalizeSearchType(merged.type)
  merged.source = normalizeSourceType(merged.source)
  merged.sort = normalizeSortType(merged.sort)
  if (!hasSortDirection && defaultDescSortTypes.includes(merged.sort)) {
    merged.sortDirection = 'desc'
  } else {
    merged.sortDirection = merged.sortDirection === 'desc' ? 'desc' : 'asc'
  }
  merged.browseSource = normalizeSourceType(merged.browseSource)
  merged.dateField = normalizeDateField(merged.dateField)
  merged.dateRange = normalizeDateRange(merged.dateRange)
  merged.dateFrom = normalizeIsoDateInput(merged.dateFrom)
  merged.dateTo = normalizeIsoDateInput(merged.dateTo)
  merged.browseDateBasis = ['thread_updated', 'thread_publish_date'].includes(merged.browseDateBasis)
    ? merged.browseDateBasis
    : 'thread_updated'
  merged.browseDateRange = ['any', '7d', '30d', '90d', 'year'].includes(merged.browseDateRange)
    ? merged.browseDateRange
    : 'any'
  if (merged.browseSort === 'name') merged.browseSort = 'nameAsc'
  merged.browseSort = ['nameAsc', 'nameDesc', 'newest', 'oldest'].includes(merged.browseSort)
    ? merged.browseSort
    : 'nameAsc'
  merged.tagLogic = merged.tagLogic === 'OR' ? 'OR' : 'AND'
  merged.updateAvailable = merged.updateAvailable === true
  merged.favoritesOnly = merged.favoritesOnly === true
  merged.steamMapped = merged.steamMapped === true
  const personalRatingMin = Number(merged.personalRatingMin)
  merged.personalRatingMin = Number.isFinite(personalRatingMin)
    ? Math.max(0, Math.min(10, Math.round(personalRatingMin)))
    : 0
  merged.personalRatingRatedOnly = merged.personalRatingRatedOnly === true
  merged.multipleInstalledVersions = merged.multipleInstalledVersions === true
  if (!['installed', 'uninstalled', 'all'].includes(merged.installState)) {
    merged.installState = merged.includeUninstalled ? 'all' : 'installed'
  }
  if (merged.installState === 'installed') merged.includeUninstalled = false
  if (['all', 'uninstalled'].includes(merged.installState)) merged.includeUninstalled = true
  const dateLimit = Number(merged.dateLimit)
  merged.dateLimit = Number.isFinite(dateLimit) && dateLimit > 0 ? dateLimit : 0
  if (merged.dateField === 'none' && [7, 30, 90].includes(merged.dateLimit)) {
    merged.dateField = 'releaseDate'
    merged.dateRange = `${merged.dateLimit}d`
  }
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

const parseSortableMetric = (value) => {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/,/g, '')
  const match = normalized.match(/^([0-9]+(?:\.[0-9]+)?)\s*([km])?$/)
  if (!match) return null
  const amount = Number(match[1])
  const multiplier =
    match[2] === 'm' ? 1000000 : match[2] === 'k' ? 1000 : 1
  return Number.isFinite(amount) ? amount * multiplier : null
}

const getReleaseDateValue = (game = {}) => {
  const rawValue = game.release_date ?? game.releaseDate ?? game.steam_release_date ?? game.steamReleaseDate
  if (rawValue === undefined || rawValue === null || rawValue === '') return null
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    if (rawValue <= 0) return null
    return rawValue > 100000000000 ? rawValue : rawValue * 1000
  }
  const parsed = Date.parse(String(rawValue).trim())
  return Number.isFinite(parsed) ? parsed : null
}

const normalizeDateValueMs = (value) => {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value <= 0) return null
    return value > 100000000000 ? value : value * 1000
  }
  const normalized = String(value).trim()
  if (!normalized) return null
  if (/^\d+$/.test(normalized)) {
    const numericValue = Number(normalized)
    if (Number.isFinite(numericValue)) {
      if (numericValue <= 0) return null
      return numericValue > 100000000000 ? numericValue : numericValue * 1000
    }
  }
  const compactDate = normalized.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (compactDate) {
    return parseDateParts(compactDate[1], compactDate[2], compactDate[3])
  }
  const parsed = Date.parse(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

const getInstalledVersionCount = (game = {}) => {
  const rawValue = game.installedVersionCount ?? game.versionCount
  const numericValue = Number(rawValue)
  if (Number.isFinite(numericValue)) return numericValue
  return (Array.isArray(game.versions) ? game.versions : [])
    .filter((version) => version?.isInstalled !== false).length
}

const getFiniteNumber = (value, fallback = 0) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

const getPositiveNumberOrNull = (value) => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

const getNullableNumber = (value) => {
  if (value === undefined || value === null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const directionMultiplier = (direction) => direction === 'desc' ? -1 : 1

const compareText = (aValue, bValue, direction = 'asc') => {
  const result = safeText(aValue).localeCompare(safeText(bValue), undefined, { sensitivity: 'base' })
  return result * directionMultiplier(direction)
}

const compareTitle = (a, b, direction = 'asc') =>
  compareText(getGameTitle(a), getGameTitle(b), direction)

const compareMaybeNumber = (aValue, bValue, direction = 'asc') => {
  const aMissing = aValue === null || aValue === undefined || !Number.isFinite(aValue)
  const bMissing = bValue === null || bValue === undefined || !Number.isFinite(bValue)
  if (aMissing !== bMissing) return aMissing ? 1 : -1
  if (aMissing && bMissing) return 0
  if (aValue === bValue) return 0
  return (aValue - bValue) * directionMultiplier(direction)
}

const compareLocalGames = (a, b, activeFilters) => {
  const direction = activeFilters.sortDirection
  let result = 0

  if (activeFilters.sort === 'creator') {
    result = compareText(a.creator, b.creator, direction)
  } else if (activeFilters.sort === 'date') {
    result = compareMaybeNumber(getReleaseDateValue(a), getReleaseDateValue(b), direction)
  } else if (['likes', 'views', 'rating'].includes(activeFilters.sort)) {
    result = compareMaybeNumber(parseSortableMetric(a[activeFilters.sort]), parseSortableMetric(b[activeFilters.sort]), direction)
  } else if (activeFilters.sort === 'installedVersionCount') {
    result = compareMaybeNumber(getInstalledVersionCount(a), getInstalledVersionCount(b), direction)
  } else if (activeFilters.sort === 'newlyInstalled') {
    result = compareMaybeNumber(getPositiveNumberOrNull(a.lastInstalled), getPositiveNumberOrNull(b.lastInstalled), direction)
  } else if (activeFilters.sort === 'newlyPlayed') {
    result = compareMaybeNumber(getPositiveNumberOrNull(a.lastPlayed), getPositiveNumberOrNull(b.lastPlayed), direction)
  } else if (activeFilters.sort === 'playtime') {
    result = compareMaybeNumber(getFiniteNumber(a.totalPlaytime), getFiniteNumber(b.totalPlaytime), direction)
  } else if (activeFilters.sort === 'fileSize') {
    result = compareMaybeNumber(getFiniteNumber(a.totalFolderSize), getFiniteNumber(b.totalFolderSize), direction)
  } else if (activeFilters.sort === 'personalRating') {
    result = compareMaybeNumber(getNullableNumber(a.personalRatingOverall), getNullableNumber(b.personalRatingOverall), direction)
  } else {
    result = compareTitle(a, b, direction)
  }

  return result || compareTitle(a, b, 'asc')
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

const MIN_BROWSE_DATE_MS = Date.UTC(2000, 0, 1)
const MAX_BROWSE_DATE_MS = Date.UTC(2100, 0, 1)

const normalizeBrowseDateMs = (value) => {
  if (!Number.isFinite(value)) return null
  if (value < MIN_BROWSE_DATE_MS || value > MAX_BROWSE_DATE_MS) return null
  return value
}

export const parseAtlasDbThreadDate = (value) => {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value <= 0) return null
    return normalizeBrowseDateMs(value > 100000000000 ? value : value * 1000)
  }

  const normalized = String(value).trim()
  if (!normalized) return null

  const compactDate = normalized.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (compactDate) {
    return normalizeBrowseDateMs(parseDateParts(compactDate[1], compactDate[2], compactDate[3]))
  }

  if (/^\d+$/.test(normalized)) {
    const numericValue = Number(normalized)
    if (Number.isFinite(numericValue)) {
      if (numericValue <= 0) return null
      return normalizeBrowseDateMs(numericValue > 100000000000 ? numericValue : numericValue * 1000)
    }
  }

  const parsed = Date.parse(normalized)
  return normalizeBrowseDateMs(parsed)
}

export const getBrowseDateInfo = (game = {}, dateBasis = 'thread_updated') => {
  const basis = dateBasis === 'thread_publish_date'
    ? 'thread_publish_date'
    : 'thread_updated'
  const isSteamOnly = game.source === 'steam' && !game.atlas_id && !game.atlasId && !game.f95_id && !game.f95Id && !game.lc_id && !game.lcId
  const isLewdCornerOnly = game.source === 'lewdcorner' && !game.atlas_id && !game.atlasId
  const rawValue = basis === 'thread_publish_date'
    ? game.threadPublishDate ?? game.thread_publish_date ?? (isLewdCornerOnly ? game.lewdcornerRegisterDate ?? game.register_date : null) ?? (isSteamOnly ? game.steam_release_date ?? game.release_date : null)
    : game.threadUpdated ?? game.thread_updated ?? game.lewdcornerThreadUpdated ?? (isSteamOnly ? game.steam_release_date ?? game.release_date : null)
  const field = basis === 'thread_publish_date'
    ? (isLewdCornerOnly ? 'lewdcorner.register_date' : isSteamOnly && rawValue === (game.steam_release_date ?? game.release_date) ? 'steam.release_date' : 'f95_zone.thread_publish_date')
    : (game.lewdcornerThreadUpdated && rawValue === game.lewdcornerThreadUpdated ? 'lewdcorner.thread_updated' : isSteamOnly && rawValue === (game.steam_release_date ?? game.release_date) ? 'steam.release_date' : 'f95_zone.thread_updated')
  return {
    timestamp: parseAtlasDbThreadDate(rawValue),
    rawValue,
    field,
    basis,
  }
}

export const getBrowseDate = (game = {}, dateBasis = 'thread_updated') => {
  return getBrowseDateInfo(game, dateBasis).timestamp
}

const getF95LatestOrder = (game = {}) => {
  const rawValue = game.f95LatestOrder ?? game.f95_latest_order
  if (rawValue === undefined || rawValue === null || rawValue === '') return null
  const numericValue = Number(rawValue)
  return Number.isFinite(numericValue) ? numericValue : null
}

const hasLatestUpdateDate = (game = {}) => {
  const info = getBrowseDateInfo(game, 'thread_updated')
  if (info.field !== 'f95_zone.thread_updated') return true
  return info.timestamp !== null
}

const parseExternalIds = (raw) => {
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

const cleanSearchText = (value) =>
  safeText(value).trim().toLowerCase().replace(/\s+/g, ' ')

const splitListText = (value) =>
  safeText(value).split(',').map((item) => item.trim()).filter(Boolean)

const normalizeTagText = (value) =>
  safeText(value).trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ')

const includesExact = (values, value) =>
  values.some((item) => safeText(item).toLowerCase() === safeText(value).toLowerCase())

const includesTag = (values, value) => {
  const normalizedValue = normalizeTagText(value)
  return values.some((item) => normalizeTagText(item) === normalizedValue)
}

const hasAnyTag = (values, excludedValues) =>
  excludedValues.some((value) => includesTag(values, value))

const parseTextTerms = (query) => {
  const positive = []
  const negative = []
  for (const token of safeText(query).trim().split(/\s+/)) {
    if (!token) continue
    if (token.startsWith('-') && token.length > 1) {
      negative.push(cleanSearchText(token.slice(1)))
    } else {
      positive.push(cleanSearchText(token))
    }
  }
  return { positive, negative }
}

const getSearchableText = (game = {}) =>
  cleanSearchText([
    getGameTitle(game),
    game.creator,
    game.f95_tags,
    game.tags,
    game.lewdcornerTags,
    game.lewdcorner_tags,
    game.lewdcornerPrefixes,
    game.engine,
    game.status,
    game.category,
  ].join(' '))

const getGameTagValues = (game = {}) => {
  const values = [
    ...splitListText(game.f95_tags),
    ...splitListText(game.tags),
    ...splitListText(game.lewdcornerTags),
    ...splitListText(game.lewdcorner_tags),
    ...splitListText(game.lewdcornerPrefixes),
    ...splitListText(game.lewdcorner_prefixes),
  ]
  const seen = new Set()
  return values.filter((value) => {
    const key = normalizeTagText(value)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const cleanIdText = (value) =>
  safeText(value).trim().toLowerCase().replace(/\s+/g, '')

const hasValue = (value) => cleanIdText(value) !== ''

const collectValues = (game = {}, keys = []) =>
  keys.map((key) => game[key]).filter(hasValue)

const getExternalIds = (game = {}) => parseExternalIds(game.external_ids ?? game.externalIds)

const getExternalValues = (game = {}, keys = []) => {
  const externalIds = getExternalIds(game)
  return keys.map((key) => externalIds[key]).filter(hasValue)
}

const getAtlasIdValues = (game = {}) => [
  ...collectValues(game, ['atlas_id', 'atlasId', 'record_id']),
  ...getExternalValues(game, ['atlas_id', 'atlasId']),
]

const getAtlasSourceIdValues = (game = {}) => [
  ...collectValues(game, ['atlas_id', 'atlasId']),
  ...getExternalValues(game, ['atlas_id', 'atlasId']),
]

const getF95IdValues = (game = {}) => [
  ...collectValues(game, ['f95_id', 'f95Id']),
  ...getExternalValues(game, ['f95_id', 'f95Id']),
]

const getSteamIdValues = (game = {}) => [
  ...collectValues(game, ['steam_id', 'steamId', 'steam_appid', 'steamAppId']),
  ...getExternalValues(game, ['steam_id', 'steamId', 'steam_appid', 'steamAppId']),
]

const getLewdCornerIdValues = (game = {}) => [
  ...collectValues(game, ['lc_id', 'lcId', 'lewdcornerId', 'lewdCornerId', 'lewdcorner_id']),
  ...getExternalValues(game, ['lc_id', 'lcId', 'lewdcornerId', 'lewdCornerId', 'lewdcorner_id']),
]

const hasSteamMapping = (game = {}) =>
  getSteamIdValues(game).some((value) => /^\d+$/.test(cleanIdText(value))) ||
  getUrlValues(game).some((url) => urlMatchesSource(url, 'steam'))

const idMatches = (values, query) => {
  const needle = cleanIdText(query)
  return needle !== '' && values.some((value) => cleanIdText(value).includes(needle))
}

const getUrlValues = (game = {}) => {
  const externalIds = getExternalIds(game)
  return [
    ...collectValues(game, [
      'siteUrl',
      'site_url',
      'sourceUrl',
      'source_url',
      'f95Url',
      'f95_url',
      'steamUrl',
      'steam_url',
      'lewdCornerSiteUrl',
      'lewdcornerSiteUrl',
      'lewdcorner_site_url',
      'storeUrl',
      'store_url',
      'atlasUrl',
      'atlas_url',
      'threadUrl',
      'thread_url',
      'url',
    ]),
    ...Object.values(externalIds).filter(hasValue),
  ]
}

const urlMatchesSource = (url, source) => {
  const value = cleanSearchText(url)
  if (source === 'f95') return value.includes('f95zone') || value.includes('f95.zone')
  if (source === 'lewdcorner') return value.includes('lewdcorner.com')
  if (source === 'steam') return value.includes('steampowered.com') || value.includes('steamcommunity.com')
  if (source === 'atlas') return value.includes('atlas') || value.includes('atlasdb')
  return false
}

export const getGameSources = (game = {}) => {
  const sources = new Set()
  const explicitSource = cleanSearchText(game.source || game.sourceType)
  if (sourceTypes.includes(explicitSource) && explicitSource !== 'all') {
    sources.add(explicitSource)
  }
  if (getF95IdValues(game).length > 0 || getUrlValues(game).some((url) => urlMatchesSource(url, 'f95'))) {
    sources.add('f95')
  }
  if (getLewdCornerIdValues(game).length > 0 || getUrlValues(game).some((url) => urlMatchesSource(url, 'lewdcorner'))) {
    sources.add('lewdcorner')
  }
  if (getSteamIdValues(game).length > 0 || getUrlValues(game).some((url) => urlMatchesSource(url, 'steam'))) {
    sources.add('steam')
  }
  if (getAtlasSourceIdValues(game).length > 0 || getUrlValues(game).some((url) => urlMatchesSource(url, 'atlas'))) {
    sources.add('atlas')
  }
  return [...sources]
}

export const getBrowseSources = getGameSources

const parseSearchQuery = (text, type) => {
  const raw = String(text || '').trim()
  const match = raw.match(/^([a-z]+):\s*(.+)$/i)
  if (!match) return { type, query: raw, urlSource: null }
  const prefix = match[1].toLowerCase()
  const query = match[2].trim()
  if (prefix === 'id') return { type: 'anyId', query, urlSource: null }
  if (prefix === 'f95') return { type: 'f95Id', query, urlSource: null }
  if (prefix === 'lc' || prefix === 'lewdcorner') return { type: 'lewdcornerId', query, urlSource: null }
  if (prefix === 'atlas') return { type: 'atlasId', query, urlSource: null }
  if (prefix === 'steam') return { type: 'steamId', query, urlSource: null }
  if (prefix === 'url') return { type, query, urlSource: normalizeSourceType(query) }
  return { type, query: raw, urlSource: null }
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

const getDateRangeBounds = (range, dateFrom = '', dateTo = '') => {
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
  if (range === 'custom') {
    const fromMs = dateFrom ? Date.parse(`${dateFrom}T00:00:00`) : Number.NaN
    const toMs = dateTo ? Date.parse(`${dateTo}T23:59:59.999`) : Number.NaN
    const min = Number.isFinite(fromMs) ? fromMs : null
    const max = Number.isFinite(toMs) ? toMs : null
    if (min === null && max === null) return null
    return { min, max }
  }
  return null
}

const getDateFieldValue = (game = {}, field) => {
  if (field === 'releaseDate') {
    return normalizeDateValueMs(game.release_date ?? game.releaseDate ?? game.steam_release_date ?? game.steamReleaseDate)
  }
  if (field === 'lastInstalled') {
    return normalizeDateValueMs(game.lastInstalled)
  }
  if (field === 'lastPlayed') {
    return normalizeDateValueMs(game.lastPlayed)
  }
  if (field === 'latestUpdate') {
    return getBrowseDate(game, 'thread_updated')
  }
  if (field === 'threadPublished') {
    return getBrowseDate(game, 'thread_publish_date')
  }
  if (field === 'wishlistAdded') {
    return normalizeDateValueMs(game.flagged_at ?? game.flaggedAt)
  }
  return null
}

const applyDateFilter = (games, activeFilters) => {
  const hasNewDateFilter = activeFilters.dateField !== 'none' && activeFilters.dateRange !== 'any'
  if (hasNewDateFilter) {
    const bounds = getDateRangeBounds(activeFilters.dateRange, activeFilters.dateFrom, activeFilters.dateTo)
    if (!bounds) return games
    return games.filter((game) => {
      const dateValue = getDateFieldValue(game, activeFilters.dateField)
      if (dateValue === null) return false
      if (bounds.min !== null && dateValue < bounds.min) return false
      if (bounds.max !== null && dateValue > bounds.max) return false
      return true
    })
  }

  if (activeFilters.dateLimit > 0) {
    const bounds = getDateRangeBounds(`${activeFilters.dateLimit}d`)
    const fallbackBounds = bounds || { min: Date.now() - activeFilters.dateLimit * 86400000, max: Date.now() }
    return games.filter((game) => {
      const dateValue = getDateFieldValue(game, 'releaseDate')
      return dateValue !== null && dateValue >= fallbackBounds.min && dateValue <= fallbackBounds.max
    })
  }

  return games
}

const compareBrowseTitle = (a, b, direction = 'asc') => {
  const result = getGameTitle(a).localeCompare(getGameTitle(b))
  if (result === 0) {
    const idResult = safeText(a?.record_id || a?.atlas_id || a?.f95_id)
      .localeCompare(safeText(b?.record_id || b?.atlas_id || b?.f95_id))
    return direction === 'desc' ? -idResult : idResult
  }
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
      const selectedInfo = getBrowseDateInfo(game, activeFilters.browseDateBasis)
      return {
        title: getGameTitle(game),
        basis: activeFilters.browseDateBasis,
        range: activeFilters.browseDateRange,
        selectedField: selectedInfo.field,
        selectedRawValue: selectedInfo.rawValue,
        rawDates: {
          thread_updated: game.thread_updated,
          threadUpdated: game.threadUpdated,
          thread_publish_date: game.thread_publish_date,
          threadPublishDate: game.threadPublishDate,
          f95_latest_order: game.f95_latest_order,
          f95LatestOrder: game.f95LatestOrder,
          f95_last_record_update: game.f95_last_record_update,
        },
        selectedDate: selectedInfo.timestamp ? new Date(selectedInfo.timestamp).toISOString() : null,
        passes: selectedInfo.timestamp !== null && selectedInfo.timestamp >= bounds.min && selectedInfo.timestamp <= bounds.max,
      }
    }),
  )
}

const logBrowseLatestAudit = (games, activeFilters) => {
  if (!shouldLogBrowseDateDebug()) return
  if (activeFilters.browseDateBasis !== 'thread_updated') return

  const f95Rows = games.filter((game) => getBrowseSources(game).includes('f95'))
  const sample = f95Rows.slice(0, 30)
  const conquering = f95Rows.find((game) =>
    getGameTitle(game).toLowerCase().includes('conquering eluria empire')
  )
  const rows = conquering && !sample.includes(conquering)
    ? [...sample, conquering]
    : sample

  console.debug('Browse F95 latest audit', rows.map((game, index) => {
    const info = getBrowseDateInfo(game, activeFilters.browseDateBasis)
    return {
      index,
      title: getGameTitle(game),
      atlas_id: game.atlas_id ?? game.atlasId,
      f95_id: game.f95_id ?? game.f95Id,
      selectedField: info.field,
      selectedRawValue: info.rawValue,
      selectedDate: info.timestamp ? new Date(info.timestamp).toISOString() : null,
      f95_latest_order: game.f95_latest_order ?? game.f95LatestOrder,
      thread_updated: game.thread_updated ?? game.threadUpdated,
      thread_publish_date: game.thread_publish_date ?? game.threadPublishDate,
      last_thread_comment: game.last_thread_comment ?? game.lastThreadComment,
      f95_last_record_update: game.f95_last_record_update,
    }
  }))
}

const logBrowseDateSmokeCounts = (games, activeFilters) => {
  if (!shouldLogBrowseDateDebug()) return
  const ranges = ['7d', '30d']
  const bases = [
    ['Latest Update', 'thread_updated'],
    ['Thread Published', 'thread_publish_date'],
  ]
  const counts = {}
  for (const [label, basis] of bases) {
    for (const range of ranges) {
      const bounds = getBrowseDateRangeBounds(range)
      counts[`${label} / Last ${range.replace('d', ' days')}`] = games.filter((game) => {
        const date = getBrowseDate(game, basis)
        return bounds && date !== null && date >= bounds.min && date <= bounds.max
      }).length
    }
  }
  console.debug('Browse date smoke counts', {
    basis: activeFilters.browseDateBasis,
    total: games.length,
    counts,
  })
}

export const filterGamesWithState = (games, filters = {}, options = {}) => {
  const activeFilters = normalizeFilterState(filters)
  const browseMode = options.browseMode === true
  let result = [...(Array.isArray(games) ? games : [])]

  if (activeFilters.text) {
    const { type, query, urlSource } = parseSearchQuery(activeFilters.text, activeFilters.type)
    const lower = cleanSearchText(query)
    const textTerms = ['all', 'title', 'creator'].includes(type)
      ? parseTextTerms(query)
      : null
    result = result.filter((game) => {
      if (urlSource && urlSource !== 'all') {
        return getGameSources(game).includes(urlSource)
      }
      const title = cleanSearchText(getGameTitle(game))
      const creator = cleanSearchText(game.creator)
      if (textTerms) {
        const searchableText = getSearchableText(game)
        if (textTerms.negative.some((term) => term && searchableText.includes(term))) {
          return false
        }
        if (type === 'title') {
          return textTerms.positive.length === 0 || textTerms.positive.every((term) => title.includes(term))
        }
        if (type === 'creator') {
          return textTerms.positive.length === 0 || textTerms.positive.every((term) => creator.includes(term))
        }
        return textTerms.positive.length === 0 || textTerms.positive.every((term) =>
          title.includes(term) || creator.includes(term) || searchableText.includes(term)
        )
      }
      if (type === 'atlasId') return idMatches(getAtlasIdValues(game), query)
      if (type === 'f95Id') return idMatches(getF95IdValues(game), query)
      if (type === 'lewdcornerId') return idMatches(getLewdCornerIdValues(game), query)
      if (type === 'steamId') return idMatches(getSteamIdValues(game), query)
      if (type === 'anyId') {
        return (
          idMatches(getAtlasIdValues(game), query) ||
          idMatches(getF95IdValues(game), query) ||
          idMatches(getLewdCornerIdValues(game), query) ||
          idMatches(getSteamIdValues(game), query)
        )
      }
      return title.includes(lower) || creator.includes(lower)
    })
  }

  if (activeFilters.updateAvailable) {
    result = result.filter((game) => game.isUpdateAvailable === true)
  }

  if (activeFilters.favoritesOnly) {
    result = result.filter((game) => game.isFavorite === true || game.is_favorite === 1)
  }

  if (activeFilters.personalRatingRatedOnly || activeFilters.personalRatingMin > 0) {
    result = result.filter((game) => {
      const rating = getNullableNumber(game.personalRatingOverall)
      if (rating === null) return false
      return activeFilters.personalRatingMin <= 0 || rating >= activeFilters.personalRatingMin
    })
  }

  if (activeFilters.steamMapped) {
    result = result.filter(hasSteamMapping)
  }

  if (activeFilters.installState === 'installed') {
    result = result.filter((game) => game.hasInstalledVersion !== false)
  } else if (activeFilters.installState === 'uninstalled') {
    result = result.filter((game) => game.hasInstalledVersion === false)
  }

  if (activeFilters.category.length > 0) {
    result = result.filter((game) => activeFilters.category.includes(game.category))
  }
  if (activeFilters.excludedCategories.length > 0) {
    result = result.filter((game) => !includesExact(activeFilters.excludedCategories, game.category))
  }

  if (activeFilters.engine.length > 0) {
    result = result.filter((game) => activeFilters.engine.includes(game.engine))
  }
  if (activeFilters.excludedEngines.length > 0) {
    result = result.filter((game) => !includesExact(activeFilters.excludedEngines, game.engine))
  }

  if (activeFilters.status.length > 0) {
    result = result.filter((game) => activeFilters.status.includes(game.status))
  }
  if (activeFilters.excludedStatuses.length > 0) {
    result = result.filter((game) => !includesExact(activeFilters.excludedStatuses, game.status))
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
      const gameTags = getGameTagValues(game)
      if (activeFilters.tagLogic === 'AND') {
        return activeFilters.tags.every((tag) => includesTag(gameTags, tag))
      }
      return activeFilters.tags.some((tag) => includesTag(gameTags, tag))
    })
  }
  if (activeFilters.excludedTags.length > 0) {
    result = result.filter((game) => !hasAnyTag(getGameTagValues(game), activeFilters.excludedTags))
  }

  result = applyDateFilter(result, activeFilters)

  const sourceFilter = browseMode ? activeFilters.browseSource : activeFilters.source
  if (sourceFilter !== 'all') {
    result = result.filter((game) =>
      getGameSources(game).includes(sourceFilter)
    )
  }

  if (browseMode && activeFilters.browseDateBasis === 'thread_updated') {
    result = result.filter(hasLatestUpdateDate)
  }

  if (browseMode && activeFilters.dateField === 'none' && activeFilters.browseDateRange !== 'any') {
    const bounds = getBrowseDateRangeBounds(activeFilters.browseDateRange)
    if (bounds !== null) {
      logBrowseDateDebug(result, activeFilters, bounds)
      result = result.filter((game) => {
        const browseDate = getBrowseDate(game, activeFilters.browseDateBasis)
        return browseDate !== null && browseDate >= bounds.min && browseDate <= bounds.max
      })
    }
  }
  if (browseMode) logBrowseDateSmokeCounts(result, activeFilters)

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
        if (
          activeFilters.browseDateBasis === 'thread_updated' &&
          getBrowseSources(a).includes('f95') &&
          getBrowseSources(b).includes('f95')
        ) {
          const aOrder = getF95LatestOrder(a)
          const bOrder = getF95LatestOrder(b)
          if (aOrder !== null && bOrder !== null && aOrder !== bOrder) {
            // f95_latest_order: smaller number = newer. "newest" wants smaller first (ASC),
            // "oldest" wants larger first (DESC) — matching the backend SQL ordering.
            return activeFilters.browseSort === 'oldest' ? bOrder - aOrder : aOrder - bOrder
          }
        }
        const aDate = getBrowseDate(a, activeFilters.browseDateBasis)
        const bDate = getBrowseDate(b, activeFilters.browseDateBasis)
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
    return compareLocalGames(a, b, activeFilters)
  })

  if (browseMode) logBrowseLatestAudit(result, activeFilters)

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
    id: 'builtin-favorites',
    name: 'Favorites',
    builtIn: true,
    filters: normalizeFilterState({ favoritesOnly: true, includeUninstalled: true, installState: 'all' }),
  },
  {
    id: 'builtin-highly-rated',
    name: 'Highly rated',
    builtIn: true,
    filters: normalizeFilterState({
      personalRatingMin: 8,
      sort: 'personalRating',
      sortDirection: 'desc',
      includeUninstalled: true,
      installState: 'all',
    }),
  },
  {
    id: 'builtin-recent',
    name: 'Recently released',
    builtIn: true,
    filters: normalizeFilterState({
      dateField: 'releaseDate',
      dateRange: '90d',
      sort: 'date',
      sortDirection: 'desc',
      includeUninstalled: true,
      installState: 'all',
    }),
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
      if (Object.prototype.hasOwnProperty.call(filters, 'text')) {
        nextFilters.text = String(filters.text ?? '')
      }
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

  const handleResetFilters = useCallback(() => {
    const nextFilters = normalizeFilterState(defaultFilters)
    const wasIncludingUninstalled = includeUninstalledRef.current === true
    includeUninstalledRef.current = false
    setActiveFilters(nextFilters)
    if (wasIncludingUninstalled) {
      fetchGames(false).then(() => {
        setSelectedGame((current) =>
          current?.hasInstalledVersion === false ? null : current
        )
      })
    }
  }, [includeUninstalledRef, fetchGames, setSelectedGame])

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
    handleResetFilters,
    filteredGames,
    installedGameCount,
    uninstalledGameCount,
  }
}
