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
  const rating = Number(value)
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

const formatDate = (value) => {
  const numeric = Number(value)
  const date = Number.isFinite(numeric) && numeric > 0
    ? new Date(numeric < 10000000000 ? numeric * 1000 : numeric)
    : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
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
      const fallback = firstValue(game.publisher, game.steam_developer)
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
      const value = formatRating(firstValue(game.sourceRating, game.rating, game.score, game.f95Rating, game.steamRating))
      return { value, visible: Boolean(value), variant: 'neutral' }
    }
    case 'personalRating': {
      const value = formatRating(firstValue(game.personalRatingOverall, game.personal_rating_overall, game.personalRating))
      return { value, visible: Boolean(value), variant: 'favorite' }
    }
    case 'playtime': {
      const value = formatPlaytime(firstValue(game.totalPlaytime, game.total_playtime, game.playtime))
      return { value, visible: Boolean(value), variant: 'neutral' }
    }
    case 'lastPlayed': {
      const value = formatDate(firstValue(game.lastPlayed, game.last_played_r, game.last_played))
      return { value, visible: Boolean(value), variant: 'neutral' }
    }
    case 'installedVersionCount': {
      const count = installedVersionCount(game)
      return { value: count ? `${count} installed` : '', visible: Boolean(count), variant: 'success' }
    }
    case 'category':
      return { value: visibleText(game.category), visible: Boolean(game.category), variant: 'neutral' }
    case 'tags': {
      const value = compactTags(firstValue(game.tags, game.f95_tags))
      return { value, visible: Boolean(value), variant: 'neutral' }
    }
    case 'censored':
      return { value: visibleText(game.censored), visible: Boolean(game.censored), variant: 'neutral' }
    case 'language':
      return { value: visibleText(game.language), visible: Boolean(game.language), variant: 'neutral' }
    default:
      return { value: '', visible: false }
  }
}

