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
  /\.(mp4|webm|m4v)(\?|#|$)/i.test(String(url || ''))

// True when the record is backed by a Steam appid (mapping or external id).
export const isSteamGame = (game = {}) => !!(game.steam_appid || game.steam_id)

// Developer should prefer the real developer. games.creator is sometimes a
// placeholder ("Unknown") or the publisher captured at import time, so fall back
// to the enriched steam_data.developer when creator is missing/placeholder.
export const resolveDeveloper = (game = {}) => {
  const creator = String(game.creator || '').trim()
  if (creator && creator.toLowerCase() !== 'unknown') return creator
  return String(game.steam_developer || '').trim()
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
    const ts = parseInt(atlas, 10)
    if (Number.isFinite(ts) && ts > 0) {
      const d = new Date(ts * 1000)
      if (!Number.isNaN(d.getTime())) return d.toISOString().split('T')[0]
    }
  }
  const steam = String(game.steam_release_date || '').trim()
  return steam || null
}

export const LAUNCH_STATE = { IDLE: 'idle', LAUNCHING: 'launching', RUNNING: 'running' }

export const STEAM_GREEN  = '#5ba300'
export const STEAM_BLUE   = '#3a6db5'
export const STEAM_YELLOW = '#b58e00'
export const STEAM_GRAY   = '#3a3a3a'

export const ACTION_BTN = {
  height: 36,
  padding: '0 16px',
  fontWeight: 700,
  fontSize: 12,
  letterSpacing: '0.05em',
  color: '#d2e885',
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
