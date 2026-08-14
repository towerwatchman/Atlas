import { useState, useMemo, useCallback } from 'react'
import { getGameTitle, safeText } from '../utils/gameDisplay.js'
import { effectiveTitlePlaystate } from '../utils/playstates.js'
import {
  DEFAULT_SEARCH_FIELD_IDS, LEGACY_SEARCH_TYPE_FIELDS, SEARCH_PREFIX_FIELDS,
  normalizeSearchFieldIds,
} from '../utils/searchFields.js'

// The user's configured default field set, from [Search] defaultFields in
// config.ini. Held at module scope because normalizeFilterState is a pure
// function called from ~20 places (including saved-filter hydration and the
// builtInSavedFilters below, which run at import time) and threading config
// through all of them would be far more invasive than one setter called once at
// startup. App.jsx calls this after reading the config.
let configuredDefaultSearchFieldIds = [...DEFAULT_SEARCH_FIELD_IDS]

export const setDefaultSearchFieldIds = (ids) => {
  configuredDefaultSearchFieldIds = normalizeSearchFieldIds(ids, DEFAULT_SEARCH_FIELD_IDS)
}

export const getDefaultSearchFieldIds = () => [...configuredDefaultSearchFieldIds]

// Browse sort vocabulary. Hoisted to module scope and exported so the main
// process copy in electron/utils/savedFilterSort.js can be asserted against
// these VALUES rather than against this file's source text. The two cannot
// share a module -- main is CommonJS and this is an ESM bundle -- which is the
// same constraint ratingCategories.js lives with, and it is resolved the same
// way: duplicate the data, then let a test fail if the copies drift. A saved
// filter is normalized on both sides of the IPC boundary, so a value only one
// side knows about is silently rewritten on save and the user's sort is lost.
export const BROWSE_SORT_ALIASES = {
  name: 'titleAsc',
  nameAsc: 'titleAsc',
  nameDesc: 'titleDesc',
  newest: 'threadUpdatedDesc',
  oldest: 'threadUpdatedAsc',
}

export const BROWSE_SORT_VALUES = [
  'titleAsc',
  'titleDesc',
  'creatorAsc',
  'creatorDesc',
  'likesDesc',
  'likesAsc',
  'ratingDesc',
  'ratingAsc',
  'threadUpdatedDesc',
  'threadUpdatedAsc',
  'threadPublishedDesc',
  'threadPublishedAsc',
  'releaseDateDesc',
  'releaseDateAsc',
  'f95LatestOrderDesc',
  'f95LatestOrderAsc',
]

export const DEFAULT_BROWSE_SORT = 'threadUpdatedDesc'

export const defaultFilters = {
  text: '',
  // Retained only so saved filters written by older builds still normalize.
  // `searchFields` is what the search actually uses; see normalizeFilterState.
  type: 'all',
  // Which fields the text query looks at. Empty/absent = the user's configured
  // default. Replaces the old fixed `type: 'all'` column list.
  searchFields: [],
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
  playstates: [],
  excludedPlaystates: [],
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
  browseSort: DEFAULT_BROWSE_SORT,
  tagLogic: 'AND',
  updateAvailable: false,
  favoritesOnly: false,
  // Collection membership. Ids are numeric collection ids, plus the literal
  // 'uncategorized' sentinel for titles that belong to no collection. Empty =
  // no collection constraint. Distinct from `category`, which is the
  // atlas_data metadata category (Games/Comics/etc.).
  collectionIds: [],
  wishlistOnly: false,
  steamMapped: false,
  personalRatingMin: 0,
  personalRatingStatus: 'any',
  personalRatingRatedOnly: false,
  personalRatingOp: 'gte',
  // F95Zone/LewdCorner community rating (0-5, distinct from the personal
  // 0-10 rating above) — works across the whole catalog regardless of
  // install status, since it comes from the source site itself.
  communityRatingMin: 0,
  includeUninstalled: true,
  installState: 'all',
  multipleInstalledVersions: false,
}

