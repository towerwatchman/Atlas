export default function HeroBanner({ game, bannerRef, bannerDimsRef, bannerMask, onLoad, onBack }) {
  const hasInstalledVersion = game.hasInstalledVersion !== false

  return (
    <div ref={bannerRef} style={{ position: 'relative', height: 370, flexShrink: 0, overflow: 'hidden', backgroundColor: '#1a1f2e' }}>
      {/* Blurred background fill */}
      {game.banner_url && (
        <img src={game.banner_url} alt="" style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          objectFit: 'cover',
          filter: `blur(20px) ${hasInstalledVersion ? '' : 'grayscale(1)'}`,
          transform: 'scale(1.1)', opacity: 0.6,
        }} />
      )}
      {!game.banner_url && <div style={{ position: 'absolute', inset: 0, background: '#1d2734' }} />}

      {/* Foreground */}
      {game.banner_url && (
        <img src={game.banner_url} alt=""
          onLoad={(e) => {
            bannerDimsRef.current = { w: e.target.naturalWidth, h: e.target.naturalHeight }
            onLoad()
          }}
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            objectFit: 'contain',
            filter: hasInstalledVersion ? 'none' : 'grayscale(1)',
            WebkitMaskImage: bannerMask.image,
            maskImage: bannerMask.image,
            ...(bannerMask.composite
              ? { WebkitMaskComposite: 'source-in', maskComposite: bannerMask.composite }
              : {}),
          }}
        />
      )}

      {/* Bottom fade */}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, transparent 30%, var(--color-tertiary,#12161f) 100%)' }} />

      {/* Back button */}
      <div style={{ position: 'absolute', top: 14, left: 14 }}>
        <button onClick={onBack}
          className="text-xs text-text hover:text-highlight bg-primary/80 border border-border px-3 py-2"
          style={{ backdropFilter: 'blur(4px)' }}>
          <i className="fas fa-arrow-left" style={{ marginRight: 6 }}></i>Back to Library
        </button>
      </div>

      {/* Title */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '0 24px 16px' }}>
        <div className="text-sm text-highlight" style={{ marginBottom: 2, opacity: 0.9 }}>
          {game.creator || 'Unknown creator'}
        </div>
        <h1 style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.2, textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}>
          {game.title || 'Untitled Game'}
        </h1>
      </div>
    </div>
  )
}
