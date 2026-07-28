import { useEffect, useRef, useState } from 'react'

const SWATCHES = [
  '#3b82f6', '#8b5cf6', '#ec4899', '#ef4444',
  '#f59e0b', '#10b981', '#14b8a6', '#6366f1',
]

/**
 * Create or rename a collection. Also used by the "+ New Collection" entry in
 * the game context menus — native menus can't prompt for text, so the main
 * process asks the renderer to open this instead (see `pendingRecordId`).
 */
export default function CollectionModal({
  open,
  mode = 'create',
  initialName = '',
  initialColor = SWATCHES[0],
  busy = false,
  error = '',
  onSubmit,
  onCancel,
}) {
  const [name, setName] = useState(initialName)
  const [color, setColor] = useState(initialColor)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setName(initialName)
    setColor(initialColor || SWATCHES[0])
    // Focus after paint so the field is ready to type into immediately.
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open, initialName, initialColor])

  if (!open) return null

  const canSubmit = name.trim().length > 0 && !busy
  const submit = () => { if (canSubmit) onSubmit?.({ name: name.trim(), color }) }

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded border border-border bg-primary p-4 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="mb-3 text-sm font-semibold text-text">
          {mode === 'rename' ? 'Rename Collection' : 'Create a New Collection'}
        </h3>

        <label className="mb-1 block text-xs text-muted" htmlFor="collection-name">
          Name
        </label>
        <input
          id="collection-name"
          ref={inputRef}
          type="text"
          value={name}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter') submit()
            if (event.key === 'Escape') onCancel?.()
          }}
          placeholder="e.g. Currently Playing"
          className="w-full rounded-buttonTheme border border-border bg-secondary p-2 text-sm text-text focus:outline-none focus:ring-1 focus:ring-accent"
        />

        <div className="mt-3">
          <span className="mb-1 block text-xs text-muted">Tile color</span>
          <div className="flex flex-wrap gap-2">
            {SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                onClick={() => setColor(swatch)}
                title={swatch}
                aria-label={`Use color ${swatch}`}
                className={`h-7 w-7 rounded border-2 transition-transform hover:scale-110 ${
                  color === swatch ? 'border-text' : 'border-transparent'
                }`}
                style={{ background: swatch }}
              />
            ))}
          </div>
        </div>

        {error && <p className="mt-3 text-xs text-danger">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-buttonTheme bg-button px-3 py-1.5 text-sm text-text hover:bg-buttonHover"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-buttonTheme bg-accent px-3 py-1.5 text-sm text-white hover:bg-accentHover disabled:opacity-50"
          >
            {busy ? 'Saving…' : mode === 'rename' ? 'Rename' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
