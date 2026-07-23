// Renders the stacked toasts. Fixed bottom-right, stacked upward, sitting ABOVE
// the 40px footer and the import progress bar so it never fights them. Themed
// entirely via CSS variables / Tailwind theme classes so it follows dark /
// dark-green / light.

const VARIANT_META = {
  info: { icon: 'fas fa-circle-info', accent: 'var(--color-info)' },
  success: { icon: 'fas fa-circle-check', accent: 'var(--color-success)' },
  warning: { icon: 'fas fa-triangle-exclamation', accent: 'var(--color-warning)' },
  error: { icon: 'fas fa-circle-exclamation', accent: 'var(--color-danger)' },
}

function Toast({ toast, onDismiss }) {
  const meta = VARIANT_META[toast.variant] || VARIANT_META.info
  const hasProgress = typeof toast.progress === 'number' && toast.progress !== null
  const action = toast.action

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto w-[340px] max-w-[calc(100vw-32px)] bg-primary border border-border rounded-buttonTheme shadow-lg overflow-hidden"
      style={{ borderLeft: `3px solid ${meta.accent}` }}
    >
      <div className="flex items-start gap-2 px-3 py-2">
        <i className={`${meta.icon} mt-[2px] text-[13px]`} style={{ color: meta.accent }} aria-hidden="true"></i>
        <div className="min-w-0 flex-1">
          {toast.title && <div className="text-[13px] font-semibold text-text truncate">{toast.title}</div>}
          {toast.message && <div className="text-[12px] text-muted mt-0.5 break-words">{toast.message}</div>}

          {(action || hasProgress) && (
            <div className="mt-2 flex items-center gap-2">
              {hasProgress && (
                <div className="flex-1 h-1.5 rounded bg-tertiary overflow-hidden">
                  <div
                    className="h-full"
                    style={{ width: `${Math.max(0, Math.min(100, toast.progress))}%`, background: meta.accent }}
                  />
                </div>
              )}
              {action && (
                <button
                  onClick={action.onClick}
                  disabled={action.busy || action.disabled}
                  className={`text-[12px] px-2.5 py-1 rounded-buttonTheme bg-accent hover:bg-accentHover text-white transition-colors ${
                    action.busy || action.disabled ? 'opacity-60 cursor-not-allowed' : ''
                  }`}
                >
                  {action.label}
                </button>
              )}
            </div>
          )}
        </div>

        {toast.dismissible !== false && (
          <button
            onClick={() => onDismiss(toast.id)}
            className="shrink-0 text-muted hover:text-highlight px-1 -mr-1"
            aria-label="Dismiss notification"
          >
            <i className="fas fa-times text-[12px]" aria-hidden="true"></i>
          </button>
        )}
      </div>
    </div>
  )
}

export default function ToastViewport({ toasts, onDismiss }) {
  if (!toasts || toasts.length === 0) return null
  return (
    // bottom offset clears the 40px footer + the import progress bar area.
    <div className="fixed right-4 bottom-[92px] z-[60] flex flex-col gap-2 items-end pointer-events-none">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
