// Shared confirmation/alert modal for the game properties window, replacing
// the native window.confirm/alert dialogs so Add / Remove / Delete actions
// all use consistent in-app modals. Two shapes:
//   - confirm: shows Cancel + a confirm button (label/tone configurable)
//   - alert  : shows a single OK button (set `alert` true, omit onConfirm)
// The body accepts a string or JSX. `tone` styles the confirm button
// ('danger' for destructive actions, 'accent' otherwise). While `busy` the
// buttons are disabled and the confirm label swaps to `busyLabel`.
export default function ConfirmModal({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  busyLabel = 'Working...',
  tone = 'accent',
  busy = false,
  alert = false,
  onConfirm,
  onCancel,
}) {
  if (!open) return null

  const confirmClass =
    tone === 'danger'
      ? 'bg-danger hover:bg-dangerHover text-white'
      : 'bg-accent hover:bg-accentHover text-white'

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4"
      onClick={() => { if (!busy) onCancel?.() }}
    >
      <div
        className="bg-secondary border border-border rounded-md max-w-lg w-full p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {title && <h2 className="text-lg font-semibold mb-3">{title}</h2>}
        <div className="text-sm whitespace-pre-line mb-4">{body}</div>
        <div className="flex justify-end gap-2">
          {!alert && (
            <button
              onClick={() => onCancel?.()}
              disabled={busy}
              className="px-4 py-1.5 bg-button hover:bg-buttonHover rounded disabled:opacity-50"
            >
              {cancelLabel}
            </button>
          )}
          <button
            onClick={() => (alert ? onCancel?.() : onConfirm?.())}
            disabled={busy}
            className={`px-4 py-1.5 rounded disabled:opacity-50 ${alert ? 'bg-button hover:bg-buttonHover' : confirmClass}`}
          >
            {busy ? busyLabel : alert ? 'OK' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
