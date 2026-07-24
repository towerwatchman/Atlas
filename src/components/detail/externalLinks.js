// Frontend mirror of the external-id link logic. Kept in the renderer so the
// Mappings tab and the game-details page can render links even when a game
// object predates the backend's media-source enrichment.

import gogLogo from '../../assets/icons/gog_logo.svg'

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

// Sources whose icon is a bundled image asset rather than a Font Awesome glyph.
// When a key is present here, links carry `iconImage` and consumers render an
// <img> instead of an <i className={icon}>.
const IMAGE_ICONS = {
  gog_id: gogLogo,
  gog_appid: gogLogo,
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
  const seenUrls = new Set()
  const pushLink = (key, rawValue) => {
    const value = String(rawValue ?? '').trim()
    if (!value) return
    const lower = key.toLowerCase()
    const def = LINK_DEFS[lower]
    const url = def ? def.url(value) : ensureScheme(value)
    // De-dupe by resolved url so the array form and any scalar form of the same
    // id don't render twice.
    if (url && seenUrls.has(url)) return
    if (url) seenUrls.add(url)
    links.push({
      key,
      label: def ? def.label : prettifyKey(key),
      value,
      url,
      icon: ICONS[lower] || 'fas fa-link',
      iconImage: IMAGE_ICONS[lower] || null,
    })
  }
  // Array id fields (multiple Steam/GOG appids under one atlas, from admin
  // manual links) map each element to the corresponding scalar link def so we
  // emit one link per id rather than a single mangled "1,2,3" link.
  const ARRAY_KEY_TO_SCALAR = {
    steam_appids: 'steam_appid',
    gog_ids: 'gog_id',
    itch: 'itch',
    custom: 'url',
  }
  // Coerce a value that is meant to be a list into an array: real array,
  // JSON-string array (e.g. '["1","2"]'), or comma-separated string.
  const coerceList = (val) => {
    if (Array.isArray(val)) return val
    const s = String(val ?? '').trim()
    if (!s) return []
    if (s.startsWith('[')) {
      try {
        const parsed = JSON.parse(s)
        if (Array.isArray(parsed)) return parsed
      } catch { /* fall through to CSV */ }
    }
    if (s.includes(',')) return s.split(',')
    return [s]
  }
  for (const [key, rawValue] of Object.entries(ext)) {
    const lower = key.toLowerCase()
    if (lower in ARRAY_KEY_TO_SCALAR) {
      const scalarKey = ARRAY_KEY_TO_SCALAR[lower]
      for (const item of coerceList(rawValue)) pushLink(scalarKey, item)
      continue
    }
    if (Array.isArray(rawValue)) {
      for (const item of rawValue) pushLink(lower, item)
      continue
    }
    pushLink(key, rawValue)
  }
  return links
}