const arrayFilterKeys = [
  'collectionIds',
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
  'playstates',
  'excludedPlaystates',
]
const searchTypes = ['all', 'title', 'creator', 'atlasId', 'f95Id', 'lewdcornerId', 'steamId', 'anyId']
const sourceTypes = ['all', 'f95', 'lewdcorner', 'steam', 'atlas']
const dateFields = ['none', 'releaseDate', 'lastInstalled', 'lastPlayed', 'latestUpdate', 'threadPublished', 'wishlistAdded']
const dateRanges = ['any', '7d', '30d', '90d', 'year', 'custom']
const sortTypes = [
  'name',
  'creator',
  'date',
  'lastUpdated',
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
const defaultDescSortTypes = ['date', 'lastUpdated', 'likes', 'views', 'rating', 'installedVersionCount', 'newlyInstalled', 'newlyPlayed', 'playtime', 'fileSize', 'personalRating']

export const getDefaultSortDirectionForSort = (sort) =>
  defaultDescSortTypes.includes(sort) ? 'desc' : 'asc'

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

// The fields a search should actually look at: an explicit selection if the user
// made one, otherwise their configured default.
export const resolveSearchFieldIds = (filters = {}) =>
  normalizeSearchFieldIds(
    Array.isArray(filters.searchFields) && filters.searchFields.length > 0
      ? filters.searchFields
      : configuredDefaultSearchFieldIds,
  )

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
  merged.excludedPlaystates = merged.excludedPlaystates.filter((value) => !includesExact(merged.playstates, value))
  merged.text = String(merged.text || '').trim()
  merged.type = normalizeSearchType(merged.type)
  // `searchFields` wins when present. When it isn't, this is either a fresh
  // default or a saved filter written before searchFields existed, so fall back
  // to whatever the legacy `type` meant — with 'all' mapping to the user's
  // configured default rather than the old fixed column list.
  //
  // An EMPTY array is meaningful and preserved: it means "inherit the configured
  // default", resolved at match time by resolveSearchFieldIds. Baking the default
  // in here instead would freeze whatever the default was when the filter state
  // was first created — and the initial state is built at mount, before the
  // config read resolves, so it would always freeze the built-in default.
  const legacyFields = LEGACY_SEARCH_TYPE_FIELDS[merged.type]
  const explicit = Array.isArray(source.searchFields) && source.searchFields.length > 0
    ? source.searchFields
    : legacyFields
  merged.searchFields = explicit ? normalizeSearchFieldIds(explicit) : []
  merged.source = normalizeSourceType(merged.source)
  merged.sort = normalizeSortType(merged.sort)
  if (!hasSortDirection) {
    merged.sortDirection = getDefaultSortDirectionForSort(merged.sort)
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
  merged.browseSort = BROWSE_SORT_ALIASES[merged.browseSort] || merged.browseSort
  merged.browseSort = BROWSE_SORT_VALUES.includes(merged.browseSort)
    ? merged.browseSort
    : DEFAULT_BROWSE_SORT
  merged.tagLogic = merged.tagLogic === 'OR' ? 'OR' : 'AND'
  merged.updateAvailable = merged.updateAvailable === true
  merged.favoritesOnly = merged.favoritesOnly === true
  merged.wishlistOnly = merged.wishlistOnly === true
  merged.steamMapped = merged.steamMapped === true
  const personalRatingMin = Number(merged.personalRatingMin)
  merged.personalRatingMin = Number.isFinite(personalRatingMin)
    ? Math.max(0, Math.min(10, Math.round(personalRatingMin)))
    : 0
  merged.personalRatingStatus = ['any', 'rated', 'unrated'].includes(merged.personalRatingStatus)
    ? merged.personalRatingStatus
    : merged.personalRatingRatedOnly === true
      ? 'rated'
      : 'any'
  if (merged.personalRatingMin > 0 && merged.personalRatingStatus === 'any') {
    merged.personalRatingStatus = 'rated'
  }
  if (merged.personalRatingStatus === 'unrated') {
    merged.personalRatingMin = 0
  }
  merged.personalRatingRatedOnly = merged.personalRatingStatus === 'rated'
  merged.personalRatingOp = ['lt', 'gt', 'eq', 'gte'].includes(merged.personalRatingOp) ? merged.personalRatingOp : 'gte'
  const communityRatingMin = Number(merged.communityRatingMin)
  merged.communityRatingMin = Number.isFinite(communityRatingMin)
    ? Math.max(0, Math.min(5, Math.round(communityRatingMin * 10) / 10))
    : 0
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
  // Compact calendar dates (YYYYMMDD) must be checked BEFORE the generic
  // pure-digit epoch branch below: an 8-digit string like "20260713" is all
  // digits, so the epoch branch would otherwise multiply it by 1000 and map it
  // to 1970, silently dropping the game from every date-range filter. A real
  // Unix-seconds timestamp with a plausible modern date is 10 digits, so an
  // 8-digit value whose parts form a valid calendar date is unambiguously a
  // compact date. The year guard keeps this from swallowing short epoch values.
  const compactDate = normalized.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (compactDate) {
    const year = Number(compactDate[1])
    const parsedCompact = parseDateParts(compactDate[1], compactDate[2], compactDate[3])
    if (parsedCompact !== null && year >= 1970 && year <= 2100) {
      return parsedCompact
    }
  }
  if (/^\d+$/.test(normalized)) {
    const numericValue = Number(normalized)
    if (Number.isFinite(numericValue)) {
      if (numericValue <= 0) return null
      return numericValue > 100000000000 ? numericValue : numericValue * 1000
    }
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

const getPersonalRatingOverall = (game) => {
  const overall = getNullableNumber(game?.personalRatingOverall ?? game?.personal_rating_overall)
  if (overall !== null) return overall
  const values = [
    game?.personalRatingStory ?? game?.personal_rating_story,
    game?.personalRatingGraphics ?? game?.personal_rating_graphics,
    game?.personalRatingGameplay ?? game?.personal_rating_gameplay,
    game?.personalRatingFappability ?? game?.personal_rating_fappability,
  ]
    .map(getNullableNumber)
    .filter((value) => value !== null)
  if (values.length === 0) return null
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10
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
  } else if (activeFilters.sort === 'lastUpdated') {
    result = compareMaybeNumber(getBrowseDate(a, 'thread_updated'), getBrowseDate(b, 'thread_updated'), direction)
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
    result = compareMaybeNumber(getPersonalRatingOverall(a), getPersonalRatingOverall(b), direction)
  } else {
    result = compareTitle(a, b, direction)
  }

  return result || compareTitle(a, b, 'asc')
}

const parseDateParts = (year, month, day) => {
  const y = Number(year)
  const m = Number(month)
  const d = Number(day)
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null
  const date = new Date(Date.UTC(y, m - 1, d))
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
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

const getThreadDateCeilingMs = (game = {}) => {
  const latestOrder = Number(game.f95LatestOrder ?? game.f95_latest_order)
  if (Number.isFinite(latestOrder) && latestOrder > 0) {
    // f95_latest_order is scrapeTimestamp * 100000 + pageRank.
    // Subtract 1 before division so the top item, with pageRank 100000,
    // decodes back to the scrape timestamp instead of scrape timestamp + 1s.
    return (Math.floor((latestOrder - 1) / 100000) * 1000) + 86400000
  }
  return Date.now() + 86400000
}

const swapMonthDayFromMs = (value) => {
  const normalized = normalizeBrowseDateMs(value)
  if (normalized === null) return null
  const date = new Date(normalized)
  return parseDateParts(
    date.getUTCFullYear(),
    date.getUTCDate(),
    date.getUTCMonth() + 1,
  )
}

const chooseThreadDateCandidate = (primary, swapped, ceilingMs) => {
  const normalizedPrimary = normalizeBrowseDateMs(primary)
  const normalizedSwapped = normalizeBrowseDateMs(swapped)
  if (normalizedPrimary !== null && normalizedPrimary <= ceilingMs) return normalizedPrimary
  if (normalizedSwapped !== null && normalizedSwapped <= ceilingMs) return normalizedSwapped
  return null
}

const parseDelimitedThreadDate = (normalized, ceilingMs) => {
  const match = normalized.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\D.*)?$/)
  if (!match) return null
  const [, year, first, second] = match
  return chooseThreadDateCandidate(
    parseDateParts(year, first, second),
    parseDateParts(year, second, first),
    ceilingMs,
  )
}

export const parseAtlasDbThreadDate = (value, game = {}) => {
  if (value === undefined || value === null || value === '') return null
  const ceilingMs = getThreadDateCeilingMs(game)

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value <= 0) return null
    const primary = value > 100000000000 ? value : value * 1000
    return chooseThreadDateCandidate(primary, swapMonthDayFromMs(primary), ceilingMs)
  }

  const normalized = String(value).trim()
  if (!normalized) return null

  const compactDate = normalized.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (compactDate) {
    return chooseThreadDateCandidate(
      parseDateParts(compactDate[1], compactDate[2], compactDate[3]),
      parseDateParts(compactDate[1], compactDate[3], compactDate[2]),
      ceilingMs,
    )
  }

  if (/^\d+$/.test(normalized)) {
    const numericValue = Number(normalized)
    if (Number.isFinite(numericValue)) {
      if (numericValue <= 0) return null
      const primary = numericValue > 100000000000 ? numericValue : numericValue * 1000
      return chooseThreadDateCandidate(primary, swapMonthDayFromMs(primary), ceilingMs)
    }
  }

  const delimited = parseDelimitedThreadDate(normalized, ceilingMs)
  if (delimited !== null) return delimited

  const parsed = Date.parse(normalized)
  return chooseThreadDateCandidate(parsed, swapMonthDayFromMs(parsed), ceilingMs)
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
    timestamp: basis === 'thread_updated'
      ? parseAtlasDbThreadDate(rawValue, game)
      : parseAtlasDbThreadDate(rawValue),
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

