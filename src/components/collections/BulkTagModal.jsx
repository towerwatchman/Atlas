import { useEffect, useState } from 'react'
import TagChipInput from '../tags/TagChipInput.jsx'
import { useKnownTags } from '../../hooks/useKnownTags.js'

/**
 * Add and remove tags across every game in a collection.
 *
 * Applies as a diff, not a shared list: each game keeps its own tags and only
 * gains the additions / loses the removals. Setting one identical tag list
 * across a collection would destroy the per-game tags, which is never what
 * "tag everything in here" means.
 */
export default function BulkTagModal({
  open,
  collectionName = '',
  recordIds = [],
  presentTags = [],
  onClose,
  onApplied,
}) {
  const [add, setAdd] = useState([])
  const [remove, setRemove] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const knownTags = useKnownTags({ enabled: open })

  useEffect(() => {
    if (!open) return
    setAdd([])
    setRemove([])
    setError('')
    setResult(null)
    setBusy(false)
  }, [open])

  if (!open) return null

  const count = recordIds.length
  const canApply = (add.length > 0 || remove.length > 0) && count > 0 && !busy

  const apply = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await window.electronAPI.bulkEditTags({ recordIds, add, remove })
      if (!response?.success) {
        setError(response?.error || 'Failed to apply tags')
        return
      }
      setResult(response)
      onApplied?.(response)
    } catch (err) {
      setError(err?.message || 'Failed to apply tags')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded border border-border bg-primary p-4 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-text">Tag Collection</h3>
        <p className="mt-1 text-xs text-muted">
          {collectionName ? <span className="text-text">{collectionName}</span> : 'This collection'}
          {' — '}
          {count} {count === 1 ? 'game' : 'games'}. Each game keeps its own tags; only
          these changes are applied.
        </p>

        {result ? (
          <div className="mt-4 text-sm text-text">
            <p>
              Updated {result.changed} {result.changed === 1 ? 'game' : 'games'}
              {result.skipped > 0 && (
                <span className="text-muted"> ({result.skipped} already matched)</span>
              )}
              .
            </p>
            {result.failed?.length > 0 && (
              <p className="mt-2 text-xs text-danger">
                {result.failed.length} failed: {result.failed[0].error}
              </p>
            )}
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-buttonTheme bg-accent px-3 py-1.5 text-sm text-white hover:bg-accentHover"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-3">
              <label htmlFor="bulk-add" className="mb-1 block text-xs text-muted">
                Add these tags
              </label>
              <TagChipInput
                inputId="bulk-add"
                tags={add}
                onChange={setAdd}
                suggestionPool={knownTags}
                accent
                disabled={busy}
              />
            </div>

            <div className="mt-3">
              <label htmlFor="bulk-remove" className="mb-1 block text-xs text-muted">
                Remove these tags
              </label>
              {/* Suggests only tags actually present in this collection —
                  offering the whole library here would mostly be tags that
                  cannot possibly be removed. */}
              <TagChipInput
                inputId="bulk-remove"
                tags={remove}
                onChange={setRemove}
                suggestionPool={presentTags}
                placeholder="Tag to remove, then press Enter"
                disabled={busy}
              />
            </div>

            {error && <p className="mt-3 text-xs text-danger">{error}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-buttonTheme bg-button px-3 py-1.5 text-sm text-text hover:bg-buttonHover"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={apply}
                disabled={!canApply}
                className="rounded-buttonTheme bg-accent px-3 py-1.5 text-sm text-white hover:bg-accentHover disabled:opacity-50"
              >
                {busy ? 'Applying…' : `Apply to ${count}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
