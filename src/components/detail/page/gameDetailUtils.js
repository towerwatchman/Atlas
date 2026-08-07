import { resolveInstallAction } from './installSources.js'

export const normalizeVersionForCompare = (value) =>
  String(value || '').trim().toLowerCase().replace(/\s+/g, '').replace(/^v/, '').replace(/[^0-9.]/g, '')

export const compareVersions = (a, b) => {
  const ap = normalizeVersionForCompare(a).split('.').map((n) => parseInt(n, 10) || 0)
  const bp = normalizeVersionForCompare(b).split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(ap.length, bp.length)
  for (let i = 0; i < len; i++) {
    const x = ap[i] || 0, y = bp[i] || 0
    if (x < y) return -1
    if (x > y) return 1
  }
  return 0
}

export const sortVersionsDesc = (versions = []) =>
  [...versions].sort((x, y) => compareVersions(y.version, x.version))

export const getInstalledVersions = (versions = []) =>
  versions.filter((v) => v.isInstalled !== false)

export const getDefaultVersion = (versions = []) => {
  const installed = sortVersionsDesc(getInstalledVersions(versions))
  if (installed[0]) return installed[0]
  return sortVersionsDesc(versions)[0] || null
}

export const normalizeUrl = (url) => {
  if (!url) return ''
  return String(url).split(/[?#]/)[0].trim().toLowerCase().replace(/\/+$/, '')
}

export const filterOutBanner = (urls = [], bannerUrl) => {
  const list = Array.isArray(urls) ? urls : []
  const banner = normalizeUrl(bannerUrl)
  if (!banner) return list
  const bannerName = banner.split('/').pop()
  return list.filter((u) => {
    const n = normalizeUrl(u)
    if (!n) return false
    if (n === banner) return false
    const name = n.split('/').pop()
    if (bannerName && name && name === bannerName) return false
    return true
  })
}

export const formatPlaytime = (minutes) => {
  const totalMinutes = Number(minutes || 0)
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return 'Not played'
  const hours = Math.floor(totalMinutes / 60)
  const mins = Math.round(totalMinutes % 60)
  if (hours <= 0) return `${mins}m played`
  if (mins <= 0) return `${hours}h played`
  return `${hours}h ${mins}m played`
}

export const isVideoUrl = (url) =>
  /\.(mp4|webm|m4v|mpd)(\?|#|$)/i.test(String(url || ''))

// True specifically for DASH manifests, which need dash.js rather than a plain
// <video> src.
export const isDashUrl = (url) =>
  /\.mpd(\?|#|$)/i.test(String(url || ''))

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

const cleanSteamAppId = (value) => {
  const match = String(value || '').trim().match(/^\d+$/)
  return match ? match[0] : ''
}

export const getSteamAppId = (game = {}) => {
  const externalIds = parseExternalIds(game.external_ids ?? game.externalIds)
  const candidates = [
    game.steam_appid,
    game.steam_id,
    game.steamAppId,
    game.steamId,
    externalIds.steam_appid,
    externalIds.steam_id,
    externalIds.steamAppId,
    externalIds.steamId,
  ]
  for (const candidate of candidates) {
    const appId = cleanSteamAppId(candidate)
    if (appId) return appId
  }
  return ''
}

export const getMappedSteamAppId = (game = {}) => {
  if (game.isCatalogEntry === true || game.isWishlistEntry === true || game.isMetadataOnly === true) return ''
  const candidates = [
    game.steam_appid,
    game.steam_id,
    game.steamAppId,
    game.steamId,
  ]
  for (const candidate of candidates) {
    const appId = cleanSteamAppId(candidate)
    if (appId) return appId
  }
  return ''
}

// True when the record has Steam metadata available, either from a real mapping
// or an external id.
export const isSteamGame = (game = {}) => !!getSteamAppId(game)

const cleanGogId = (value) => {
  const match = String(value || '').trim().match(/^\d+$/)
  return match ? match[0] : ''
}

export const getGogId = (game = {}) => {
  const externalIds = parseExternalIds(game.external_ids ?? game.externalIds)
  const candidates = [
    game.gog_id,
    game.gog_appid,
    game.gogId,
    game.gogAppId,
    externalIds.gog_id,
    externalIds.gog_appid,
    externalIds.gogId,
  ]
  for (const candidate of candidates) {
    const id = cleanGogId(candidate)
    if (id) return id
  }
  return ''
}

export const getMappedGogId = (game = {}) => {
  if (game.isCatalogEntry === true || game.isWishlistEntry === true || game.isMetadataOnly === true) return ''
  const candidates = [game.gog_id, game.gog_appid, game.gogId, game.gogAppId]
  for (const candidate of candidates) {
    const id = cleanGogId(candidate)
    if (id) return id
  }
  return ''
}

// True when the record has GOG metadata available.
export const isGogGame = (game = {}) => !!getGogId(game)

// Developer should prefer the real developer. games.creator is sometimes a
// placeholder ("Unknown") or the publisher captured at import time, so fall back
// to the enriched steam_data.developer when creator is missing/placeholder.
export const resolveDeveloper = (game = {}) => {
  const creator = String(game.creator || '').trim()
  if (creator && creator.toLowerCase() !== 'unknown') return creator
  return String(game.steam_developer || game.gog_developer || '').trim()
}

// Language lists from Steam can be enormous. Collapse anything over the cap to a
// short summary so the Details card stays readable.
export const formatLanguages = (raw, cap = 5) => {
  const list = String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (list.length === 0) return ''
  if (list.length > cap) return `Multiple languages (${list.length})`
  return list.join(', ')
}

// Convert Steam's HTML description (or plain/bbcode text) into readable plain
// text. Avoids dangerouslySetInnerHTML — block tags become line breaks, list
// items get bullets, everything else is stripped and entities decoded.
export const htmlToText = (raw) => {
  let s = String(raw || '')
  if (!s) return ''
  s = s
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|h[1-6]|tr|ul|ol)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\u2022 ')
    .replace(/<\s*\/\s*li\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  const entities = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
    '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
  }
  s = s.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&apos;|&nbsp;/g, (m) => entities[m] || m)
  s = s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
  return s.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim()
}

// Steam "category" descriptions → FontAwesome icon. Unknown categories fall back
// to a neutral check so they still render as a clean line item.
const STEAM_CATEGORY_ICONS = [
  [/single-?player/i, 'fas fa-user'],
  [/^mmo/i, 'fas fa-users'],
  [/co-?op/i, 'fas fa-user-friends'],
  [/multi-?player/i, 'fas fa-users'],
  [/pvp/i, 'fas fa-crosshairs'],
  [/split screen|shared/i, 'fas fa-columns'],
  [/cross-?platform/i, 'fas fa-random'],
  [/achievement/i, 'fas fa-trophy'],
  [/leaderboard/i, 'fas fa-list-ol'],
  [/trading card/i, 'fas fa-id-card'],
  [/workshop/i, 'fas fa-tools'],
  [/cloud/i, 'fas fa-cloud'],
  [/full controller/i, 'fas fa-gamepad'],
  [/partial controller/i, 'fas fa-gamepad'],
  [/remote play/i, 'fas fa-mobile-alt'],
  [/\bvr\b|virtual reality/i, 'fas fa-vr-cardboard'],
  [/captions|subtitle/i, 'fas fa-closed-captioning'],
  [/in-app purchase/i, 'fas fa-shopping-cart'],
  [/level editor|editor/i, 'fas fa-pencil-ruler'],
  [/anti-?cheat/i, 'fas fa-shield-alt'],
  [/stats/i, 'fas fa-chart-bar'],
  [/hdr/i, 'fas fa-adjust'],
  [/commentary/i, 'fas fa-comment-dots'],
]

export const getCategoryIcon = (name) => {
  const n = String(name || '')
  for (const [re, icon] of STEAM_CATEGORY_ICONS) if (re.test(n)) return icon
  return 'fas fa-check'
}

export const splitCsv = (raw) =>
  String(raw || '').split(',').map((s) => s.trim()).filter(Boolean)

// Atlas stores release_date as a Unix timestamp (seconds); Steam stores a
// human string like "12 Jun, 2024". Prefer the Atlas timestamp (rendered as
// YYYY-MM-DD), then fall back to the Steam string verbatim. Returns null when
// neither is usable so the row is omitted.
export const formatReleaseDate = (game = {}) => {
  const atlas = game.release_date
  if (atlas !== null && atlas !== undefined && String(atlas).trim() !== '') {
    const raw = String(atlas).trim()
    // A YYYY-MM-DD (or YYYY-MM-DDThh...) string — e.g. GOG's release_date, or an
    // atlas override entered as text. Return the date part verbatim; do NOT run
    // it through parseInt (parseInt("1996-08-31") === 1996, which as a unix
    // timestamp renders 1970-01-01 — the exact bug this guards against).
    const isoMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/)
    if (isoMatch) return isoMatch[1]
    // Otherwise treat it as a Unix timestamp in seconds (atlas' native form),
    // but only when the value is purely numeric.
    if (/^\d+$/.test(raw)) {
      const ts = parseInt(raw, 10)
      if (Number.isFinite(ts) && ts > 0) {
        const d = new Date(ts * 1000)
        if (!Number.isNaN(d.getTime())) return d.toISOString().split('T')[0]
      }
    }
  }
  const steam = String(game.steam_release_date || '').trim()
  if (steam) return steam
  const gog = String(game.gog_release_date || '').trim()
  return gog || null
}

export const LAUNCH_STATE = { IDLE: 'idle', LAUNCHING: 'launching', RUNNING: 'running' }

export const STEAM_GREEN  = 'var(--color-detail-play)'      // Play (idle)
export const STEAM_BLUE   = 'var(--color-detail-running)'   // Play (running)
export const STEAM_YELLOW = 'var(--color-detail-launching)' // Play (launching)
export const STEAM_GRAY   = 'var(--color-selected)'         // Play (disabled)

export const ACTION_BTN = {
  height: 36,
  padding: '0 16px',
  fontWeight: 700,
  fontSize: 12,
  letterSpacing: '0.05em',
  color: 'var(--color-detail-play-text)',
  border: 'none',
  borderRadius: 2,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  textShadow: '1px 1px 0px rgba(0,0,0,0.5)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.15), 0 1px 3px rgba(0,0,0,0.5)',
  cursor: 'pointer',
  transition: 'filter 0.15s',
}

export const iconBtn = (disabled) => ({
  width: 34, height: 34,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 2,
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.3 : 1,
  color: 'inherit',
  transition: 'background 0.15s, border-color 0.15s',
})

// ── Action bar routing ───────────────────────────────────────────────────────
//
// Which action each primary button performs. Extracted because getting this
// wrong does not break anything visibly — the button still renders and still
// does *something* — it just silently removes a capability.
//
// That is exactly what happened: wiring the mirror picker onto the UPDATE button
// as `onOpenUpdate || (canManageLocalTitle ? onToggleLocalImport : onOpenWebsite)`
// meant that for any local title the picker always won, and the update/import
// panel — the only route to adding a version from an archive or a folder already
// on disk — became unreachable for an installed game. No error, no dead button,
// just a feature that was there last release and now is not.
//
// So the routes are named and asserted rather than expressed as a chain of ||
// inside JSX.
export function resolveActionBarRoutes({
  canLaunch = false,
  canInstallFromDetail = false,
  canManageLocalTitle = true,
  // A catalog or wishlist row. Distinct from canManageLocalTitle rather than its
  // inverse: both are false for a metadata-only title, and conflating them is
  // what hid the manual install below.
  canManageWishlist = false,
  hasOpenUpdate = false,
  hasLocalImport = true,
  // Every source this title can be installed from, from
  // page/installSources.js resolveInstallSources(). Replaces the old
  // `hasSteamInstall` boolean, which could only ever express "Steam, or not
  // Steam" and therefore could only ever answer by overriding.
  installSources = [],
} = {}) {
  const showInstallCta = !canLaunch && canInstallFromDetail
  // A browse row has no local record, so there is nothing on disk to point at:
  // its INSTALL button wants the mirror picker, which is how the game gets here
  // in the first place.
  const installOpensMirrors = hasOpenUpdate && !canManageLocalTitle

  // ── Why Steam no longer takes the button ─────────────────────────────────
  //
  // This used to read `hasSteamInstall ? 'steam' : installOpensMirrors ? …`,
  // so a Steam mapping won outright and a title with both a Steam appid and
  // F95 mirrors could only be installed from Steam. The mirrors were not
  // hidden or disabled, they were unreachable: the one control that opened
  // them now did something else, and the button's label said INSTALL either
  // way.
  //
  // The count decides now. One source is not a choice and gets no dialog --
  // Steam-only still goes straight to Steam, which is the behaviour that was
  // right about the old rule. More than one is a choice, and it belongs to the
  // user.
  //
  // Ordered AFTER the local-import check for a local uninstalled title,
  // deliberately unchanged: that title has a record on disk to add a version
  // to, and its INSTALL has always opened the panel.
  const installAction = resolveInstallAction(installSources)
  const installRoute = !showInstallCta
    ? 'launch'
    : installSources.length > 0
      ? (installAction === 'f95' ? 'mirrors' : installAction)
      : installOpensMirrors
        ? 'mirrors'
        : 'localImport'

  return {
    showInstallCta,
    installOpensMirrors,
    // What the primary button does. 'picker' is new: more than one source, so
    // ask. 'steam' and 'gog' are single-source shortcuts, not overrides.
    installRoute,
    // Kept separate from installRoute so the button's LABEL is driven by the
    // same value as its click handler. ActionBar used to derive the label from
    // its own `steamInstallCta` expression -- a second copy of this rule, in a
    // place nothing could assert -- and that copy is what actually put a Steam
    // glyph on the button.
    installSources,
    // The UPDATE button never routes to the local import panel any more.
    updateRoute: hasOpenUpdate ? 'mirrors' : 'website',
    // Retained for callers that render the local import panel's own control.
    // ActionBar no longer uses it: the caret below covers both cases, and two
    // controls for one panel is what "one rule in two places" looks like in UI.
    showLocalImportAction: canManageLocalTitle && hasLocalImport,
    // ── The split button caret ────────────────────────────────────────────
    //
    // Where manual install lives. The primary button keeps the primary action --
    // launch, or fetch a build -- and the caret offers the build you already
    // have.
    //
    // Shown for a library title as well as a browse row, because the panel serves
    // both: it picks 'Install / Import Files' or 'Update / Import Files' from
    // canManageWishlist off the same handler. A library title reaching it through
    // the caret is what makes the caret green -- it inherits the colour of the
    // button it hangs from, and only a real PLAY button is green.
    //
    // The import panel has had a full 'catalog' mode all along -- it titles
    // itself "Install / Import Files", imports through import-catalog-entry, and
    // renders whenever canManageWishlist is true. Nothing opened it, because the
    // only trigger was gated on canManageLocalTitle, which is false for every
    // browse row. So the mode existed for a row that could not reach it.
    //
    // Worse, it looked intermittent rather than absent. installOpensMirrors is
    // `hasOpenUpdate && !canManageLocalTitle`, so a browse row WITHOUT a mirror
    // picker fell through to 'localImport' and its INSTALL button did open the
    // panel -- meaning manual install worked, but only for games that have no
    // download links, which is the inverse of when it is wanted.
    //
    // NOT conditioned on installOpensMirrors, deliberately. Hiding the caret when
    // the primary already opens the panel would be non-redundant but would make
    // the affordance come and go depending on whether a game has mirrors -- which
    // is the same "works, but only sometimes, for a reason invisible from the UI"
    // shape as the bug above. A consistent caret is worth one duplicated route.
    //
    // Both flags are still needed rather than one: they are BOTH false for a
    // metadata-only title, which has no panel to open and must get no caret.
    showInstallMenu: hasLocalImport && (canManageLocalTitle || canManageWishlist),
  }
}
