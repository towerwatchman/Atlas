import { getGameTitle } from '../../../utils/gameDisplay.js'

const visibleText = (value) => (value === undefined || value === null ? '' : String(value))

const firstValue = (...values) => values.find((value) => value !== undefined && value !== null && value !== '')

const sourceIdValues = (game = {}) => ({
  atlas: firstValue(game.atlas_id, game.atlasId),
  f95: firstValue(game.f95_id, game.f95Id),
  steam: firstValue(game.steam_id, game.steamId, game.steam_appid, game.steamAppId),
  lewdcorner: firstValue(game.lc_id, game.lcId, game.lewdcorner_id, game.lewdCornerId),
})

export const getNewestVersion = (game = {}) => {
  const versions = Array.isArray(game.versions) ? game.versions : []
  const installedVersions = versions.filter((version) => version?.isInstalled !== false)
  const catalogVersion = game.latestVersion || game.latest_version || game.version

  if (installedVersions.length === 0) {
    return catalogVersion || 'Missing'
  }

  // If the user has an explicitly selected version (persisted as
  // games.selected_version_id, set from the game detail page), the card should
  // reflect THAT version rather than the newest — as long as it's still
  // installed. This keeps the library card in sync with the last selection.
  const selectedId = Number(game.selected_version_id)
  if (Number.isInteger(selectedId) && selectedId > 0) {
    const selected = installedVersions.find(
      (version) => Number(version?.version_id) === selectedId,
    )
    if (selected?.version) return selected.version
  }

  let maxVersion = installedVersions[0]?.version
  let maxValue = 0

  for (const version of installedVersions) {
    const versionText = String(version?.version || '')
    const current = parseInt(versionText.replace(/[^0-9]/g, ''), 10) || 0
    if (current > maxValue) {
      maxValue = current
      maxVersion = version.version
    }
  }

  // Some sources (e.g. Steam) never record a real per-build version locally —
  // the installed "version" is just a generic placeholder label (literally
  // "Steam"), not an actual numbered release. When none of the installed
  // entries carried a numeric version, prefer the richer catalog/atlas
  // version data if it's available rather than showing that placeholder,
  // matching what Browse mode already shows for the same title.
  if (maxValue === 0 && catalogVersion) return catalogVersion

  return maxVersion || catalogVersion || 'V 1.0'
}

const formatRating = (value) => {
  if (value === undefined || value === null || value === '') return ''
  // Ratings arrive in several shapes: a clean number ("4.5"), F95's
  // "4.50 star(s)", "4,5", or "4.5/5". Number() on the whole string fails on any
  // non-numeric suffix (which hid F95 ratings entirely), so pull the first
  // number out instead.
  const match = String(value).replace(',', '.').match(/\d+(?:\.\d+)?/)
  if (!match) return ''
  const rating = Number(match[0])
  if (!Number.isFinite(rating) || rating <= 0) return ''
  return rating <= 5 ? `${rating.toFixed(1)}/5` : `${rating.toFixed(1)}/10`
}

const formatPlaytime = (value) => {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

// Counts (likes/views/downloads/comments) may arrive already-formatted from a
// scraper (e.g. "2.5M") or as a raw number; pass strings through, compact numbers.
const formatCount = (value) => {
  if (value === undefined || value === null || value === '') return ''
  const str = String(value).trim()
  if (str === '') return ''
  const num = Number(str.replace(/,/g, ''))
  if (!Number.isFinite(num)) return str
  if (num >= 1000000) return `${(num / 1000000).toFixed(1).replace(/\.0$/, '')}M`
  if (num >= 1000) return `${(num / 1000).toFixed(1).replace(/\.0$/, '')}K`
  return String(num)
}

const normalizePlatforms = (value) => {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(/[,;/|]/).map((v) => v.trim()).filter(Boolean)
  return []
}

// Compact "time since" showing only the largest whole unit (min -> hour -> day
// -> year), floored: 1.3 hours renders as "1h". Accepts unix seconds, ms, or a
// parseable date string.
const formatSinceNow = (value) => {
  if (value === undefined || value === null || value === '') return ''
  let ts = Number(value)
  if (!Number.isFinite(ts)) {
    const parsed = Date.parse(value)
    if (Number.isNaN(parsed)) return ''
    ts = parsed
  }
  if (ts > 0 && ts < 1e12) ts *= 1000 // seconds -> ms
  const diffMs = Date.now() - ts
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return '0m'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 365) return `${days}d`
  return `${Math.floor(days / 365)}y`
}

