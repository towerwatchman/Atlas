// Frontend mirror of the external-id link logic. Kept in the renderer so the
// Mappings tab and the game-details page can render links even when a game
// object predates the backend's media-source enrichment.

export const parseExternalIds = (raw) => {
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

const ensureScheme = (value) => {
  const v = String(value || '').trim()
  if (!v) return null
  if (/^https?:\/\//i.test(v)) return v
  if (v.includes('.')) return `https://${v}`
  return null
}

// key in external_ids → { label, url builder }. Steam is special-cased as a
// real mapping elsewhere, but it's included here so the details page can link
// to the store page too.
const LINK_DEFS = {
  steam_appid: { label: 'Steam', url: (v) => `https://store.steampowered.com/app/${v}` },
  steam_id: { label: 'Steam', url: (v) => `https://store.steampowered.com/app/${v}` },
  gog_id: { label: 'GOG', url: (v) => `https://www.gog.com/game/${v}` },
  gog_appid: { label: 'GOG', url: (v) => `https://www.gog.com/game/${v}` },
  lc_id: { label: 'LewdCorner', url: (v) => `https://lewdcorner.com/threads/${v}/` },
  lewdcorner_id: { label: 'LewdCorner', url: (v) => `https://lewdcorner.com/threads/${v}/` },
  lewdcorner_url: { label: 'LewdCorner', url: (v) => ensureScheme(v) },
  patreon: { label: 'Patreon', url: (v) => ensureScheme(v) || `https://www.patreon.com/${v}` },
  twitter: { label: 'Twitter / X', url: (v) => ensureScheme(v) || `https://twitter.com/${v}` },
  subscribestar: { label: 'SubscribeStar', url: (v) => ensureScheme(v) || `https://subscribestar.adult/${v}` },
  itch_url: { label: 'itch.io', url: (v) => ensureScheme(v) },
  itch: { label: 'itch.io', url: (v) => ensureScheme(v) },
  discord: { label: 'Discord', url: (v) => ensureScheme(v) || `https://discord.gg/${v}` },
  website: { label: 'Website', url: (v) => ensureScheme(v) },
  url: { label: 'Website', url: (v) => ensureScheme(v) },
}

const ICONS = {
  steam_appid: 'fab fa-steam',
  steam_id: 'fab fa-steam',
  gog_id: 'fab fa-gg',
  gog_appid: 'fab fa-gg',
  lc_id: 'fas fa-link',
  lewdcorner_id: 'fas fa-link',
  lewdcorner_url: 'fas fa-link',
  patreon: 'fab fa-patreon',
  twitter: 'fab fa-x-twitter',
  subscribestar: 'fas fa-star',
  itch_url: 'fab fa-itch-io',
  itch: 'fab fa-itch-io',
  discord: 'fab fa-discord',
  website: 'fas fa-globe',
  url: 'fas fa-globe',
}

const prettifyKey = (key) =>
  String(key || '')
    .replace(/_(url|id|appid)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || key

// Returns ordered [{ key, label, value, url, icon }]. `url` may be null when no
// sensible link can be derived (caller can still show the raw value).
export const buildExternalLinks = (rawExternalIds) => {
  const ext = parseExternalIds(rawExternalIds)
  const links = []
  for (const [key, rawValue] of Object.entries(ext)) {
    const value = String(rawValue ?? '').trim()
    if (!value) continue
    const lower = key.toLowerCase()
    const def = LINK_DEFS[lower]
    links.push({
      key,
      label: def ? def.label : prettifyKey(key),
      value,
      url: def ? def.url(value) : ensureScheme(value),
      icon: ICONS[lower] || 'fas fa-link',
    })
  }
  return links
}