// Pull array-valued external id fields (steam_appids[]/gog_ids[] from admin
// manual links) as individual values. Accepts a real array, a JSON-string
// array, or a CSV string. Needed so an atlas catalog tile whose only Steam
// linkage is the steam_appids[] array (no scalar steam_appid) is still detected
// as a Steam source by the browse source filter.
const getExternalArrayValues = (game = {}, keys = []) => {
  const externalIds = getExternalIds(game)
  const out = []
  const coerce = (val) => {
    if (Array.isArray(val)) return val
    const s = String(val ?? '').trim()
    if (!s) return []
    if (s.startsWith('[')) { try { const p = JSON.parse(s); if (Array.isArray(p)) return p } catch { /* csv */ } }
    return s.includes(',') ? s.split(',') : [s]
  }
  for (const key of keys) {
    for (const v of coerce(externalIds[key])) {
      if (hasValue(v)) out.push(v)
    }
  }
  return out
}

const getSteamIdValues = (game = {}) => [
  ...collectValues(game, ['steam_id', 'steamId', 'steam_appid', 'steamAppId']),
  ...getExternalValues(game, ['steam_id', 'steamId', 'steam_appid', 'steamAppId']),
  ...getExternalArrayValues(game, ['steam_appids', 'steam_ids']),
]

