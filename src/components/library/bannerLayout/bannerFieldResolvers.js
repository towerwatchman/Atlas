import { getGameTitle } from '../../../utils/gameDisplay.js'

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

  return maxVersion || catalogVersion || 'V 1.0'
}

const visibleText = (value) => (value === undefined || value === null ? '' : String(value))

export const resolveBannerField = (fieldId, game = {}) => {
  switch (fieldId) {
    case 'title':
      return { value: getGameTitle(game), visible: true }
    case 'creator':
      return { value: game.creator || 'Unknown', visible: true }
    case 'engine':
      return { value: game.engine || 'Unknown', visible: true }
    case 'status':
      return { value: visibleText(game.status), visible: Boolean(game.status) }
    case 'version':
      return { value: getNewestVersion(game), visible: true }
    case 'update':
      return { value: 'Update Available!', visible: game.isUpdateAvailable === true }
    case 'favorite':
      return { value: 'Favorite', visible: game.isFavorite === true }
    case 'wishlist':
      return {
        value: 'Wishlist',
        visible: game.isWishlisted === true || game.isWishlistEntry === true,
      }
    case 'installedState':
      return { value: 'Uninstalled', visible: game.hasInstalledVersion === false }
    default:
      return { value: '', visible: false }
  }
}

