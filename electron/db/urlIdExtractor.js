'use strict'

// Mirror of src/utils/urlIdExtractor.js -- CJS for the main process, ESM for
// the renderer. The two cannot share a module, the same constraint
// electron/db/ratingCategories.js lives with. tests/url-id-extractor.test.js
// loads BOTH copies and runs the identical case table against each, so a change
// to one and not the other fails the suite.

// Extracts the numeric site ID from a pasted thread or store URL.
//
// URL search used to match against catalog_index.site_url, but that column is
// incomplete and inconsistent: Steam URLs were never indexed at all, LewdCorner
// stores a mix of slugged and bare forms, and F95Zone has the same split. A
// user pasting a thread URL got nothing back even though the game was in the
// library with its numeric ID stored in its own column. Rather than sanitise
// the URL data -- which would have to be redone on every catalog update from
// atlas-gamesdb.com -- the ID is pulled out of the URL and searched against the
// ID column, which is already reliable.
//
// Both the gate and the patterns are ANCHORED, and both anchors are load
// bearing. isLikelyUrl stops a title that merely contains a link
// ("Half-Life 2 store.steampowered.com/app/220/"); the patterns stop a real URL
// that carries a thread link in a query string or redirect
// ("f95zone.to/about?next=https://f95zone.to/threads/slug.123/").
//
// The slug is optional on both forums:
//   f95zone.to/threads/some-slug.310615/   and   f95zone.to/threads/310615/
//   lewdcorner.com/threads/some-slug.5913/ and   lewdcorner.com/threads/5913/
//   store.steampowered.com/app/4585540/Some_Name/
const F95ZONE_REGEX = /^(?:https?:\/\/)?(?:www\.)?f95zone\.to\/threads\/(?:[^/]*[.-])?(\d+)(?:\/|$)/i
const LEWDCORNER_REGEX = /^(?:https?:\/\/)?(?:www\.)?lewdcorner\.com\/threads\/(?:[^/]*[.-])?(\d+)(?:\/|$)/i
const STEAM_REGEX = /^(?:https?:\/\/)?(?:www\.)?store\.steampowered\.com\/app\/(\d+)(?:\/|$)/i

const URL_PREFIXES = ['http://', 'https://', 'www.', 'f95zone.to/', 'lewdcorner.com/', 'store.steampowered.com/']

// A cheap gate before the regexes. Anchored for the same reason they are: a
// title containing "www." is not a URL.
function isLikelyUrl(text) {
  const lower = String(text || '').trim().toLowerCase()
  return URL_PREFIXES.some((prefix) => lower.startsWith(prefix))
}

// Returns `{ field, query }` -- the search field id to force and the numeric ID
// to search for -- or null when the text is not a recognised URL. Callers must
// resolve an explicit `prefix:` FIRST; a user who typed `title:` or `url:` has
// said what they want and a URL in the remaining text must not override it.
function extractUrlId(text) {
  const trimmed = String(text || '').trim()
  if (!isLikelyUrl(trimmed)) return null
  const f95 = trimmed.match(F95ZONE_REGEX)
  if (f95) return { field: 'f95Id', query: f95[1] }
  const lc = trimmed.match(LEWDCORNER_REGEX)
  if (lc) return { field: 'lcId', query: lc[1] }
  const steam = trimmed.match(STEAM_REGEX)
  if (steam) return { field: 'steamId', query: steam[1] }
  return null
}

module.exports = { extractUrlId, isLikelyUrl }
