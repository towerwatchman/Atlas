import SafeImage from '../../ui/SafeImage.jsx'

export default function PreviewLightbox({ previews, lightboxIndex, onClose, onPrev, onNext }) {
  if (lightboxIndex === null || !previews[lightboxIndex]) return null

  const current = previews[lightboxIndex]
  const isVideo = /\.(mp4|webm|m4v)(\?|#|$)/i.test(String(current || ''))

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
        <span style={{ fontSize: 12, fontWeight: 600, color: '#9ca3af' }}>{lightboxIndex + 1} / {previews.length}</span>
        <button
          onClick={onClose}
          title="Close (Esc)"
          style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 2, color: '#d1d5db', cursor: 'pointer', transition: 'background 0.15s' }}
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
          style={{ position: 'absolute', left: 18, top: '50%', transform: 'translateY(-50%)', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 2, color: '#d1d5db', cursor: 'pointer', transition: 'background 0.15s' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.14)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
        >
          <i className="fas fa-chevron-left" style={{ fontSize: 16 }}></i>
        </button>
      )}

      {/* Media */}
      {isVideo ? (
        <video
          src={current}
          controls
          autoPlay
          onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: '90vw', maxHeight: '85vh', objectFit: 'contain', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 8px 40px rgba(0,0,0,0.6)', background: '#000' }}
        />
      ) : (
        <SafeImage
          src={current}
          alt={`Preview ${lightboxIndex + 1}`}
          fallbackLabel="Preview unavailable"
          onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: '90vw', maxHeight: '85vh', objectFit: 'contain', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 8px 40px rgba(0,0,0,0.6)' }}
          placeholderStyle={{ width: 'min(90vw, 900px)', height: 'min(85vh, 520px)' }}
        />
      )}

      {/* Next */}
      {previews.length > 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); onNext() }}
          title="Next (→)"
          style={{ position: 'absolute', right: 18, top: '50%', transform: 'translateY(-50%)', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 2, color: '#d1d5db', cursor: 'pointer', transition: 'background 0.15s' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.14)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
        >
          <i className="fas fa-chevron-right" style={{ fontSize: 16 }}></i>
        </button>
      )}
    </div>
  )
}
