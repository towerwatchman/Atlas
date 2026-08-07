import GogIcon from '../../ui/GogIcon.jsx'

// ── Install source picker ────────────────────────────────────────────────────
//
// Shown when a title can be installed from more than one place. Before this,
// a Steam mapping silently claimed the INSTALL button and the F95 mirrors
// became unreachable from the detail page -- so the fix is not "add Steam
// somewhere else", it is to stop the button deciding at all when there is a
// decision to make.
//
// Deliberately NOT shown for a single source. A dialog whose only purpose is to
// have one option clicked is a step, not a choice, and adding one everywhere
// would make the common case worse to fix the uncommon one. resolveInstallAction
// in installSources.js is where that threshold lives.
//
// Manual Install is not listed. It stays on the caret beside the button, where
// it already is: this dialog answers "where do I get this game", and an archive
// the user already has on disk is a different question with a different answer.
// Two routes to the same panel would also make the caret look conditional,
// which is the shape of the bug the caret was introduced to fix.
//
// Order comes from Metadata.sourceOrder via resolveInstallSources -- the same
// key that orders media resolution. Someone who put Steam first sees Steam
// first.

const SourceIcon = ({ icon }) => {
  if (icon === 'gog') return <GogIcon size={16} />
  return <i className={icon} style={{ fontSize: 14 }} aria-hidden="true"></i>
}

export default function InstallSourceModal({
  open,
  title = '',
  sources = [],
  onSelect,
  onClose,
}) {
  if (!open || sources.length === 0) return null

  return (
    <div
      className="fixed inset-0 z-[1600] bg-black/60 flex items-center justify-center p-4"
      onClick={(event) => { if (event.target === event.currentTarget) onClose?.() }}
    >
      {/* max-w-md + w-full, and the rows are full-width buttons that stay
          tappable at a narrow width -- the detail page is reachable in a small
          window and the app ships a mobile-ish narrow layout. */}
      <div className="w-full max-w-md rounded-lg border border-border bg-primary shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-base text-text truncate">Install {title}</h2>
          <p className="text-[11px] text-muted mt-0.5">
            This game is available from more than one source.
          </p>
        </div>

        <div className="p-3 space-y-2">
          {sources.map((source) => (
            <button
              key={source.id}
              type="button"
              onClick={() => onSelect?.(source.id)}
              className="w-full flex items-start gap-3 text-left rounded border border-border p-3 transition-colors hover:bg-selected hover:border-accent"
            >
              <span className="mt-0.5 w-4 flex justify-center text-text shrink-0">
                <SourceIcon icon={source.icon} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-text">{source.label}</span>
                <span className="block text-xs text-muted mt-0.5">
                  {source.description}
                </span>
              </span>
              <i
                className="fas fa-chevron-right text-muted text-xs mt-1 shrink-0"
                aria-hidden="true"
              ></i>
            </button>
          ))}
        </div>

        <div className="px-4 py-3 border-t border-border flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-8 px-3 text-xs rounded-buttonTheme bg-button hover:bg-buttonHover text-text"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
