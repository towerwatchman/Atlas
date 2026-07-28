import { useEffect, useRef, useState } from 'react'
import { useTagSuggestions } from '../../hooks/useKnownTags.js'

// A plain list-of-tags input: chips plus an autocompleting text field.
//
// Distinct from TagEditor, which models one game's catalog/added/removed states.
// This one has no notion of a source list — it just collects tags, which is what
// the bulk dialog's "add" and "remove" fields need.

const sameTag = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()

export default function TagChipInput({
  tags = [],
  onChange,
  suggestionPool = null,
  placeholder = 'Add a tag, then press Enter',
  accent = false,
  disabled = false,
  inputId,
}) {
  const [draft, setDraft] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef(null)
  const suggestions = useTagSuggestions(suggestionPool, draft, tags)

  useEffect(() => { setHighlight(0) }, [draft])

  const commit = (explicit = null) => {
    const incoming = explicit
      ? [explicit]
      : draft.split(/[,;|]/).map((tag) => tag.trim()).filter(Boolean)
    if (incoming.length === 0) return
    const next = [...tags]
    for (const tag of incoming) {
      if (!next.some((entry) => sameTag(entry, tag))) next.push(tag)
    }
    setDraft('')
    if (next.length !== tags.length) onChange?.(next)
  }

  const remove = (tag) => onChange?.(tags.filter((entry) => !sameTag(entry, tag)))

  const chip = accent
    ? 'border border-accent bg-accent/15 text-accent'
    : 'border border-border bg-secondary text-text'

  return (
    <div className="space-y-1.5">
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${chip}`}
            >
              {tag}
              <button
                type="button"
                onClick={() => remove(tag)}
                disabled={disabled}
                aria-label={`Remove ${tag}`}
                className="ml-0.5 opacity-60 hover:opacity-100 disabled:opacity-30"
              >
                <i className="fas fa-times text-[9px]" aria-hidden="true"></i>
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
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
              commit(suggestions[highlight] || null)
              return
            }
            if (event.key === 'Escape' && draft) {
              event.preventDefault()
              setDraft('')
              return
            }
            if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
              event.preventDefault()
              remove(tags[tags.length - 1])
            }
          }}
          onBlur={() => commit()}
          className="w-full rounded border border-border bg-secondary px-2 py-1 text-xs text-text focus:outline-none focus:ring-1 focus:ring-accent"
        />
        {suggestions.length > 0 && (
          <ul className="absolute left-0 top-full z-20 mt-1 max-h-40 w-full overflow-auto rounded border border-border bg-primary py-1 shadow-lg">
            {suggestions.map((tag, index) => (
              <li key={tag}>
                <button
                  type="button"
                  // mousedown rather than click: onBlur would otherwise fire
                  // first and commit the raw draft instead of the suggestion.
                  onMouseDown={(event) => { event.preventDefault(); commit(tag) }}
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
      </div>
    </div>
  )
}
