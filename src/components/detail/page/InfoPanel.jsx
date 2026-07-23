import useImageFallback from '../../../hooks/useImageFallback.js'
import SafeImage from '../../ui/SafeImage.jsx'
import { isSteamGame, isGogGame, htmlToText } from './gameDetailUtils.js'

// About / description panel shown directly beneath the action bar. Hidden by
// default; toggled by the info button in the action bar. Steam-style: the
// description is clamped to a few lines with an inline "Read More" that expands
// it in place. For Steam/GOG games it also shows the portrait box art on the left.
export default function InfoPanel({ game, latestVersion, isUpdateAvailable }) {
  const appid = game.steam_appid || game.steam_id
  const steam = isSteamGame(game)
  const gog = isGogGame(game)

  const capsuleChain = [
    game.steam_library_capsule,
    appid && `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appid}/library_600x900.jpg`,
    // GOG box art (portrait) lives in gog_library_capsule.
    game.gog_library_capsule,
  ].filter(Boolean)
  const { src: capsuleUrl, failed: capsuleFailed } = useImageFallback(capsuleChain)
  const showCapsule = (steam || gog) && capsuleUrl && !capsuleFailed

  const description = htmlToText(game.overview)
  const changelog = htmlToText(game.changelog)

  // Nothing to show -> render nothing (keeps the page tight for sparse records).
  if (!showCapsule && !description && !changelog && !isUpdateAvailable) return null

  return (
    <div className="mx-6 mt-4 bg-secondary border border-border" style={{ padding: '20px 24px' }}>
      {isUpdateAvailable && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 16, padding: '8px 12px', background: 'color-mix(in srgb, var(--color-detail-accent) 15%, transparent)', border: '1px solid color-mix(in srgb, var(--color-detail-accent) 30%, transparent)', borderRadius: 2 }}>
          <i className="fas fa-arrow-circle-up" style={{ color: 'var(--color-detail-accent)' }}></i>
          <span style={{ color: 'var(--color-detail-accent-text)' }}>Update available &mdash; {latestVersion}</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {showCapsule && (
          <div style={{ flexShrink: 0, width: 200, maxWidth: '100%' }}>
            <SafeImage
              src={capsuleUrl}
              alt={`${game.title || 'Game'} box art`}
              fallbackLabel="Box art unavailable"
              style={{ width: '100%', height: 'auto', maxHeight: 300, objectFit: 'contain', objectPosition: 'top', display: 'block', borderRadius: 4 }}
            />
          </div>
        )}

        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
            About
          </div>
          {description ? (
            <div
              style={{
                fontSize: 13,
                lineHeight: 1.55,
                color: 'var(--color-text)',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
              }}
            >
              {description}
            </div>
          ) : (
            <div style={{ color: 'var(--color-muted)', fontSize: 13 }}>No description available</div>
          )}

          {changelog && (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
                Changelog
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--color-text)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 220, overflowY: 'auto' }}>
                {changelog}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