const getGogIdValues = (game = {}) => [
  ...collectValues(game, ['gog_id', 'gogId', 'gog_appid', 'gogAppId']),
  ...getExternalValues(game, ['gog_id', 'gogId', 'gog_appid', 'gogAppId']),
  ...getExternalArrayValues(game, ['gog_ids', 'gog_appids']),
]

const getLewdCornerIdValues = (game = {}) => [
  ...collectValues(game, ['lc_id', 'lcId', 'lewdcornerId', 'lewdCornerId', 'lewdcorner_id']),
  ...getExternalValues(game, ['lc_id', 'lcId', 'lewdcornerId', 'lewdCornerId', 'lewdcorner_id']),
]

const hasSteamMapping = (game = {}) =>
  getSteamIdValues(game).some((value) => /^\d+$/.test(cleanIdText(value))) ||
  getUrlValues(game).some((url) => urlMatchesSource(url, 'steam'))

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

// field id -> the values on a game object that field covers. The SQL columns for
// the same field ids live in src/utils/searchFields.js; these are the renderer's
// equivalent for game objects, which carry both snake_case and camelCase spellings
// of most things depending on which query produced them.
const SEARCH_FIELD_VALUE_GETTERS = {
  title: (game) => [getGameTitle(game), game.short_name, game.shortName],
  creator: (game) => [game.creator],
  id: (game) => [
    ...getAtlasIdValues(game),
    ...getF95IdValues(game),
    ...getLewdCornerIdValues(game),
    ...getSteamIdValues(game),
    ...getGogIdValues(game),
  ],
  atlasId: getAtlasIdValues,
  f95Id: getF95IdValues,
  lcId: getLewdCornerIdValues,
  steamId: getSteamIdValues,
  gogId: getGogIdValues,
  tags: getGameTagValues,
  engine: (game) => [game.engine],
  status: (game) => [game.status],
  category: (game) => [game.category],
  language: (game) => [game.language],
  url: getUrlValues,
}

