import PlaystatePicker from '../../ui/PlaystatePicker.jsx'
import { formatPlaytime, iconBtn } from './gameDetailUtils.js'

// One row in the Versions panel.
//
// Extracted from GameDetailPage's render so the folder button below could be
// asserted. It was previously ~40 lines of JSX inside a .map inside a 1800-line
// component, which nothing could mount.
//
// The card body is itself a <button> that selects the version, so anything
// clickable has to sit OUTSIDE it — a nested button is invalid HTML and the
// inner click does not reliably fire.
export default function VersionCard({
  version,
  isSelected,
  canManageLocalTitle,
  onSelect,
  onSetPlaystate,
  onOpenFolder,
}) {
  const installed = version.isInstalled !== false
  // The playstate control and the folder button answer to different conditions,
  // so they are asked separately. Folding them into one made the folder button
  // disappear for any row without a playstate control, which is not a state
  // either of them is describing.
  const showPlaystate = canManageLocalTitle && Boolean(version.version_id)
  // Nothing recorded means nothing to open, so there is nothing to offer. A
  // recorded path that is currently gone is a different case: the button stays,
  // disabled, because a control that vanishes explains nothing.
  const showFolder = Boolean(version.game_path)
  const folderTitle = installed
    ? `Open Folder — ${version.version || 'this version'}`
    : 'Open Folder — this version\u2019s folder is missing'

  return (
    <div className={`border transition-colors ${isSelected ? 'border-accent bg-selected' : 'border-border bg-primary'}`}>
      <button
        onClick={onSelect}
        className={`w-full text-left p-3 transition-colors ${isSelected ? 'bg-selected' : 'bg-primary hover:bg-selected'}`}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>
            {isSelected && <i className="fas fa-play" style={{ fontSize: 9, color: 'var(--color-accent,#86a8e7)' }}></i>}
            {version.version || 'Unknown version'}
            {version.source === 'steam' && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--color-muted)', border: '1px solid var(--color-border)', borderRadius: 3, padding: '1px 5px' }}>
                <i className="fab fa-steam" style={{ fontSize: 10 }}></i> Steam
              </span>
            )}
            {version.source === 'gog' && (
              <span style={{ fontSize: 10, color: 'var(--color-muted)', border: '1px solid var(--color-border)', borderRadius: 3, padding: '1px 5px' }}>GOG</span>
            )}
          </span>
          <span style={{ fontSize: 11, color: installed ? 'var(--color-success)' : 'var(--color-danger)' }}>{installed ? 'Installed' : 'Missing'}</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text)', marginTop: 3 }}>{formatPlaytime(version.version_playtime)}</div>
        <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{version.game_path || 'No path set'}</div>
      </button>
      {(showPlaystate || showFolder) && (
        // Wraps so a narrow window (or a phone) puts the folder button on its own
        // line rather than squeezing the playstate pill.
        <div style={{ padding: '6px 12px 10px', borderTop: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {showPlaystate && (
            <PlaystatePicker
              value={version.playstate}
              onChange={onSetPlaystate}
              size="sm"
            />
          )}
          {showFolder && (
            <button
              type="button"
              onClick={onOpenFolder}
              disabled={!installed}
              title={folderTitle}
              aria-label={folderTitle}
              style={iconBtn(!installed)}
              className="hover:bg-secondary hover:border-border"
            >
              <i className="fas fa-folder-open" style={{ fontSize: 13 }} aria-hidden="true"></i>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
