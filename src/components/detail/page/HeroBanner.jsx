import useImageFallback from '../../../hooks/useImageFallback.js'

export default function HeroBanner({ game, bannerRef, bannerDimsRef, bannerMask, onLoad, onBack }) {
  const hasInstalledVersion = game.hasInstalledVersion !== false
  // When the hero is Steam key-art, zoom it slightly so it fills the frame the
  // way Steam presents library_hero (which has built-in padding).
  const isSteamHero = !!(game.steam_appid || game.steam_id)

  // hero_candidates already encode the fallback chain (steam CDN → steam fastly
  // → next source's banner). Fall back to the single-url fields for older data.
  const heroChain = game.hero_candidates || [game.hero_url, game.banner_url]
  const logoChain = game.logo_candidates || (game.logo_url ? [game.logo_url] : [])

  const { src: heroUrl } = useImageFallback(heroChain)
  const { src: logoUrl, failed: logoFailed } = useImageFallback(logoChain)
  const showLogo = logoUrl && !logoFailed

  return (
    <div ref={bannerRef} style={{ position: 'relative', height: 370, flexShrink: 0, overflow: 'hidden', backgroundColor: '#1a1f2e' }}>
      {/* Blurred background fill */}
      {heroUrl && (
        <img src={heroUrl} alt="" style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          objectFit: 'cover',
          filter: `blur(20px) ${hasInstalledVersion ? '' : 'grayscale(1)'}`,
          transform: 'scale(1.1)', opacity: 0.6,
        }} />
      )}
      {!heroUrl && <div style={{ position: 'absolute', inset: 0, background: '#1d2734' }} />}

      {/* Foreground */}
      {heroUrl && (
        <img src={heroUrl} alt=""
          onLoad={(e) => {
            bannerDimsRef.current = { w: e.target.naturalWidth, h: e.target.naturalHeight }
            onLoad()
          }}
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            objectFit: 'contain',
            transform: isSteamHero ? 'scale(1.15)' : undefined,
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

      {/* Title / logo (bottom-left, steam-style). Bottom padding clears the
          action bar, which now overlaps the lower edge of the hero. */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '0 24px 70px' }}>
        {showLogo ? (
          <img
            src={logoUrl}
            alt={game.title || 'Game logo'}
            style={{ maxHeight: 220, maxWidth: '80%', objectFit: 'contain', filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.8))' }}
          />
        ) : (
          <>
            <div className="text-sm text-highlight" style={{ marginBottom: 2, opacity: 0.9 }}>
              {game.creator || 'Unknown creator'}
            </div>
            <h1 style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.2, textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}>
              {game.title || 'Untitled Game'}
            </h1>
          </>
        )}
      </div>
    </div>
  )
}
