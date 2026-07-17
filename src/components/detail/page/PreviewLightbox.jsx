import { useEffect, useState } from 'react'
import SafeImage from '../../ui/SafeImage.jsx'
import { toMediaSrc } from '../../../utils/mediaSrc.js'

// Navigation buttons scale with the viewport so they stay comfortably sized
// on high-resolution displays (past 1080p) while keeping a sane minimum.
const NAV_BTN_SIZE = 'clamp(44px, 4vw, 84px)'
const NAV_ICON_SIZE = 'clamp(16px, 1.8vw, 36px)'
const NAV_EDGE_OFFSET = 'clamp(12px, 1.5vw, 28px)'

// Media is scaled to fit 90% of the window (both up and down) while preserving
// aspect ratio. We measure the natural size on load and size the element to the
// exact fitted rectangle so it hugs the rendered image — that way the empty
// space around a widescreen/portrait image is the backdrop and closes on click.
const FIT_W = 0.9
const FIT_H = 0.9

function useViewport() {
  const [vp, setVp] = useState(() => ({
    w: typeof window === 'undefined' ? 1920 : window.innerWidth,
    h: typeof window === 'undefined' ? 1080 : window.innerHeight,
  }))
  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return vp
}

function fitSize(natural, vp) {
  if (!natural || !natural.w || !natural.h) return null
  const scale = Math.min((vp.w * FIT_W) / natural.w, (vp.h * FIT_H) / natural.h)
  return { width: Math.round(natural.w * scale), height: Math.round(natural.h * scale) }
}

export default function PreviewLightbox({ previews, lightboxIndex, onClose, onPrev, onNext }) {
  const vp = useViewport()
  const [natural, setNatural] = useState(null)
  const key = lightboxIndex === null ? null : previews[lightboxIndex]

  // Reset measured size whenever the displayed media changes.
  useEffect(() => { setNatural(null) }, [key])

  if (lightboxIndex === null || !previews[lightboxIndex]) return null

  const current = previews[lightboxIndex]
  const isVideo = /\.(mp4|webm|m4v)(\?|#|$)/i.test(String(current || ''))
  // GOG trailers are stored as YouTube embed URLs (no file extension); play them
  // inline via an <iframe> rather than the <video> element.
  const youTubeEmbed = (() => {
    const u = String(current || '')
    let id = ''
    const embed = u.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/i)
    const watch = u.match(/[?&]v=([A-Za-z0-9_-]{6,})/i)
    const short = u.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/i)
    id = (embed && embed[1]) || (watch && watch[1]) || (short && short[1]) || ''
    return id ? `https://www.youtube.com/embed/${id}?autoplay=1&rel=0` : ''
  })()
  const isYouTube = !!youTubeEmbed
  const fit = fitSize(natural, vp)

  // Once measured, lock to the exact fitted rectangle; before measuring, cap at
  // 90% so an unmeasured frame never overflows.
  const sizeStyle = fit
    ? { width: fit.width, height: fit.height, margin: 'auto' }
    : { maxWidth: '90vw', maxHeight: '90vh', margin: 'auto' }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(8,10,15,0.92)', backdropFilter: 'blur(6px)',
      }}
    >
      {/* Top bar */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px' }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-muted)' }}>{lightboxIndex + 1} / {previews.length}</span>
        <button
          onClick={onClose}
          title="Close (Esc)"
          style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 2, color: 'var(--color-text)', cursor: 'pointer', transition: 'background 0.15s' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.14)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
        >
          <i className="fas fa-times" style={{ fontSize: 15 }}></i>
        </button>
      </div>

      {/* Prev */}
      {previews.length > 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); onPrev() }}
          title="Previous (←)"
          style={{ position: 'absolute', left: NAV_EDGE_OFFSET, top: '50%', transform: 'translateY(-50%)', width: NAV_BTN_SIZE, height: NAV_BTN_SIZE, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 2, color: 'var(--color-text)', cursor: 'pointer', transition: 'background 0.15s' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.14)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
        >
          <i className="fas fa-chevron-left" style={{ fontSize: NAV_ICON_SIZE }}></i>
        </button>
      )}

      {/* Media — sized to the fitted rectangle so empty space around it is the
          backdrop, which closes the viewer on click. */}
      {isYouTube ? (
        <iframe
          src={youTubeEmbed}
          title={`Trailer ${lightboxIndex + 1}`}
          allow="accelerated-download; autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          onClick={(e) => e.stopPropagation()}
          style={{
            ...(fit ? { width: fit.width, height: fit.height, margin: 'auto' } : { width: 'min(90vw, 960px)', height: 'min(90vh, 540px)', margin: 'auto' }),
            display: 'block', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 8px 40px rgba(0,0,0,0.6)', background: '#000',
          }}
        />
      ) : isVideo ? (
        <video
          src={toMediaSrc(current)}
          controls
          autoPlay
          onLoadedMetadata={(e) => setNatural({ w: e.target.videoWidth, h: e.target.videoHeight })}
          onClick={(e) => e.stopPropagation()}
          style={{ ...sizeStyle, display: 'block', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 8px 40px rgba(0,0,0,0.6)', background: '#000' }}
        />
      ) : (
        <SafeImage
          src={current}
          alt={`Preview ${lightboxIndex + 1}`}
          fallbackLabel="Preview unavailable"
          onLoad={(e) => setNatural({ w: e.target.naturalWidth, h: e.target.naturalHeight })}
          onClick={(e) => e.stopPropagation()}
          style={{ ...sizeStyle, display: 'block', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 8px 40px rgba(0,0,0,0.6)' }}
          placeholderStyle={{ width: 'min(90vw, 900px)', height: 'min(90vh, 520px)' }}
        />
      )}

      {/* Next */}
      {previews.length > 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); onNext() }}
          title="Next (→)"
          style={{ position: 'absolute', right: NAV_EDGE_OFFSET, top: '50%', transform: 'translateY(-50%)', width: NAV_BTN_SIZE, height: NAV_BTN_SIZE, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 2, color: 'var(--color-text)', cursor: 'pointer', transition: 'background 0.15s' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.14)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
        >
          <i className="fas fa-chevron-right" style={{ fontSize: NAV_ICON_SIZE }}></i>
        </button>
      )}
    </div>
  )
}