const formatDate = (value) => {
  if (value === undefined || value === null || value === '') return ''
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric <= 0) return ''
  const date = Number.isFinite(numeric) && numeric > 0
    ? new Date(numeric < 10000000000 ? numeric * 1000 : numeric)
    : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const splitCommaList = (value) => {
  const arr = Array.isArray(value) ? value : String(value || '').split(/[,|;]/)
  return arr.map((v) => String(v).trim()).filter(Boolean)
}

const compactTags = (value) => {
  const tags = Array.isArray(value)
    ? value
    : String(value || '').split(/[,|;]/)
  const cleanTags = tags.map((tag) => String(tag).trim()).filter(Boolean)
  if (cleanTags.length === 0) return ''
  const shown = cleanTags.slice(0, 3)
  const extra = cleanTags.length - shown.length
  return extra > 0 ? `${shown.join(', ')} +${extra}` : shown.join(', ')
}

const installedVersionCount = (game = {}) => {
  const versions = Array.isArray(game.versions) ? game.versions : []
  const count = versions.filter((version) => version?.isInstalled !== false).length
  return count || Number(game.installedVersionCount || game.versionCount || 0)
}

const getAvailableSources = (game = {}) => {
  const ids = sourceIdValues(game)
  return Object.entries(ids)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([source]) => source)
}

const sourceLabels = {
  atlas: 'Atlas',
  f95: 'F95',
  steam: 'Steam',
  lewdcorner: 'LC',
}

const primarySource = (game = {}) => {
  const explicit = String(game.primarySource || game.source || game.sourceKey || '').toLowerCase()
  if (explicit.includes('steam')) return 'Steam'
  if (explicit.includes('lewd') || explicit === 'lc') return 'LewdCorner'
  if (explicit.includes('f95')) return 'F95'
  const sources = getAvailableSources(game)
  if (sources.includes('steam')) return 'Steam'
  if (sources.includes('lewdcorner')) return 'LewdCorner'
  if (sources.includes('f95')) return 'F95'
  return sources.includes('atlas') ? 'Atlas' : ''
}

export const getBannerFieldSources = getAvailableSources

