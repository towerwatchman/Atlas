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
