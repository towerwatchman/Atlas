const cleanText = (value) => String(value ?? '').trim()

const cleanId = (value) => {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

const slug = (value) => cleanText(value).toLowerCase().replace(/\s+/g, ' ')

export const getWishlistIdentityKey = (game = {}) => {
  if (game.identity_key) return cleanText(game.identity_key)
  const atlasId = cleanId(game.atlas_id ?? game.atlasId)
  const lcId = cleanId(game.lc_id ?? game.lcId ?? game.lewdCornerId ?? game.lewdcornerId)
  const source = cleanText(game.source).toLowerCase() || 'atlas'
  if (source === 'lewdcorner' && atlasId) return `atlas:${atlasId}`
  const f95Id = cleanId(game.f95_id ?? game.f95Id)
  if (f95Id) return `f95:${f95Id}`
  if (lcId) return `lewdcorner:${lcId}`
  const steamId = cleanId(game.steam_id ?? game.steamId ?? game.steam_appid)
  if (steamId) return `steam:${steamId}`
  if (atlasId) return `atlas:${atlasId}`
  const title = cleanText(game.title || game.name || game.short_name || 'Untitled')
  const creator = cleanText(game.creator || game.developer || 'Unknown')
  return `${source}:title:${slug(title)}:${slug(creator)}`
}

export const withWishlistState = (game, identityKeys = new Set()) => ({
  ...game,
  isWishlisted: game?.isWishlistEntry === true || identityKeys.has(getWishlistIdentityKey(game)),
})

export const withWishlistStates = (games, identityKeys = new Set()) =>
  (Array.isArray(games) ? games : []).map((game) => withWishlistState(game, identityKeys))