export const resolveBannerField = (fieldId, game = {}) => {
  const ids = sourceIdValues(game)
  switch (fieldId) {
    case 'title':
      return { value: getGameTitle(game), visible: true }
    case 'creator': {
      const ownCreator = String(game.creator || '').trim()
      if (ownCreator && ownCreator.toLowerCase() !== 'unknown') {
        return { value: ownCreator, visible: true }
      }
      // The local "games" row's own creator column is set once at scan/
      // import time and, for sources like Steam where metadata isn't cached
      // yet, defaults to the literal placeholder "Unknown" — it's never
      // refreshed afterward even once richer metadata is fetched. That
      // richer data (publisher / developer) is already joined into this
      // same row though, so prefer it before falling back to "Unknown".
      const fallback = firstValue(game.publisher, game.steam_developer, game.gog_developer, game.developer)
      return { value: fallback || ownCreator || 'Unknown', visible: true }
    }
    case 'engine':
      return { value: game.engine || 'Unknown', visible: true }
    case 'status':
      return { value: visibleText(game.status), visible: Boolean(game.status) }
    case 'version':
      return { value: getNewestVersion(game), visible: true }
    case 'latestVersion':
      return { value: visibleText(game.latestVersion || game.latest_version || game.version), visible: Boolean(game.latestVersion || game.latest_version || game.version) }
    case 'update':
      return { value: 'Update Available!', visible: game.isUpdateAvailable === true, variant: 'warning' }
    case 'favorite':
      return { value: 'Favorite', visible: game.isFavorite === true, variant: 'favorite' }
    case 'wishlist':
      return {
        value: 'Wishlist',
        visible: game.isWishlisted === true || game.isWishlistEntry === true,
        variant: 'wishlist',
      }
    case 'installedState':
      return { value: game.hasInstalledVersion === false ? 'Uninstalled' : 'Installed', visible: true, variant: game.hasInstalledVersion === false ? 'warning' : 'success' }
    case 'sourceBadges': {
      const badges = getAvailableSources(game).map((source) => ({ label: sourceLabels[source], variant: 'source' }))
      return { value: badges, visible: badges.length > 0, variant: 'source' }
    }
    case 'primarySource':
      return { value: primarySource(game), visible: Boolean(primarySource(game)), variant: 'source' }
    case 'atlasId':
      return { value: ids.atlas ? `Atlas ${ids.atlas}` : '', visible: Boolean(ids.atlas), variant: 'source' }
    case 'f95Id':
      return { value: ids.f95 ? `F95 ${ids.f95}` : '', visible: Boolean(ids.f95), variant: 'source' }
    case 'steamId':
      return { value: ids.steam ? `Steam ${ids.steam}` : '', visible: Boolean(ids.steam), variant: 'source' }
    case 'lewdCornerId':
      return { value: ids.lewdcorner ? `LC ${ids.lewdcorner}` : '', visible: Boolean(ids.lewdcorner), variant: 'source' }
    case 'sourceRating': {
      const value = formatRating(firstValue(game.sourceRating, game.rating, game.lewdcornerRating, game.score, game.f95Rating, game.steamRating))
      return { value, visible: Boolean(value), variant: 'neutral', icon: 'fas fa-star' }
    }
    case 'personalRating': {
      const value = formatRating(firstValue(game.personalRatingOverall, game.personal_rating_overall, game.personalRating))
      return { value, visible: Boolean(value), variant: 'favorite', icon: 'fas fa-star' }
    }
    case 'playtime': {
      const value = formatPlaytime(firstValue(game.totalPlaytime, game.total_playtime, game.playtime))
      return { value, visible: Boolean(value), variant: 'neutral', icon: 'fas fa-clock' }
    }
    case 'lastPlayed': {
      const value = formatDate(firstValue(game.lastPlayed, game.last_played_r, game.last_played))
      return { value, visible: Boolean(value), variant: 'neutral', icon: 'fas fa-calendar' }
    }
    case 'installedVersionCount': {
      const count = installedVersionCount(game)
      return { value: count ? `${count} installed` : '', visible: Boolean(count), variant: 'success' }
    }
    case 'category':
      return { value: visibleText(game.category), visible: Boolean(game.category), variant: 'neutral' }
    case 'tags': {
      const list = splitCommaList(firstValue(game.tags, game.f95_tags)).slice(0, 4)
      return { value: list.map((label) => ({ label })), visible: list.length > 0, variant: 'neutral' }
    }
    case 'censored':
      return { value: visibleText(game.censored), visible: Boolean(game.censored), variant: 'neutral' }
    case 'language':
      return { value: visibleText(game.language), visible: Boolean(game.language), variant: 'neutral' }
    case 'likes': {
      const value = formatCount(firstValue(game.likes, game.f95_likes, game.lc_likes))
      return { value, visible: Boolean(value), variant: 'neutral', icon: 'fas fa-thumbs-up' }
    }
    case 'views': {
      const value = formatCount(firstValue(game.views, game.f95_views, game.lc_views))
      return { value, visible: Boolean(value), variant: 'neutral', icon: 'fas fa-eye' }
    }
    case 'downloads': {
      const value = formatCount(firstValue(game.downloads, game.f95_downloads, game.lc_downloads))
      return { value, visible: Boolean(value), variant: 'neutral', icon: 'fas fa-download' }
    }
    case 'comments': {
      const value = formatCount(firstValue(game.comments, game.commentCount, game.comment_count))
      return { value, visible: Boolean(value), variant: 'neutral', icon: 'fas fa-comment' }
    }
    case 'platforms': {
      const list = normalizePlatforms(firstValue(game.platforms, game.os, game.operatingSystems)).slice(0, 4)
      return { value: list.map((label) => ({ label })), visible: list.length > 0, variant: 'source' }
    }
    case 'lastUpdated': {
      const value = formatSinceNow(
        firstValue(game.threadUpdated, game.thread_updated, game.f95ThreadUpdated, game.lewdcornerThreadUpdated),
      )
      return { value, visible: Boolean(value), variant: 'neutral', icon: 'fas fa-clock-rotate-left' }
    }
    default:
      return { value: '', visible: false }
  }
}

