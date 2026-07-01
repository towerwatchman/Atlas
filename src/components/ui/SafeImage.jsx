import { useEffect, useState } from 'react'
import { toMediaSrc } from '../../utils/mediaSrc.js'

export default function SafeImage({
  src,
  alt = '',
  className,
  style,
  fallbackLabel = 'Image unavailable',
  fallbackDetail,
  fallbackContent = true,
  fallbackMode,
  placeholderStyle,
  onError,
  ...imgProps
}) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [src])

  const showFallback = !src || failed
  const mode = fallbackMode || (fallbackContent === false ? 'transparent' : 'placeholder')

  if (showFallback) {
    if (mode === 'hidden') return null

    const isTransparent = mode === 'transparent'

    return (
      <div
        {...imgProps}
        className={className}
        role={alt ? 'img' : undefined}
        aria-label={alt || undefined}
        aria-hidden={alt ? undefined : true}
        style={{
          ...style,
          background: isTransparent ? 'transparent' : '#1f2937',
          color: '#9ca3af',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          textAlign: 'center',
          ...placeholderStyle,
        }}
      >
        {!isTransparent && fallbackContent && (
          <div style={{ padding: 12, maxWidth: '100%' }}>
            <i className="fas fa-image" style={{ display: 'block', fontSize: 22, marginBottom: 8, opacity: 0.8 }}></i>
            <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3 }}>{fallbackLabel}</div>
            {fallbackDetail && (
              <div style={{ fontSize: 11, lineHeight: 1.35, marginTop: 4, opacity: 0.8 }}>{fallbackDetail}</div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <img
      {...imgProps}
      src={toMediaSrc(src)}
      alt={alt}
      className={className}
      style={style}
      onError={(event) => {
        setFailed(true)
        if (onError) onError(event)
      }}
    />
  )
}
