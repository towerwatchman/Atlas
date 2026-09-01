// ── Thread link for a game ───────────────────────────────────────────────────
//
// Where "Open thread" should go, given whatever identifiers a record happens to
// carry.
//
// Extracted and tested because the inline version was wrong in two ways at once
// and neither was visible on screen. It interpolated
// `https://f95zone.to/threads/${data?.threadId || threadId}/` with no guard, so
// a game with no thread id produced `https://f95zone.to/threads//` — a dead link
// behind a button that looked perfectly normal — and it hardcoded the F95 domain,
// so a LewdCorner title opened the wrong site.
//
// The order is deliberate. A stored site URL wins because it is the link the
// catalog actually recorded for this game, whichever forum it came from, and it
// needs no assumptions. An id-based URL is only built when there is a real
// numeric id to build it from. When there is nothing, the answer is an empty
// string and the caller renders no button — a link that goes nowhere is worse
// than no link, because the user cannot tell it failed.

const isHttpUrl = (value) => /^https?:\/\//i.test(String(value || '').trim())

const numericId = (value) => {
  const text = String(value ?? '').trim()
  // Positive only. Thread ids start at 1, and `0` passed a bare digit test and
  // produced `.../threads/0/` — a different flavour of the same dead link this
  // module exists to prevent. F95Checker also uses negative ids for its own
  // hand-made entries, which are not thread ids either.
  if (!/^\d+$/.test(text)) return ''
  return Number.parseInt(text, 10) > 0 ? String(Number.parseInt(text, 10)) : ''
}

/**
 * @param {object} params
 * @param {string} [params.siteUrl]            record's stored thread URL
 * @param {string} [params.lewdCornerSiteUrl]  record's stored LewdCorner URL
 * @param {string|number} [params.f95Id]
 * @param {string|number} [params.lcId]
 * @returns {string} an absolute URL, or '' when there is nothing to open
 */
export function buildThreadUrl({
  siteUrl = '',
  lewdCornerSiteUrl = '',
  f95Id = null,
  lcId = null,
} = {}) {
  if (isHttpUrl(siteUrl)) return String(siteUrl).trim()
  const f95 = numericId(f95Id)
  if (f95) return `https://f95zone.to/threads/${f95}/`
  if (isHttpUrl(lewdCornerSiteUrl)) return String(lewdCornerSiteUrl).trim()
  const lc = numericId(lcId)
  if (lc) return `https://lewdcorner.com/threads/${lc}/`
  return ''
}

/**
 * The same thing, given a raw game record.
 *
 * A record reaches the UI under either naming convention depending on which
 * query produced it, so every call site was repeating the same chain of ||
 * fallbacks. Two copies of that chain is a future bug where a card and a modal
 * disagree about where the same game's thread is; this is the one copy.
 *
 * @param {object|null} game
 * @returns {string} an absolute URL, or '' when there is nothing to open
 */
export function threadUrlForGame(game) {
  if (!game) return ''
  return buildThreadUrl({
    siteUrl: game.siteUrl || game.site_url,
    lewdCornerSiteUrl: game.lewdCornerSiteUrl || game.lewdcornerSiteUrl,
    f95Id: game.f95_id || game.f95Id,
    lcId: game.lc_id || game.lcId || game.lewdCornerId,
  })
}

/**
 * Whether a library row represents an installed game.
 *
 * Reads `hasInstalledVersion` rather than deriving from `versions`, which is
 * what GameDetailPage does. Detail works from a hydrated record; the library
 * list also yields plain catalog rows, and those are built with `versions: []`
 * (db/versions.js) even when the title is installed -- so deriving would report
 * every one of them as uninstalled. `hasInstalledVersion` is set on both shapes.
 *
 * A null game is a game the renderer has not loaded, which is UNKNOWN rather
 * than uninstalled. Returning false is still right for the caller (it has no
 * record to open a game page with) but the distinction matters if this is ever
 * used to decide something else.
 */
export function isInstalledGame(game) {
  return game?.hasInstalledVersion === true
}

export default buildThreadUrl
