'use strict'

// Centralized logic for the configurable "metadata sources" feature.
//
// A user can order the metadata sources (f95, steam, …) in Settings → Metadata.
// That order decides which source supplies the streamed banner image, and — for
// steam — which library_hero / logo images decorate the game-details page.
//
// This module is intentionally dependency-free so it can be required from both
// the db layer and the ipc layer without circular-require headaches.

// Default order used whenever the config is empty or malformed.
const DEFAULT_SOURCE_ORDER = ['f95', 'lewdcorner', 'steam']

// Steam serves the same per-app art from two different systems:
//
//   1. store_item_assets/steam/apps/{appid}/{HASH}/header_2x.jpg?t=...
//      Higher-res, but the {HASH} + ?t cache-buster only come from Steam's
//      store API — they CANNOT be built from the app id alone.
//   2. store_item_assets/steam/apps/{appid}/{file}
//      Stable, unhashed, buildable from just the app id. Slightly lower res.
//
// We build URLs from system (2) since the app id is all we're guaranteed to
// have. When a real Steam scan exists, the API-sourced header/library_hero URLs
// stored on steam_data are preferred because they may include the hashed,
// higher-res variants.
const STEAM_LIBRARY_CDN = 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps'

const steamAsset = (appid, file) =>
  appid ? `${STEAM_LIBRARY_CDN}/${appid}/${file}` : null

const isResolvedSteamAssetUrl = (url) => {
  const value = String(url || '')
  return value && !/\$\{?FILENAME\}?|\$\{?filename\}?/i.test(value)
}

const resolvedSteamAsset = (url) => isResolvedSteamAssetUrl(url) ? url : null

// Resolve the three details-page images for an app, preferring any URLs already
// captured from the Steam store API on the game row.
const steamImages = (appid, game = {}) => ({
  // Wide store capsule — used as the library/grid banner. Prefer the API header
  // (steam_data.header) which is the exact image Steam serves, then fall back to
  // the unhashed library-CDN header.
  banner: resolvedSteamAsset(game && game.steam_header) || steamAsset(appid, 'header.jpg'),
  // Tall key-art behind the details-page header. Prefer the exact API URL.
  hero: resolvedSteamAsset(game && game.steam_library_hero) || steamAsset(appid, 'library_hero.jpg'),
  // Transparent title treatment shown bottom-left. steam_data.logo now holds the
  // genuine transparent logo (resolved via the keyless GetItems endpoint); fall
  // back to the buildable convention URL only if it's missing.
  logo: resolvedSteamAsset(game && game.steam_logo) || steamAsset(appid, 'logo.png'),
})

// external_ids is stored as a JSON object string, e.g.
//   {"patreon":"DrPinkCake","steam_appid":"1126320","twitter":"DrPinkCake"}
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

// The steam app id can come from a real steam_mapping (game.steam_id) or, when
// no mapping exists yet, from the external_ids blob.
const resolveSteamAppId = (game = {}, externalIds = null) => {
  const ext = externalIds || parseExternalIds(game.external_ids)
  const candidate =
    game.steam_id || game.steam_appid || ext.steam_appid || ext.steam_id || null
  if (candidate === null || candidate === undefined || candidate === '') return null
  return String(candidate)
}

// Accepts either a comma string ("f95,steam") or an array and returns a clean
// lowercase array, falling back to the default order.
const normalizeSourceOrder = (raw) => {
  let order = []
  if (Array.isArray(raw)) order = raw
  else if (typeof raw === 'string') order = raw.split(',')
  order = order.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean)
  return order.length ? order : [...DEFAULT_SOURCE_ORDER]
}

// De-duplicates a list of urls while preserving order.
const dedupe = (list) => {
  const seen = new Set()
  const out = []
  for (const url of list) {
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push(url)
  }
  return out
}

// Per-source banner candidates, in fallback order. For steam this is
// [unhashed CDN header, then the API/hashed shared.fastly header].
const bannerCandidatesForSource = (source, game, appid) => {
  if (source === 'steam') {
    // Exact API header (hashed, guaranteed) first; buildable convention second.
    return [resolvedSteamAsset(game.steam_header), steamAsset(appid, 'header.jpg')]
  }
  if (source === 'f95') {
    return [game.f95_banner]
  }
  if (source === 'lewdcorner') {
    return [game.lewdcorner_banner, game.lewdCornerBannerUrl]
  }
  if (source === 'atlas') {
    return [game.atlas_banner_wide, game.atlas_banner]
  }
  return []
}

// Walks the configured source order, concatenating each source's candidates so
// that if one source's image 404s the renderer can fall through to the next.
const bannerCandidatesForOrder = (game, order, appid) => {
  const out = []
  for (const source of order) out.push(...bannerCandidatesForSource(source, game, appid))
  return out
}

// Steam-only hero candidates: exact API library_hero first, convention second.
const steamHeroCandidates = (game, appid) => [
  resolvedSteamAsset(game.steam_library_hero),
  steamAsset(appid, 'library_hero.jpg'),
]