// Cleaned, non-empty values for the selected fields only.
const getSearchHaystack = (game = {}, fieldIds = []) => {
  const out = []
  for (const fieldId of fieldIds) {
    const getter = SEARCH_FIELD_VALUE_GETTERS[fieldId]
    if (!getter) continue
    for (const value of getter(game) || []) {
      const cleaned = cleanSearchText(value)
      if (cleaned) out.push(cleaned)
    }
  }
  return out
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

// A leading `prefix:` overrides the selected fields for that one query. `url:`
// is the odd one out and always has been: it filters to a SOURCE rather than
// searching a url column, so it returns urlSource and leaves the fields alone.
export const parseSearchQuery = (text, fields) => {
  const raw = String(text || '').trim()
  // A prefix may contain digits — `f95:` is the obvious one, and it never worked
  // because this pattern was /^([a-z]+):/ , which cannot match the "95". That bug
  // was present in all three search paths.
  const match = raw.match(/^([a-z][a-z0-9]*):\s*(.+)$/i)
  if (!match) return { fields, query: raw, urlSource: null }
  const prefix = match[1].toLowerCase()
  const query = match[2].trim()
  if (prefix === 'url') return { fields, query, urlSource: normalizeSourceType(query) }
  const prefixFields = SEARCH_PREFIX_FIELDS[prefix]
  if (prefixFields) return { fields: prefixFields, query, urlSource: null }
  // Not a recognised prefix — treat the whole thing as literal text, so a title
  // containing a colon ("Ep 2: Reunion") still searches for itself.
  return { fields, query: raw, urlSource: null }
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

const compareBrowseDate = (a, b, dateBasis, direction = 'desc') => {
  const result = compareMaybeNumber(
    getBrowseDate(a, dateBasis),
    getBrowseDate(b, dateBasis),
    direction
  )
  return result || compareBrowseTitle(a, b, 'asc')
}

const compareBrowseReleaseDate = (a, b, direction = 'desc') => {
  const result = compareMaybeNumber(getReleaseDateValue(a), getReleaseDateValue(b), direction)
  return result || compareBrowseTitle(a, b, 'asc')
}

const compareBrowseF95LatestOrder = (a, b, direction = 'desc') => {
  const result = compareMaybeNumber(getF95LatestOrder(a), getF95LatestOrder(b), direction)
  return result || compareBrowseTitle(a, b, 'asc')
}

export const filterGamesWithState = (games, filters = {}, options = {}) => {
  const activeFilters = normalizeFilterState(filters)
  const browseMode = options.browseMode === true
  let result = [...(Array.isArray(games) ? games : [])]

  if (activeFilters.text) {
    const { fields, query, urlSource } = parseSearchQuery(activeFilters.text, resolveSearchFieldIds(activeFilters))
    const terms = parseTextTerms(query)
    result = result.filter((game) => {
      if (urlSource && urlSource !== 'all') {
        return getGameSources(game).includes(urlSource)
      }
      // One haystack built from just the selected fields. Both the positive and
      // the negative terms are matched against it, so `-ntr` excludes on the
      // fields you are actually searching — previously negatives always checked
      // a fixed blob regardless of the search type, which meant `title:` plus a
      // negative term silently consulted tags too.
      // An ARRAY of per-field strings rather than one concatenated blob. Not a
      // bug fix — terms are whitespace-split, so no single term could ever span
      // the old blob's join — but it makes "OR across the selected fields" the
      // literal structure of the code instead of an emergent property of string
      // concatenation, and it stays correct if quoted phrase search is ever
      // added (at which point the blob WOULD match across boundaries).
      const haystack = getSearchHaystack(game, fields)
      const matches = (term) => haystack.some((value) => value.includes(term))
      if (terms.negative.some((term) => term && matches(term))) return false
      if (terms.positive.length === 0) return true
      // AND across terms, OR across fields — unchanged from before.
      return terms.positive.every(matches)
    })
  }

  if (activeFilters.updateAvailable) {
    result = result.filter((game) => game.isUpdateAvailable === true)
  }

  if (activeFilters.favoritesOnly) {
    result = result.filter((game) => game.isFavorite === true || game.is_favorite === 1)
  }

  // Collection membership. The lookup is passed in (options.collectionIdsByRecord,
  // a Map of record_id -> [collectionId]) rather than joined onto each game row:
  // getGames already carries a GROUP_CONCAT over tags under a GROUP BY, so a
  // second one-to-many join there would corrupt the tag list.
  if (activeFilters.collectionIds.length > 0) {
    const wanted = new Set(activeFilters.collectionIds.map(String))
    const includeUncategorized = wanted.has('uncategorized')
    const lookup = options.collectionIdsByRecord
    result = result.filter((game) => {
      const ids = lookup?.get(Number(game.record_id)) || []
      if (ids.length === 0) return includeUncategorized
      return ids.some((id) => wanted.has(String(id)))
    })
  }

  if (activeFilters.personalRatingStatus !== 'any') {
    result = result.filter((game) => {
      const rating = getPersonalRatingOverall(game)
      if (activeFilters.personalRatingStatus === 'unrated') return rating === null
      if (rating === null) return false
      const v = activeFilters.personalRatingMin
      const op = activeFilters.personalRatingOp
      if (op === 'lt') return rating < v
      if (op === 'gt') return rating > v
      if (op === 'eq') return rating === v
      return rating >= v
    })
  }

  if (activeFilters.communityRatingMin > 0) {
    result = result.filter((game) => {
      // Higher of the F95 and LewdCorner ratings, matching the server-side
      // catalog filter (see communityRatingMin in getCatalogGames).
      const f95 = getNullableNumber(game.rating)
      const lc = getNullableNumber(game.lewdcornerRating)
      const rating = Math.max(f95 ?? 0, lc ?? 0)
      return rating > 0 && rating >= activeFilters.communityRatingMin
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

  if (activeFilters.playstates.length > 0) {
    result = result.filter((game) => {
      const ps = game.effectivePlaystate || effectiveTitlePlaystate(game.playstate, game.versions || [])
      return ps ? activeFilters.playstates.includes(ps) : false
    })
  }
  if (activeFilters.excludedPlaystates.length > 0) {
    result = result.filter((game) => {
      const ps = game.effectivePlaystate || effectiveTitlePlaystate(game.playstate, game.versions || [])
      // Match excludedStatuses semantics: only remove games that positively
      // match an excluded state; unset/derived-null games are kept.
      return ps ? !includesExact(activeFilters.excludedPlaystates, ps) : true
    })
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

  if (browseMode && activeFilters.dateField === 'none' && activeFilters.browseDateRange !== 'any') {
    const bounds = getBrowseDateRangeBounds(activeFilters.browseDateRange)
    if (bounds !== null) {
      result = result.filter((game) => {
        const browseDate = getBrowseDate(game, activeFilters.browseDateBasis)
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
      if (activeFilters.browseSort === 'titleDesc') {
        return compareBrowseTitle(a, b, 'desc')
      }
      if (activeFilters.browseSort === 'threadUpdatedDesc') {
        return compareBrowseDate(a, b, 'thread_updated', 'desc')
      }
      if (activeFilters.browseSort === 'threadUpdatedAsc') {
        return compareBrowseDate(a, b, 'thread_updated', 'asc')
      }
      if (activeFilters.browseSort === 'threadPublishedDesc') {
        return compareBrowseDate(a, b, 'thread_publish_date', 'desc')
      }
      if (activeFilters.browseSort === 'threadPublishedAsc') {
        return compareBrowseDate(a, b, 'thread_publish_date', 'asc')
      }
      if (activeFilters.browseSort === 'releaseDateDesc') {
        return compareBrowseReleaseDate(a, b, 'desc')
      }
      if (activeFilters.browseSort === 'releaseDateAsc') {
        return compareBrowseReleaseDate(a, b, 'asc')
      }
      if (activeFilters.browseSort === 'f95LatestOrderDesc') {
        return compareBrowseF95LatestOrder(a, b, 'desc')
      }
      if (activeFilters.browseSort === 'f95LatestOrderAsc') {
        return compareBrowseF95LatestOrder(a, b, 'asc')
      }
      return compareBrowseTitle(a, b, 'asc')
    }
    return compareLocalGames(a, b, activeFilters)
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
    id: 'builtin-favorites',
    name: 'Favorites',
    builtIn: true,
    filters: normalizeFilterState({ favoritesOnly: true, includeUninstalled: true, installState: 'all' }),
  },
  {
    id: 'builtin-wishlist',
    name: 'Wishlist',
    builtIn: true,
    filters: normalizeFilterState({
      wishlistOnly: true,
      includeUninstalled: true,
      installState: 'all',
    }),
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
    id: 'builtin-f95-rating',
    name: 'F95 Rating',
    builtIn: true,
    // Community rating (F95Zone/LewdCorner, 0-5) — unlike "Highly rated"
    // above (your own personal rating, which only exists for entries
    // you've played), this works across the whole catalog regardless of
    // install status.
    filters: normalizeFilterState({
      communityRatingMin: 4,
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

// `filterOptions` carries lookups that can't live on the game rows themselves —
// currently just collectionIdsByRecord (see filterGamesWithState).
export function useFilters(games, includeUninstalledRef, fetchGames, setSelectedGame, filterOptions = {}) {
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
    const nextIncludeUninstalled =
      nextFilters.includeUninstalled === true ||
      ['all', 'uninstalled'].includes(nextFilters.installState)
    const prev = includeUninstalledRef.current
    includeUninstalledRef.current = nextIncludeUninstalled
    setActiveFilters(nextFilters)
    if (prev !== nextIncludeUninstalled) {
      fetchGames(nextIncludeUninstalled).then(() => {
        if (!nextIncludeUninstalled) {
          setSelectedGame((current) =>
            current?.hasInstalledVersion === false ? null : current
          )
        }
      })
    }
  }, [includeUninstalledRef, fetchGames, setSelectedGame])

  const collectionIdsByRecord = filterOptions?.collectionIdsByRecord
  const filteredGames = useMemo(() => {
    return filterGamesWithState(games, activeFilters, { collectionIdsByRecord })
  }, [games, activeFilters, collectionIdsByRecord])

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
