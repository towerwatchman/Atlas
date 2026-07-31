import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  SEARCH_FIELDS, SEARCH_FIELD_GROUPS, SEARCH_FIELD_IDS,
  describeSearchFieldIds, normalizeSearchFieldIds,
} from '../../utils/searchFields.js'

// The "what am I actually searching?" control that sits under the search box.
//
// It exists because `filters.type` was plumbed through the entire stack —
// useFilters, catalogIndex, the catalog union — but nothing in the UI ever set
// it. The only way to search anything but the catch-all was to know that typing
// `f95:` or `id:` worked, which was documented nowhere. So the search box gave no
// indication of its own scope, and every query silently used one fixed field set.
//
// Multi-select rather than single-select: the whole point of the setting is that
// "title + creator + id" is one scope, not three.

const SearchScopePicker = ({ fieldIds = [], defaultFieldIds = [], onChange, disabled = false }) => {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  const selected = useMemo(() => normalizeSearchFieldIds(fieldIds, defaultFieldIds), [fieldIds, defaultFieldIds])
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const isDefault = useMemo(
    () => normalizeSearchFieldIds(defaultFieldIds).join(',') === selected.join(','),
    [defaultFieldIds, selected],
  )

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = useCallback((id) => {
    const next = selectedSet.has(id)
      ? selected.filter((value) => value !== id)
      : [...selected, id]
    // Deselecting the last field would match nothing, which reads as a broken
    // search box rather than an empty scope, so the last one is sticky.
    if (next.length === 0) return
    onChange?.(normalizeSearchFieldIds(next))
  }, [onChange, selected, selectedSet])

  const grouped = useMemo(
    () => SEARCH_FIELD_GROUPS
      .map((group) => ({ group, fields: SEARCH_FIELDS.filter((field) => field.group === group) }))
      .filter((entry) => entry.fields.length > 0),
    [],
  )

  return (
    <div ref={rootRef} className="relative -webkit-app-region-no-drag">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        title="Choose which fields the search looks at"
        className="flex w-full items-center gap-2 rounded border border-border bg-tertiary px-2 py-1 text-left text-[11px] text-muted transition-colors hover:text-text disabled:opacity-40 -webkit-app-region-no-drag"
      >
        <i className="fas fa-filter shrink-0 text-[10px]" aria-hidden="true" />
        <span className="shrink-0">Searching</span>
        {/* min-w-0 + truncate so a wide selection can't stretch the sidebar on
            narrow windows; the full list is in the title attribute. */}
        <span className="min-w-0 flex-1 truncate font-semibold text-text" title={describeSearchFieldIds(selected)}>
          {describeSearchFieldIds(selected)}
        </span>
        <i className={`fas fa-chevron-${open ? 'up' : 'down'} shrink-0 text-[9px]`} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 right-0 z-[2000] mt-1 rounded border border-border bg-primary py-1 shadow-2xl"
          style={{ maxHeight: '50vh', overflowY: 'auto' }}
        >
          {grouped.map(({ group, fields }) => (
            <div key={group}>
              <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wide text-muted">
                {group}
              </div>
              {fields.map((field) => {
                const checked = selectedSet.has(field.id)
                const isLastSelected = checked && selected.length === 1
                return (
                  <button
                    key={field.id}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={checked}
                    disabled={isLastSelected}
                    onClick={() => toggle(field.id)}
                    title={isLastSelected ? 'At least one field must stay selected' : undefined}
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm text-text transition-colors hover:bg-selected disabled:opacity-50"
                  >
                    <i
                      className={`fas ${checked ? 'fa-square-check' : 'fa-square'} w-3.5 shrink-0 text-center ${checked ? 'text-text' : 'text-muted'}`}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate">{field.label}</span>
                  </button>
                )
              })}
            </div>
          ))}

          <div className="my-1 border-t border-border" />
          <button
            type="button"
            onClick={() => onChange?.(normalizeSearchFieldIds(SEARCH_FIELD_IDS))}
            className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm text-text transition-colors hover:bg-selected"
          >
            <i className="fas fa-list-check w-3.5 shrink-0 text-center text-muted" aria-hidden="true" />
            <span>Select all fields</span>
          </button>
          <button
            type="button"
            disabled={isDefault}
            onClick={() => onChange?.(normalizeSearchFieldIds(defaultFieldIds))}
            className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm text-text transition-colors hover:bg-selected disabled:opacity-40"
            title="Your default from Settings › Interface"
          >
            <i className="fas fa-rotate-left w-3.5 shrink-0 text-center text-muted" aria-hidden="true" />
            <span>Reset to my default</span>
          </button>
        </div>
      )}
    </div>
  )
}

export default SearchScopePicker
