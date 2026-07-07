import { LAUNCH_STATE, ACTION_BTN, STEAM_GREEN, STEAM_BLUE, STEAM_YELLOW, STEAM_GRAY, iconBtn } from './gameDetailUtils.js'

export default function ActionBar({
  game, actionVersion, latestVersion, canLaunch, canOpenFolder,
  canInstallFromDetail = false,
  canManageWishlist = false, isWishlisted = false, wishlistBusy = false,
  canManageFavorite = false, isFavorite = false, favoriteBusy = false,
  launchState, isRefreshingMedia, canManageLocalTitle = true,
  onLaunch, onOpenFolder, onOpenProperties, onToggleWishlist, onRefreshMedia,
  onOpenWebsite, onOpenSteam, onUninstallSteam, onToggleFavorite, onToggleLocalImport,
  onRemoveTitle, onDeleteTitle, onBack, onToggleEditLayout, editingLayout = false,
  onToggleInfo, showInfo = false, showBack = false,
}) {
  const showInstallCta = !canLaunch && canInstallFromDetail

  const playBg =
    showInstallCta ? 'var(--color-detail-accent)'
    : launchState === LAUNCH_STATE.LAUNCHING ? STEAM_YELLOW
    : launchState === LAUNCH_STATE.RUNNING ? STEAM_BLUE
    : !canLaunch ? STEAM_GRAY
    : STEAM_GREEN

  const playColor =
    showInstallCta ? 'var(--color-detail-accent-text)'
    : launchState === LAUNCH_STATE.RUNNING ? 'var(--color-detail-accent-text)'
    : !canLaunch ? 'var(--color-muted)'
    : 'var(--color-detail-play-text)'

  const playLabel =
    showInstallCta
      ? <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><i className="fas fa-download" style={{ fontSize: 11 }}></i>INSTALL</span>
    : launchState === LAUNCH_STATE.LAUNCHING
      ? <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><i className="fas fa-circle-notch fa-spin" style={{ fontSize: 11 }}></i>LAUNCHING</span>
    : launchState === LAUNCH_STATE.RUNNING
      ? <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><i className="fas fa-circle" style={{ fontSize: 9, color: 'var(--color-success)' }}></i>RUNNING</span>
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

        {/* BACK — shown only once the bar is stuck (scrolled); before that the
            hero shows its own top-left Back button. */}
        {showBack && (
          <button
            onClick={onBack}
            title="Back to Library"
            style={{
              ...ACTION_BTN,
              background: 'var(--color-primary, #19191c)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-border)',
              gap: 7,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.15)' }}
            onMouseLeave={(e) => { e.currentTarget.style.filter = 'none' }}
          >
            <i className="fas fa-arrow-left" style={{ fontSize: 12 }}></i>
            <span>Back</span>
          </button>
        )}

        {/* PLAY */}
        <button
          onClick={showInstallCta ? onToggleLocalImport : onLaunch}
          disabled={!showInstallCta && !canLaunch && launchState === LAUNCH_STATE.IDLE}
          style={{
            ...ACTION_BTN, minWidth: 130, background: playBg, color: playColor,
            cursor: showInstallCta ? 'pointer'
              : launchState === LAUNCH_STATE.LAUNCHING ? 'wait'
              : launchState === LAUNCH_STATE.RUNNING ? 'default'
              : !canLaunch ? 'not-allowed' : 'pointer',
            opacity: !showInstallCta && !canLaunch && launchState === LAUNCH_STATE.IDLE ? 0.5 : 1,
          }}
          onMouseEnter={(e) => { if (showInstallCta || canLaunch || launchState !== LAUNCH_STATE.IDLE) e.currentTarget.style.filter = 'brightness(1.12)' }}
          onMouseLeave={(e) => { e.currentTarget.style.filter = 'none' }}
        >
          {playLabel}
        </button>

        {/* UPDATE */}
        {game.isUpdateAvailable && (
          <button
            onClick={canManageLocalTitle ? onToggleLocalImport : onOpenWebsite}
            style={{ ...ACTION_BTN, minWidth: 130, background: 'var(--color-detail-accent)', color: 'var(--color-detail-accent-text)' }}
            onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.12)' }}
            onMouseLeave={(e) => { e.currentTarget.style.filter = 'none' }}
            title={canManageLocalTitle ? 'Open update/import panel' : 'Open update page'}
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
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-detail-accent-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 5 }}>
                <i className="fas fa-arrow-up" style={{ fontSize: 9 }}></i>{latestVersion}
              </span>
            )}
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-muted)', textTransform: 'uppercase' }}>Selected Version</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: actionVersion.isInstalled !== false ? 'var(--color-text)' : 'var(--color-danger)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {actionVersion.version || 'Unknown'}
              {actionVersion.isInstalled === false && <span style={{ fontSize: 10, color: 'var(--color-danger)', marginLeft: 6 }}>(missing)</span>}
            </span>
          </div>
        )}

        <div style={{ flex: 1 }} />

        {/* Icon buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, position: 'relative' }}>
          {canManageWishlist && (
            <button
              onClick={onToggleWishlist}
              disabled={wishlistBusy}
              title={isWishlisted ? 'Remove from Wishlist' : 'Add to Wishlist'}
              style={{
                ...ACTION_BTN,
                minWidth: 146,
                height: 32,
                background: isWishlisted ? 'var(--color-detail-wishlist-remove)' : 'var(--color-detail-wishlist-add)',
                color: isWishlisted ? 'var(--color-detail-accent-text)' : 'var(--color-detail-accent-text)',
                opacity: wishlistBusy ? 0.65 : 1,
                cursor: wishlistBusy ? 'wait' : 'pointer',
              }}
              onMouseEnter={(e) => { if (!wishlistBusy) e.currentTarget.style.filter = 'brightness(1.12)' }}
              onMouseLeave={(e) => { e.currentTarget.style.filter = 'none' }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' }}>
                <i className={wishlistBusy ? 'fas fa-circle-notch fa-spin' : 'fas fa-heart'} style={{ fontSize: 11 }}></i>
                {isWishlisted ? 'Remove from Wishlist' : 'Add to Wishlist'}
              </span>
            </button>
          )}
          {canManageFavorite && (
            <button
              onClick={onToggleFavorite}
              disabled={favoriteBusy}
              title={isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
              style={{
                ...iconBtn(favoriteBusy),
                background: isFavorite ? 'color-mix(in srgb, var(--color-detail-favorite) 14%, transparent)' : 'transparent',
                borderColor: isFavorite ? 'color-mix(in srgb, var(--color-detail-favorite) 45%, transparent)' : 'transparent',
              }}
              className="hover:bg-secondary hover:border-border"
            >
              <i
                className={favoriteBusy ? 'fas fa-circle-notch fa-spin' : isFavorite ? 'fas fa-heart' : 'far fa-heart'}
                style={{ fontSize: 14, color: isFavorite ? 'var(--color-detail-favorite)' : 'inherit' }}
              ></i>
            </button>
          )}
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
          {onOpenSteam && (
            <button onClick={onOpenSteam} title="Open in Steam" style={iconBtn(false)} className="hover:bg-secondary hover:border-border">
              <i className="fab fa-steam" style={{ fontSize: 14 }}></i>
            </button>
          )}
          {onUninstallSteam && (
            <button onClick={onUninstallSteam} title="Uninstall from Steam" style={iconBtn(false)} className="hover:bg-secondary hover:border-border">
              <i className="fas fa-unlink" style={{ fontSize: 13, color: 'var(--color-danger)' }}></i>
            </button>
          )}
          {canManageLocalTitle && (
            <>
              <button onClick={onRemoveTitle} title="Remove Title from Library" style={iconBtn(false)} className="hover:bg-secondary hover:border-border">
                <i className="fas fa-minus-circle" style={{ fontSize: 13, color: 'var(--color-danger)' }}></i>
              </button>
              <button onClick={onDeleteTitle} title="Delete Title and Files" style={iconBtn(false)} className="hover:bg-secondary hover:border-border">
                <i className="fas fa-trash-alt" style={{ fontSize: 13, color: 'var(--color-danger)' }}></i>
              </button>
            </>
          )}
          <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.15)', margin: '0 4px' }} />
          <button
            onClick={onToggleEditLayout}
            title={editingLayout ? 'Done editing layout' : 'Edit panel layout'}
            style={{ ...iconBtn(false), background: editingLayout ? 'var(--color-accent)' : 'transparent', color: editingLayout ? 'var(--color-detail-accent-text, #fff)' : 'inherit' }}
            className="hover:bg-secondary hover:border-border"
          >
            <i className="fas fa-table-cells-large" style={{ fontSize: 13 }}></i>
          </button>
          <button
            onClick={onToggleInfo}
            title="About & Description"
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
