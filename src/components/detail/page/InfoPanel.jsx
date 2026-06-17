import useImageFallback from '../../../hooks/useImageFallback.js'
import { isSteamGame, htmlToText } from './gameDetailUtils.js'

// Overview card shown directly beneath the action bar. For Steam games it shows
// the portrait box art (library_600x900) on the left and the game description
// (+ changelog, when present) on the right. Deliberately minimal — every other
// field lives in the Details card.
export default function InfoPanel({ game, latestVersion, isUpdateAvailable }) {
  const appid = game.steam_appid || game.steam_id
  const steam = isSteamGame(game)

  const capsuleChain = [
    game.steam_library_capsule,
    appid && `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appid}/library_600x900.jpg`,
  ].filter(Boolean)
  const { src: capsuleUrl, failed: capsuleFailed } = useImageFallback(capsuleChain)
  const showCapsule = steam && capsuleUrl && !capsuleFailed

  const description = htmlToText(game.overview)
  const changelog = htmlToText(game.changelog)

  // Nothing to show → render nothing (keeps the page tight for sparse records).
  if (!showCapsule && !description && !changelog && !isUpdateAvailable) return null

  return (
    <div className="bg-secondary border-b border-border" style={{ padding: '20px 24px' }}>
      {isUpdateAvailable && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 16, padding: '8px 12px', background: 'rgba(74,144,217,0.15)', border: '1px solid rgba(74,144,217,0.3)', borderRadius: 2 }}>
          <i className="fas fa-arrow-circle-up" style={{ color: '#4a90d9' }}></i>
          <span style={{ color: '#c8e0ff' }}>Update available — {latestVersion}</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 24, alignItems: 'stretch', flexWrap: 'wrap' }}>
        {showCapsule && (
          <div style={{ flexShrink: 0, width: 200, maxWidth: '100%' }}>
            <img
              src={capsuleUrl}
              alt={`${game.title || 'Game'} box art`}
              style={{ width: '100%', height: '100%', maxHeight: 300, objectFit: 'contain', objectPosition: 'top', display: 'block', borderRadius: 4 }}
            />
          </div>
        )}

        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          {description ? (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#7a9cc4', textTransform: 'uppercase', marginBottom: 8 }}>
                About
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.55, color: '#d1d5db', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 320, overflowY: 'auto' }}>
                {description}
              </div>
            </>
          ) : (
            <div style={{ color: '#9ca3af', fontSize: 13 }}>No description available</div>
          )}

          {changelog && (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#7a9cc4', textTransform: 'uppercase', marginBottom: 8 }}>
                Changelog
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.5, color: '#c2c7d0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 220, overflowY: 'auto' }}>
                {changelog}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
