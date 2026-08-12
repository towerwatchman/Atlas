// ── Updates chooser ──────────────────────────────────────────────────────────
//
// What the nav's UPDATES button opens now. It used to open RefreshMediaModal
// directly, whose two options are two MODES of one action (fill missing
// metadata vs overwrite all of it). The two new entries are not modes of that
// action at all - one checks for a new build of Atlas, the other walks the
// library asking for download links - so adding them as two more radios beside
// "Refresh missing data only" would have made a radio group where the third
// choice changes what the confirm button does entirely.
//
// So this is a chooser, and each choice hands off. Picking the metadata refresh
// closes this and opens the existing RefreshMediaModal untouched, which is why
// that component is not modified here: it is still the per-game refresh dialog
// on the detail page, and a scope flag threaded through it to serve both would
// be a shared component with two personalities.

const ACTIONS = [
  {
    id: 'metadata',
    icon: 'fa-rotate',
    title: 'Refresh library metadata',
    body: 'Sync the game database, then re-fetch metadata and artwork. You choose whether to fill gaps or overwrite everything.',
  },
  {
    id: 'client',
    icon: 'fa-download',
    title: 'Check for client updates',
    body: 'Ask whether a newer build of Atlas is available. The result appears as a notification.',
  },
  {
    id: 'games',
    icon: 'fa-layer-group',
    title: 'Update all games',
    // The count is the point of this line. Someone with three updates and
    // someone with sixty are making very different decisions about whether to
    // start now, and the run is one they have to sit through.
    body: (count) =>
      count === 0
        ? 'No games in your library have a newer version right now.'
        : `Walk through the ${count} ${count === 1 ? 'game' : 'games'} with a newer version and queue each download. You can stop at any point.`,
    disabled: (count) => count === 0,
  },
]

export default function LibraryUpdateModal({
  open,
  updateCount = 0,
  onChoose,   // (id: 'metadata' | 'client' | 'games') => void
  onClose,
}) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ background: 'rgba(8,10,15,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose?.() }}
    >
      <div
        className="bg-secondary border border-border rounded shadow-xl w-full"
        style={{ maxWidth: 480 }}
      >
        <div className="px-5 pt-5 pb-3">
          <h2 className="text-lg font-semibold">Updates</h2>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            What would you like to update?
          </p>
        </div>

        <div className="px-5 pb-4 flex flex-col gap-2">
          {ACTIONS.map((action) => {
            const disabled = typeof action.disabled === 'function' ? action.disabled(updateCount) : false
            const body = typeof action.body === 'function' ? action.body(updateCount) : action.body
            return (
              <button
                key={action.id}
                type="button"
                disabled={disabled}
                onClick={() => onChoose?.(action.id)}
                // Cards rather than a radio list: these are three destinations,
                // not three settings, and a list that needs a separate confirm
                // button asks for two clicks where one will do. Left-aligned
                // text with the icon in its own column so a long body wraps
                // under itself rather than under the glyph.
                className={`flex items-start gap-3 p-3 border border-border rounded text-left transition-colors ${
                  disabled
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:bg-primary hover:border-accent/50'
                }`}
              >
                <span
                  className="shrink-0 h-8 w-8 inline-flex items-center justify-center rounded"
                  style={{ background: 'var(--color-primary)' }}
                >
                  <i className={`fas ${action.icon} text-sm`} aria-hidden="true"></i>
                </span>
                <span className="min-w-0">
                  <span className="block font-medium flex items-center gap-2">
                    {action.title}
                    {action.id === 'games' && updateCount > 0 && (
                      <span
                        className="text-[11px] px-1.5 py-0.5 rounded"
                        style={{ background: 'var(--color-primary)', color: 'var(--color-muted)' }}
                      >
                        {updateCount}
                      </span>
                    )}
                  </span>
                  <span className="block text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                    {body}
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="px-5 pb-5 flex justify-end">
          <button
            type="button"
            onClick={() => onClose?.()}
            className="px-4 py-2 border border-border rounded hover:bg-primary"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
