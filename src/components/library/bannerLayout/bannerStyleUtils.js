export const VALID_IMAGE_FITS = new Set(['contain', 'cover'])

const ENGINE_COLORS = {
  ADRIFT: '#4F68D9',
  Flash: '#D04220',
  HTML: '#5B8600',
  Java: '#6EA4B1',
  Others: '#72A200',
  QSP: '#BD3631',
  RAGS: '#B67E00',
  RPGM: '#4F68D9',
  "Ren'Py": '#9B00EF',
  Tads: '#4F68D9',
  Unity: '#D35B00',
  'Unreal Engine': '#3730A9',
  WebGL: '#E56200',
  'Wolf RPG': '#4B8926',
}

const STATUS_COLORS = {
  Completed: '#4F68D9',
  Onhold: '#649DFC',
  Abandoned: '#B67E00',
  '': 'transparent',
  null: 'transparent',
}

export const getEngineBackgroundColor = (engine) =>
  ENGINE_COLORS[engine] || '#4B8926'

export const getStatusBackgroundColor = (status) =>
  STATUS_COLORS[status] || 'transparent'

export const normalizeFontSize = (fontSize, fallback = 12) => {
  const numeric = Number(fontSize)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(24, Math.max(8, numeric))
}

export const normalizeOverlayOpacity = (opacity, fallback = 0.8) => {
  const numeric = Number(opacity)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(1, Math.max(0, numeric))
}

export const normalizeImageFit = (fit) =>
  VALID_IMAGE_FITS.has(fit) ? fit : 'contain'

