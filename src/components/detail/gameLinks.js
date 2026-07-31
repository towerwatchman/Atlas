// Single source of truth for "every external link this game has".
//
// This used to live inside GameDetailPage as buildDetailExternalLinks. It moved
// here so the game context menu's Links submenu shows exactly the same set — two
// builders would drift, and a menu that lists different links from the page it
// opens is worse than either list on its own.
//
// Returns ordered [{ key, label, value, url, icon, iconImage? }]. `url` may be
// null when no sensible link can be derived from the stored value — the details
// page still renders those as plain non-clickable text, which is why they are not
// filtered out here. Callers that need somewhere to navigate should use
// `linkableGameLinks` instead.

import { buildExternalLinks } from './externalLinks.js'
import { getMappedSteamAppId, getMappedGogId } from './page/gameDetailUtils.js'
import gogLogo from '../../assets/icons/gog_logo.svg'

export const isValidHttpUrl = (url) => /^https?:\/\//i.test(String(url || '').trim())

// Store pages, deliberately — NOT the signed-in user's library pages. A title can
// be in the library without being owned (manual add, wishlist, catalog browse),
// so an account-scoped URL like gog.com/account/gameDetails/{id} would 404 for
// exactly the games most likely to need the link.
// No trailing slash: this must be byte-identical to the form LINK_DEFS builds in
// externalLinks.js, or a mapped id and the same id in external_ids dedupe as two
// different URLs and the game gets two Steam rows.
export const steamStoreUrl = (appId) => `https://store.steampowered.com/app/${appId}`
// GOG does not resolve /game/{numericId} — only the slug works — so the real
// store_url captured by the scraper is preferred and the id form is a last
// resort.
export const gogStoreUrl = (game = {}, gogId = '') => {
  const stored = String(game.gog_store_url || game.gogStoreUrl || '').trim()
  if (isValidHttpUrl(stored)) return stored
  return gogId ? `https://www.gog.com/game/${gogId}` : ''
}

// F95/LewdCorner links display just the numeric thread id (the way Steam and GOG
// show their ids) while the click target stays the full thread URL.
const threadIdFromUrl = (value) => {
  const normalized = String(value ?? '').trim()
  if (!normalized) return ''
  if (/^\d+$/.test(normalized)) return normalized
  const m = normalized.match(/\/threads\/(?:[^/\s.]+\.)?(\d+)(?:[/?#]|$)/i)
  return m ? m[1] : ''
}

export const buildGameLinks = (game = {}) => {
  const links = []
  const seen = new Set()
  const push = (link) => {
    if (!link) return
    if (link.url) {
      // A value that didn't resolve to a real http(s) URL is kept, but with url
      // cleared so no caller tries to open it.
      if (!isValidHttpUrl(link.url)) {
        links.push({ ...link, url: null })
        return
      }
      if (seen.has(link.url)) return
      seen.add(link.url)
    }
    links.push(link)
  }

  const siteUrl = String(game.siteUrl || game.site_url || '').trim()
  if (isValidHttpUrl(siteUrl)) {
    const isLc = siteUrl.includes('lewdcorner.com')
    const displayId = threadIdFromUrl(
      isLc ? (game.lc_id || game.lcId || siteUrl) : (game.f95_id || siteUrl),
    )
    push({
      key: 'f95_thread',
      label: isLc ? 'LewdCorner' : 'F95 Thread',
      value: displayId || siteUrl,
      url: siteUrl,
      icon: 'fas fa-comments',
    })
  }

  const lewdCornerUrl = String(game.lewdCornerSiteUrl || game.lewdcornerSiteUrl || '').trim()
  if (isValidHttpUrl(lewdCornerUrl)) {
    const displayId = threadIdFromUrl(game.lc_id || game.lcId || lewdCornerUrl)
    push({
      key: 'lewdcorner',
      label: 'LewdCorner',
      value: displayId || lewdCornerUrl,
      url: lewdCornerUrl,
      icon: 'fas fa-link',
    })
  }

  // A Steam- or GOG-mapped game with no atlas record carries its id in
  // steam_mappings / gog_mappings rather than external_ids, so the store link has
  // to be injected explicitly or those titles show no store link at all.
  const steamAppId = getMappedSteamAppId(game)
  if (steamAppId) {
    push({
      key: 'steam_appid',
      label: 'Steam',
      value: String(steamAppId),
      url: steamStoreUrl(steamAppId),
      icon: 'fab fa-steam',
    })
  }

  const gogId = getMappedGogId(game)
  if (gogId) {
    push({
      key: 'gog_id',
      label: 'GOG',
      value: String(gogId),
      url: gogStoreUrl(game, gogId),
      icon: 'fab fa-gg',
      iconImage: gogLogo,
    })
  }

  // Everything else (patreon, itch, discord, website, extra Steam appids from
  // admin manual links, …). Exact-URL duplicates of the above are dropped by
  // `push`, so a mapping and its matching external id can't both render.
  for (const link of buildExternalLinks(game.external_ids)) push(link)
  // Manual (user-set) ids are a real source of links — MappingsTab already treats
  // them as such — so they belong in the same list rather than only in the
  // mappings table.
  for (const link of buildExternalLinks(game.manual_external_ids)) push(link)

  return links
}

// Only the entries that actually go somewhere. Used by the context menu, which
// has no way to render a row that isn't clickable.
export const linkableGameLinks = (game = {}) =>
  buildGameLinks(game).filter((link) => isValidHttpUrl(link.url))
