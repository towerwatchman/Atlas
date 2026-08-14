// Mirror of electron/db/urlIdExtractor.js. ESM for the renderer, CJS for main.
// If you change one, change the other.

// regex works for both slug syntax and the bare numeric ID
// f95zone threads: f95zone.to/threads/xxx.12345 
// lc threads: lewdcorner.com/threads/xxx.12345 
// steam threads: stored.steampowered.com/app/12345/MonsterFactory 
const F95ZONE_REGEX = /(?:https?:\/\/)?(?:www\.)?f95zone\.to\/threads\/(?:(?:[^\/]*[.\-])?(\d+))(?:\/|$)/i
const LEWDCORNER_REGEX = /(?:https?:\/\/)?(?:www\.)?lewdcorner\.com\/threads\/(?:(?:[^\/]*[.\-])?(\d+))(?:\/|$)/i
const STEAM_REGEX = /(?:https?:\/\/)?(?:www\.)?store\.steampowered\.com\/app\/(\d+)(?:\/|$)/i

export function isLikelyUrl(text) {
  const lower = String(text || '').toLowerCase()
  return lower.includes('http://') || lower.includes('https://') || lower.includes('www.') ||
         lower.includes('f95zone.to/') || lower.includes('lewdcorner.com/') || lower.includes('store.steampowered.com/')
}

// Extracts the numeric site ID from a thread / store URL. Returns `{ field, query }` 
// where `field` is the search field id (f95Id, lcId, steamId) and `query` is the ID
export function extractUrlId(text) {
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
