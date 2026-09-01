import { SOURCE_ICON_MAP } from '../../assets/icons/sourceIcons'

// Generic fallbacks for sources without a configured logo asset. Kept here so
// SourceIcon never has to know about individual brand rendering.
const FALLBACK = {
  steam: 'fab fa-steam',
  gog: 'fas fa-gamepad',
  lewdcorner: 'fas fa-link',
  custom: 'fas fa-user',
}

export default function SourceIcon({ source, size = 16, className = '', style = {} }) {
  if (!source) return null
  const src = SOURCE_ICON_MAP[source]
  if (src) {
    // Size by height so non-square logos keep their aspect ratio (width scales
    // with it). maxWidth + object-contain prevent overflow without distortion.
    return (
      <img
        src={src}
        alt={source}
        title={source}
        className={`object-contain ${className}`}
        style={{ height: size, width: 'auto', maxWidth: '100%', objectFit: 'contain', ...style }}
      />
    )
  }
  const faClass = FALLBACK[source] || 'fas fa-circle'
  return (
    <i
      className={`${faClass} ${className}`}
      title={source}
      style={{ fontSize: size, ...style }}
    />
  )
}
