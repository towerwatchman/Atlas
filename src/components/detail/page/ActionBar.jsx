import { LAUNCH_STATE, ACTION_BTN, STEAM_GREEN, STEAM_BLUE, STEAM_YELLOW, STEAM_GRAY, iconBtn } from './gameDetailUtils.js'

export default function ActionBar({
  game, actionVersion, latestVersion, canLaunch, canOpenFolder,
  launchState, isRefreshingMedia, showInfo, canManageLocalTitle = true,
  onLaunch, onOpenFolder, onOpenProperties, onRefreshMedia,
  onOpenWebsite, onRemoveTitle, onDeleteTitle, onToggleInfo,
}) {
  const playBg =
    launchState === LAUNCH_STATE.LAUNCHING ? STEAM_YELLOW
    : launchState === LAUNCH_STATE.RUNNING ? STEAM_BLUE
    : !canLaunch ? STEAM_GRAY
    : STEAM_GREEN

  const playColor =
    launchState === LAUNCH_STATE.RUNNING ? '#8ab4f8'
    : !canLaunch ? '#888'
    : '#d2e885'

  const playLabel =
    launchState === LAUNCH_STATE.LAUNCHING
      ? <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><i className="fas fa-circle-notch fa-spin" style={{ fontSize: 11 }}></i>LAUNCHING</span>
    : launchState === LAUNCH_STATE.RUNNING
      ? <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><i className="fas fa-circle" style={{ fontSize: 9, color: '#4ade80' }}></i>RUNNING</span>
    : <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><i className="fas fa-play" style={{ fontSize: 11 }}></i>PLAY</span>

  return (
    <div className="sticky top-0 z-30 bg-primary border-b border-border" style={{
      boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
      // Pull up over the lower edge of the hero so the key-art shows behind a
      // lightly translucent, blurred bar (Steam-style). -56 ≈ this bar's height.
      marginTop: -56,
      background: 'color-mix(in srgb, var(--color-primary, #19191c) 50%, transparent)',
      backdropFilter: 'blur(6px)',
      WebkitBackdropFilter: 'blur(6px)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px' }}>

        {/* PLAY */}
        <button
          onClick={onLaunch}
          disabled={!canLaunch && launchState === LAUNCH_STATE.IDLE}
          style={{
            ...ACTION_BTN, minWidth: 130, background: playBg, color: playColor,
            cursor: launchState === LAUNCH_STATE.LAUNCHING ? 'wait'
              : launchState === LAUNCH_STATE.RUNNING ? 'default'
              : !canLaunch ? 'not-allowed' : 'pointer',
            opacity: !canLaunch && launchState === LAUNCH_STATE.IDLE ? 0.5 : 1,
          }}
          onMouseEnter={(e) => { if (canLaunch || launchState !== LAUNCH_STATE.IDLE) e.currentTarget.style.filter = 'brightness(1.12)' }}
          onMouseLeave={(e) => { e.currentTarget.style.filter = 'none' }}
        >
          {playLabel}
        </button>

        {/* UPDATE */}
        {game.isUpdateAvailable && (
          <button
            onClick={onOpenWebsite}
            style={{ ...ACTION_BTN, minWidth: 130, background: '#2f6fc0', color: '#c8e0ff' }}
            onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.12)' }}
            onMouseLeave={(e) => { e.currentTarget.style.filter = 'none' }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <i className="fas fa-arrow-up" style={{ fontSize: 11 }}></i>UPDATE
            </span>
          </button>
        )}

        {/* Version indicator */}
        {actionVersion && (
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', lineHeight: 1.25, marginLeft: 6, minWidth: 0 }}>
            {game.isUpdateAvailable && latestVersion && (
              <span style={{ fontSize: 12, fontWeight: 700, color: '#7fb4ef', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 5 }}>
                <i className="fas fa-arrow-up" style={{ fontSize: 9 }}></i>{latestVersion}
              </span>
            )}
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: '#7a8aa0', textTransform: 'uppercase' }}>Selected Version</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: actionVersion.isInstalled !== false ? '#d1d5db' : '#fca5a5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {actionVersion.version || 'Unknown'}
              {actionVersion.isInstalled === false && <span style={{ fontSize: 10, color: '#fca5a5', marginLeft: 6 }}>(missing)</span>}
            </span>
          </div>
        )}

        <div style={{ flex: 1 }} />

        {/* Icon buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, position: 'relative' }}>
          <button onClick={onOpenFolder} disabled={!canOpenFolder} title="Open Folder" style={iconBtn(!canOpenFolder)} className="hover:bg-secondary hover:border-border">
            <i className="fas fa-folder-open" style={{ fontSize: 13 }}></i>
          </button>
          {canManageLocalTitle && (
            <>
              <button onClick={onOpenProperties} title="Properties" style={iconBtn(false)} className="hover:bg-secondary hover:border-border">
                <i className="fas fa-sliders-h" style={{ fontSize: 13 }}></i>
              </button>
              <button onClick={onRefreshMedia} disabled={isRefreshingMedia} title="Refresh Media" style={iconBtn(isRefreshingMedia)} className="hover:bg-secondary hover:border-border">
                <i className={`fas fa-sync-alt ${isRefreshingMedia ? 'fa-spin' : ''}`} style={{ fontSize: 13 }}></i>
              </button>
            </>
          )}
          {game.siteUrl && (
            <button onClick={onOpenWebsite} title="Website" style={iconBtn(false)} className="hover:bg-secondary hover:border-border">
              <i className="fas fa-external-link-alt" style={{ fontSize: 13 }}></i>
            </button>
          )}
          {canManageLocalTitle && (
            <>
              <button onClick={onRemoveTitle} title="Remove Title from Library" style={iconBtn(false)} className="hover:bg-secondary hover:border-border">
                <i className="fas fa-minus-circle" style={{ fontSize: 13, color: '#fca5a5' }}></i>
              </button>
              <button onClick={onDeleteTitle} title="Delete Title and Files" style={iconBtn(false)} className="hover:bg-secondary hover:border-border">
                <i className="fas fa-trash-alt" style={{ fontSize: 13, color: '#ef4444' }}></i>
              </button>
            </>
          )}
          <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.15)', margin: '0 4px' }} />
          <button
            onClick={onToggleInfo}
            title="Game Info"
            style={{ ...iconBtn(false), background: showInfo ? 'rgba(255,255,255,0.08)' : 'transparent' }}
            className="hover:bg-secondary hover:border-border"
          >
            <i className="fas fa-info-circle" style={{ fontSize: 14 }}></i>
          </button>
        </div>
      </div>
    </div>
  )
}
