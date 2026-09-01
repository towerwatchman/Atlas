import { LAUNCH_STATE, ACTION_BTN, STEAM_GREEN, STEAM_BLUE, STEAM_YELLOW, STEAM_GRAY, iconBtn, resolveActionBarRoutes } from './gameDetailUtils.js'
import GogIcon from '../../ui/GogIcon.jsx'
import SplitButtonMenu from './SplitButtonMenu.jsx'

export default function ActionBar({
  game, actionVersion, latestVersion, canLaunch,
  canInstallFromDetail = false,
  onSteamInstall = null,
  // Opens the source picker. Only ever called when there is more than one
  // source; with exactly one, the button goes straight there instead.
  onOpenInstallSources = null,
  onGogInstall = null,
  // Resolved by the caller via installSources.js, because it needs
  // Metadata.sourceOrder and the game's ids. Passed in rather than derived here
  // so ActionBar holds no copy of the rule -- the previous version derived
  // `steamInstallCta` in this body, and that second copy is what actually drove
  // the button and hid the mirrors.
  installSources = [],
  canManageWishlist = false, isWishlisted = false, wishlistBusy = false,
  canManageFavorite = false, isFavorite = false, favoriteBusy = false,
  launchState, isRefreshingMedia, canManageLocalTitle = true,
  onLaunch, onOpenProperties, onToggleWishlist, onRefreshMedia,
  onOpenWebsite, onOpenSteam, onOpenGog, onUninstallSteam, onToggleFavorite, onToggleLocalImport,
  onRemoveTitle, onDeleteTitle, onBack, onToggleEditLayout, editingLayout = false,
  onToggleInfo, showInfo = false, showBack = false,
  // Opens the mirror picker. Falls back to the old behaviour when the
  // caller has not wired it, so the button is never dead.
  onOpenUpdate = null,
}) {
  // Routing lives in gameDetailUtils.resolveActionBarRoutes so it is asserted
  // rather than expressed as a chain of || inside JSX — see the note there on
  // how the local import panel came to be unreachable.
  const routes = resolveActionBarRoutes({
    canLaunch,
    canInstallFromDetail,
    canManageLocalTitle,
    canManageWishlist,
    hasOpenUpdate: Boolean(onOpenUpdate),
    hasLocalImport: typeof onToggleLocalImport === 'function',
    installSources,
  })
  const showInstallCta = routes.showInstallCta
  // One lookup, so the handler and the label cannot disagree. They used to:
  // the click went through `installRoute` and the label through a separate
  // `steamInstallCta` expression, and only the latter decided whether the
  // button wore a Steam glyph.
  const INSTALL_HANDLERS = {
    mirrors: onOpenUpdate,
    steam: onSteamInstall,
    gog: onGogInstall,
    picker: onOpenInstallSources,
    localImport: onToggleLocalImport,
  }
  const onInstallCta = INSTALL_HANDLERS[routes.installRoute] || onToggleLocalImport
  // Manual install lives behind a caret rather than in a button of its own: it is
  // a real route into the library but not the common one, and a full-size button
  // of its own competed with the primary action for attention and width.
  //
  // The caret hangs off UPDATE when there is one, because that is the rightmost
  // primary action and the two are the same kind of thing -- get a new build in.
  // With no UPDATE it hangs off PLAY/INSTALL instead, and takes that button's
  // colour, so it is green beside PLAY and accent beside INSTALL or UPDATE.
  const showInstallMenu = routes.showInstallMenu
  const caretHost = !showInstallMenu ? 'none' : game.isUpdateAvailable ? 'update' : 'primary'
  // ── Download Version ──────────────────────────────────────────────────────
  //
  // Opens the same downloads modal the UPDATE button does: every build and
  // mirror the thread offers, so a different version can be fetched over one
  // already installed.
  //
  // Without this the modal is unreachable for an installed title with no
  // pending update. showInstallCta is `!canLaunch && canInstallFromDetail`, so
  // an installed game gets PLAY instead of INSTALL, and the only other door --
  // the UPDATE button -- renders only when game.isUpdateAvailable. Installing a
  // DIFFERENT version of something you already have was therefore impossible
  // from this page.
  //
  // It goes straight to the downloads modal rather than through the source
  // picker even when Steam or GOG are also available: the picker answers "where
  // should this come from", and this item has already answered it. Steam and GOG
  // remain reachable through the primary button.
  //
  // UpdateModal reads `f95_id || f95Id` and shows its own error when neither is
  // present, so the entry is disabled rather than hidden for a title with no
  // thread -- the route exists, this title just cannot take it, and the
  // description says so.
  const hasF95Thread = Boolean(game?.f95_id || game?.f95Id)
  const canDownloadVersion = typeof onOpenUpdate === 'function' && hasF95Thread
  // Two entries. The panel picks its own mode -- 'Install / Import Files' for
  // a catalog row, 'Update / Import Files' for a library title -- from
  // canManageWishlist, so a single handler serves both and only the wording here
  // differs.
  const installMenuItems = [
    {
      id: 'download-version',
      label: 'Download Version',
      description: canDownloadVersion
        ? 'Pick a build and mirror from the thread, including one you do not have yet.'
        : 'No F95zone thread is linked to this title, so there are no builds to list.',
      icon: 'fas fa-cloud-arrow-down',
      disabled: !canDownloadVersion,
      onSelect: canDownloadVersion ? onOpenUpdate : undefined,
    },
    {
      id: 'manual-install',
      label: 'Manual Install',
      description: canManageWishlist
        ? 'Install from an archive, folder, or executable you already have.'
        : 'Add or replace a version from an archive, folder, or executable.',
      icon: 'fas fa-file-import',
      onSelect: onToggleLocalImport,
    },
  ]
  // The INSTALL button is an INSTALL button. It used to become a Steam handoff
  // whenever a Steam mapping existed -- glyph and all -- which both hid the
  // other sources and told the user the decision had already been made. The
  // glyph is now shown only when Steam is genuinely the ONLY way in, because
  // then it is a description rather than an override.
  const soleSource = routes.installSources.length === 1 ? routes.installSources[0] : null

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
    showInstallCta && soleSource?.id === 'steam'
      ? <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><i className="fab fa-steam" style={{ fontSize: 12 }}></i>INSTALL</span>
    : showInstallCta
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

        {/* PLAY / INSTALL. Declared as a value so the caret can wrap it without
            the markup being written out twice for the wrapped and bare cases. */}
        {(() => {
          const primaryButton = (
            <button
              onClick={showInstallCta ? onInstallCta : onLaunch}
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
          )
          const updateButton = game.isUpdateAvailable ? (
            <button
              onClick={onOpenUpdate || onOpenWebsite}
              style={{ ...ACTION_BTN, minWidth: 130, background: 'var(--color-detail-accent)', color: 'var(--color-detail-accent-text)' }}
              onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.12)' }}
              onMouseLeave={(e) => { e.currentTarget.style.filter = 'none' }}
              title={onOpenUpdate ? 'Choose a download mirror' : 'Open the game\u2019s page'}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <i className="fas fa-arrow-up" style={{ fontSize: 11 }}></i>UPDATE
              </span>
            </button>
          ) : null
          return (
            <>
              {/* The caret takes the colour of whatever it hangs from, so it is
                  green beside PLAY and accent beside INSTALL or UPDATE. playBg is
                  already green only when the button really is PLAY. */}
              {caretHost === 'primary' ? (
                <SplitButtonMenu
                  label="More install options"
                  items={installMenuItems}
                  caretBackground={playBg}
                  caretColor={playColor}
                >
                  {primaryButton}
                </SplitButtonMenu>
              ) : primaryButton}

              {updateButton && (caretHost === 'update' ? (
                <SplitButtonMenu
                  label="More install options"
                  items={installMenuItems}
                  caretBackground="var(--color-detail-accent)"
                  caretColor="var(--color-detail-accent-text)"
                >
                  {updateButton}
                </SplitButtonMenu>
              ) : updateButton)}
            </>
          )
        })()}

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
                <i className={wishlistBusy ? 'fas fa-circle-notch fa-spin' : 'fas fa-bookmark'} style={{ fontSize: 11 }}></i>
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
          {/* No folder button here. It could only ever open actionVersion, from a
              bar that says nothing about which version that is; it is on each
              version card now, next to that version's playstate control. */}
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
          {onOpenGog && (
            <button onClick={onOpenGog} title="Open on GOG" style={iconBtn(false)} className="hover:bg-secondary hover:border-border">
              <GogIcon size={16} />
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