// Mutates `game` in place, attaching resolved media fields. Safe to call on any
// game row; it only pins custom/user banners. Downloaded source banners still
// participate in source ordering so Steam can beat a cached F95 banner.
//
// Produces ordered *candidate* lists so the renderer can fall back image-by-image:
//   game.banner_candidates / hero_candidates / logo_candidates
// game.banner_url / hero_url / logo_url remain set to the first candidate for
// any consumer that only wants a single url.
const applyMediaSources = (game, options = {}) => {
  if (!game) return game
  const order = normalizeSourceOrder(options.sourceOrder)
  const ext = parseExternalIds(game.external_ids)
  const appid = resolveSteamAppId(game, ext)
  const steamEnabled = order.includes('steam')

  game.steam_appid = appid

  // Banner: custom/user banners must win, but downloaded source banners still
  // follow metadata source order. Otherwise a cached F95 banner masks a higher
  // priority Steam header in the gallery grid.
  const bannerSource = game.banner_source
  const isCustomBanner = /banner_custom_/i.test(String(game.banner_url || ''))
  const isPinnedBanner = isCustomBanner && (bannerSource === 'download' || bannerSource === 'download-animated')
  let bannerCandidates
  if (!isPinnedBanner) {
    bannerCandidates = bannerCandidatesForOrder(game, order, appid)
    // Keep the SQL-resolved url as a final fallback (covers source banners or
    // local files not represented in the per-source candidate set).
    if (game.banner_url) bannerCandidates.push(game.banner_url)
  } else {
    bannerCandidates = game.banner_url ? [game.banner_url] : []
  }
  bannerCandidates = dedupe(bannerCandidates)
  game.banner_candidates = bannerCandidates
  if (bannerCandidates.length) game.banner_url = bannerCandidates[0]

  // Hero (details page): steam key-art first when enabled, then fall through to
  // the banner chain so it still honours the source order (e.g. ends on f95).
  const heroCandidates = dedupe([
    ...(steamEnabled && appid ? steamHeroCandidates(game, appid) : []),
    ...bannerCandidates,
  ])
  game.hero_candidates = heroCandidates
  game.hero_url = heroCandidates[0] || null

  // Logo (bottom-left, steam-only). Exact API transparent logo first, then the
  // buildable convention URL. No cross-source fallback — f95/atlas have no
  // equivalent; the renderer hides it and shows the title if it fails to load.
  //
  // Guard against legacy rows: older enrichment wrongly stored the portrait
  // capsule (library_600x900 / library_capsule) in the logo column. Reject any
  // capsule-shaped URL so a stale value falls through to the real logo.png
  // instead of rendering box art as the logo. Self-heals on next page load;
  // a Refresh Media rewrites the column permanently.
  const isCapsuleLike = (u) => /library_600x900|library_capsule/i.test(String(u || ''))
  const logoCandidates = steamEnabled && appid
    ? dedupe(
        [resolvedSteamAsset(game.steam_logo), steamAsset(appid, 'logo.png')]
          .filter(Boolean)
          .filter((u) => !isCapsuleLike(u)),
      )
    : []
  game.logo_candidates = logoCandidates
  game.logo_url = logoCandidates[0] || null

  return game
}

// ── External links (for the details page + mappings tab) ──────────────────────

const ensureScheme = (value) => {
  const v = String(value || '').trim()
  if (!v) return null
  if (/^https?:\/\//i.test(v)) return v
  if (v.includes('.')) return `https://${v}`
  return null
}

// Definition table: key in external_ids → display label + url builder. Designed
// to grow toward the ~10 planned sources; unknown keys fall through to a generic
// resolver below.
const EXTERNAL_LINK_DEFS = {
  steam_appid: { label: 'Steam', url: (v) => `https://store.steampowered.com/app/${v}` },
  steam_id: { label: 'Steam', url: (v) => `https://store.steampowered.com/app/${v}` },
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

const prettifyKey = (key) =>
  String(key || '')
    .replace(/_(url|id|appid)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || key

// Turns an external_ids object into an ordered list of
//   { key, label, value, url }
// entries. `url` is null when no sensible link can be built (the caller can
// still show the raw value as text).
const buildExternalLinks = (rawExternalIds) => {
  const ext = parseExternalIds(rawExternalIds)
  const links = []
  for (const [key, rawValue] of Object.entries(ext)) {
    const value = String(rawValue ?? '').trim()
    if (!value) continue
    const def = EXTERNAL_LINK_DEFS[key.toLowerCase()]
    const label = def ? def.label : prettifyKey(key)
    const url = def ? def.url(value) : ensureScheme(value)
    links.push({ key, label, value, url })
  }
  return links
}

// ── Preview ordering ──────────────────────────────────────────────────────────

const detectPreviewSource = (url) => {
  const u = String(url || '').toLowerCase()
  if (!/^https?:\/\//.test(u)) return null // local file path — leave in place
  if (u.includes('steamstatic') || u.includes('steamcdn') || u.includes('akamaihd') || u.includes('/steam/'))
    return 'steam'
  if (u.includes('f95zone') || u.includes('attachments'))
    return 'f95'
  if (u.includes('lewdcorner.com'))
    return 'lewdcorner'
  return 'atlas'
}

// Stable-reorders only the remote (http) entries of a preview list by source
// priority, preserving the position of any local file paths.
const orderPreviewsBySource = (urls, rawOrder) => {
  if (!Array.isArray(urls) || urls.length < 2) return urls || []
  const order = normalizeSourceOrder(rawOrder)
  const rankOf = (url) => {
    const src = detectPreviewSource(url)
    if (src === null) return null
    const idx = order.indexOf(src)
    return idx === -1 ? order.length : idx
  }

  const remoteSlots = []
  urls.forEach((url, i) => {
    if (rankOf(url) !== null) remoteSlots.push(i)
  })
  if (remoteSlots.length < 2) return urls

  const sortedRemote = remoteSlots
    .map((i) => ({ url: urls[i], rank: rankOf(urls[i]), i }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((entry) => entry.url)

  const result = [...urls]
  remoteSlots.forEach((slot, idx) => {
    result[slot] = sortedRemote[idx]
  })
  return result
}

module.exports = {
  DEFAULT_SOURCE_ORDER,
  parseExternalIds,
  resolveSteamAppId,
  normalizeSourceOrder,
  steamImages,
  applyMediaSources,
  buildExternalLinks,
  orderPreviewsBySource,
}
