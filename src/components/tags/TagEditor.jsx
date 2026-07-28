import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// Editor for a game's tag list.
//
// Tags come from the catalog (atlas/f95/lewdcorner). A user can add tags and
// remove catalog ones; their list is stored as an override and wins until reset.
//
// Three states are shown distinctly, because otherwise "reset" is a mystery
// button and there is no way to tell your own tags from the scraped ones:
//   • catalog tag, still present  — plain chip
//   • user-added tag             — accent chip with a + marker
//   • catalog tag you removed    — ghosted chip below, click to restore
//
// That last row is what makes the override reversible tag by tag, rather than
// all-or-nothing via reset.

const sameTag = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
const includesTag = (list, tag) => list.some((entry) => sameTag(entry, tag))

export default function TagEditor({
  tags = [],
  catalogTags = [],
  overridden = false,
  busy = false,
  disabled = false,
  onChange,
  onReset,
  compact = false,
}) {
  const [draft, setDraft] = useState('')
  const inputRef = useRef(null)

  // Catalog tags the user has taken out — offered back rather than lost.
  const removed = useMemo(
    () => catalogTags.filter((tag) => !includesTag(tags, tag)),
    [tags, catalogTags],
  )

  const isUserAdded = useCallback(
    (tag) => !includesTag(catalogTags, tag),
    [catalogTags],
  )

  const commitDraft = () => {
    // Accept several at once so pasting a comma-separated list works.
    const incoming = draft
      .split(/[,;|]/)
      .map((tag) => tag.trim())
      .filter(Boolean)
    if (incoming.length === 0) return
    const next = [...tags]
    for (const tag of incoming) if (!includesTag(next, tag)) next.push(tag)
    setDraft('')
    if (next.length !== tags.length) onChange?.(next)
  }

  const removeTag = (tag) => onChange?.(tags.filter((entry) => !sameTag(entry, tag)))
  const restoreTag = (tag) => onChange?.([...tags, tag])

  useEffect(() => { if (!busy) inputRef.current?.blur?.() }, [busy])

  const chipBase =
    'inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors'

  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.length === 0 && (
          <span className="text-xs italic text-muted">No tags</span>
        )}
        {tags.map((tag) => {
          const added = isUserAdded(tag)
          return (
            <span
              key={tag}
              className={`${chipBase} ${
                added
                  ? 'border border-accent bg-accent/15 text-accent'
                  : 'border border-border bg-secondary text-text'
              }`}
              title={added ? 'Added by you' : 'From the catalog'}
            >
              {added && <span aria-hidden="true" className="opacity-70">+</span>}
              {tag}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  disabled={busy}
                  aria-label={`Remove ${tag}`}
                  title={`Remove ${tag}`}
                  className="ml-0.5 opacity-60 hover:opacity-100 disabled:opacity-30"
                >
                  <i className="fas fa-times text-[9px]" aria-hidden="true"></i>
                </button>
              )}
            </span>
          )
        })}
      </div>

      {!disabled && (
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={draft}
            disabled={busy}
            placeholder="Add a tag, then press Enter"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter') {
                event.preventDefault()
                commitDraft()
              }
              // Backspace on an empty box removes the last tag, the usual
              // token-field behaviour.
              if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
                event.preventDefault()
                removeTag(tags[tags.length - 1])
              }
            }}
            onBlur={commitDraft}
            className="min-w-0 flex-1 rounded border border-border bg-secondary px-2 py-1 text-xs text-text focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {overridden && onReset && (
            <button
              type="button"
              onClick={onReset}
              disabled={busy}
              title="Discard your changes and use the catalog tags again"
              className="shrink-0 rounded bg-button px-2 py-1 text-xs text-text hover:bg-buttonHover disabled:opacity-50"
            >
              Reset
            </button>
          )}
        </div>
      )}

      {removed.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-muted">
            Removed
          </span>
          {removed.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => restoreTag(tag)}
              disabled={busy || disabled}
              title={`Restore ${tag}`}
              className={`${chipBase} border border-dashed border-border text-muted line-through hover:border-accent hover:text-accent disabled:opacity-40`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
