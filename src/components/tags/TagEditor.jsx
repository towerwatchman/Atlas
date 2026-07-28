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
  knownTags = null,
}) {
  const [draft, setDraft] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef(null)

  // Autocomplete against tags already used in the library. Without it the same
  // concept drifts into "3DCG" / "3dcg" / "3d cg" and none of them filter
  // together. Fetched lazily so the list is only paid for when a field exists.
  const [library, setLibrary] = useState(knownTags)
  useEffect(() => {
    if (knownTags) { setLibrary(knownTags); return }
    let cancelled = false
    window.electronAPI?.getKnownTags?.()
      .then((list) => { if (!cancelled) setLibrary(Array.isArray(list) ? list : []) })
      .catch(() => { if (!cancelled) setLibrary([]) })
    return () => { cancelled = true }
  }, [knownTags])

  const suggestions = useMemo(() => {
    const query = draft.trim().toLowerCase()
    if (!query || !library) return []
    return library
      .filter((tag) => tag.toLowerCase().includes(query) && !includesTag(tags, tag))
      .slice(0, 8)
  }, [draft, library, tags])

  useEffect(() => { setHighlight(0) }, [draft])

  // Catalog tags the user has taken out — offered back rather than lost.
  const removed = useMemo(
    () => catalogTags.filter((tag) => !includesTag(tags, tag)),
    [tags, catalogTags],
  )

  const isUserAdded = useCallback(
    (tag) => !includesTag(catalogTags, tag),
    [catalogTags],
  )

  const commitDraft = (explicit = null) => {
    if (explicit) {
      setDraft('')
      if (!includesTag(tags, explicit)) onChange?.([...tags, explicit])
      return
    }
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
        <div className="relative flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={draft}
            disabled={busy}
            placeholder="Add a tag, then press Enter"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'ArrowDown' && suggestions.length > 0) {
                event.preventDefault()
                setHighlight((i) => (i + 1) % suggestions.length)
                return
              }
              if (event.key === 'ArrowUp' && suggestions.length > 0) {
                event.preventDefault()
                setHighlight((i) => (i - 1 + suggestions.length) % suggestions.length)
                return
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                // Enter takes the highlighted suggestion when one is showing,
                // which is what keeps spellings consistent.
                commitDraft(suggestions[highlight] || null)
              }
              if (event.key === 'Escape' && suggestions.length > 0) {
                event.preventDefault()
                setDraft('')
              }
              // Backspace on an empty box removes the last tag, the usual
              // token-field behaviour.
              if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
                event.preventDefault()
                removeTag(tags[tags.length - 1])
              }
            }}
            onBlur={() => commitDraft()}
            className="min-w-0 flex-1 rounded border border-border bg-secondary px-2 py-1 text-xs text-text focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {suggestions.length > 0 && (
            <ul className="absolute left-0 top-full z-20 mt-1 max-h-40 w-full max-w-xs overflow-auto rounded border border-border bg-primary py-1 shadow-lg">
              {suggestions.map((tag, index) => (
                <li key={tag}>
                  <button
                    type="button"
                    // mousedown rather than click: the input's onBlur fires
                    // first otherwise and commits the raw draft instead.
                    onMouseDown={(event) => { event.preventDefault(); commitDraft(tag) }}
                    className={`block w-full px-2 py-1 text-left text-xs ${
                      index === highlight ? 'bg-selected text-accent' : 'text-text hover:bg-selected'
                    }`}
                  >
                    {tag}
                  </button>
                </li>
              ))}
            </ul>
          )}
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
