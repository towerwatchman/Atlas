import { useState } from 'react'

// A 3-column-wide panel grid for the game detail page. Panels flow left-to-right
// and wrap into rows; each panel can span 1, 2, or 3 columns. Panels are
// identified by string ids; `panels` maps id -> rendered node (ids without a
// node are skipped, so conditional panels just omit their node).
//
// Layout model (backwards compatible):
//   { items: [ { id, span }, ... ] }          <- current
//   { columns: [[id,...],[id,...],[id,...]] }  <- legacy (migrated on read)
//
// In edit mode panels can be dragged to reorder and their span set via 1/2/3
// buttons. Persistence is the caller's responsibility (onLayoutChange).

const COLUMN_COUNT = 3
const clampSpan = (n) => Math.min(COLUMN_COUNT, Math.max(1, Number(n) || 1))

// Default order + spans when nothing is stored.
const DEFAULT_ITEMS = [
  { id: 'previews', span: 2 },
  { id: 'versions', span: 1 },
  { id: 'rating', span: 1 },
  { id: 'details', span: 1 },
  { id: 'links', span: 1 },
  { id: 'tags', span: 1 },
]

// Normalize any layout shape into an ordered items list, keeping only ids that
// have a node, dropping duplicates, and appending any available id not present
// so nothing silently disappears.
export function normalizeDetailLayout(layout, availableIds) {
  const available = new Set(availableIds)
  const seen = new Set()
  const items = []

  const pushItem = (id, span) => {
    if (!available.has(id) || seen.has(id)) return
    items.push({ id, span: clampSpan(span) })
    seen.add(id)
  }

  if (Array.isArray(layout?.items)) {
    for (const it of layout.items) {
      if (typeof it === 'string') pushItem(it, 1)
      else if (it && typeof it === 'object') pushItem(it.id, it.span)
    }
  } else if (Array.isArray(layout?.columns)) {
    // Legacy migration: flatten columns in order, default span 1 (previews 2).
    for (const col of layout.columns) {
      if (!Array.isArray(col)) continue
      for (const id of col) pushItem(id, id === 'previews' ? 2 : 1)
    }
  }

  // Append anything not yet placed, using the default span if we know one.
  for (const id of availableIds) {
    if (seen.has(id)) continue
    const def = DEFAULT_ITEMS.find((d) => d.id === id)
    pushItem(id, def ? def.span : 1)
  }

  return { items }
}

export default function DetailPanelGrid({ layout, panels, editing, onLayoutChange }) {
  const [dragId, setDragId] = useState(null)
  const [dropId, setDropId] = useState(null)

  const availableIds = Object.keys(panels).filter((id) => panels[id] != null)
  const norm = normalizeDetailLayout(layout, availableIds)

  const commit = (items) => onLayoutChange?.({ items })

  const moveBefore = (targetId) => {
    if (!dragId || dragId === targetId) return
    const items = norm.items.filter((it) => it.id !== dragId)
    const dragged = norm.items.find((it) => it.id === dragId)
    if (!dragged) return
    const at = items.findIndex((it) => it.id === targetId)
    if (at === -1) items.push(dragged)
    else items.splice(at, 0, dragged)
    commit(items)
    setDragId(null)
    setDropId(null)
  }

  const setSpan = (id, span) => {
    commit(norm.items.map((it) => (it.id === id ? { ...it, span: clampSpan(span) } : it)))
  }

  return (
    <div
      className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start"
      onDragOver={editing ? (e) => e.preventDefault() : undefined}
    >
      {norm.items.map(({ id, span }) => {
        const colClass = span >= 3 ? 'lg:col-span-3' : span === 2 ? 'lg:col-span-2' : 'lg:col-span-1'
        return (
          <div
            key={id}
            className={`relative ${colClass} ${dragId === id ? 'opacity-40' : ''}`}
            draggable={editing}
            onDragStart={editing ? () => setDragId(id) : undefined}
            onDragEnd={editing ? () => { setDragId(null); setDropId(null) } : undefined}
            onDragOver={editing ? (e) => { e.preventDefault(); setDropId(id) } : undefined}
            onDrop={editing ? (e) => { e.preventDefault(); moveBefore(id) } : undefined}
          >
            {editing && dropId === id && dragId !== id && (
              <div className="absolute -left-3 top-0 bottom-0 w-0.5 bg-accent rounded" />
            )}

            {editing && (
              <div className="absolute top-2 right-2 z-10 flex items-center gap-1 bg-primary/95 border border-border rounded px-1 py-0.5 shadow">
                <span className="cursor-move text-muted px-1" title="Drag to reorder">
                  <i className="fas fa-up-down-left-right" aria-hidden="true"></i>
                </span>
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    onClick={() => setSpan(id, n)}
                    title={`Span ${n} column${n > 1 ? 's' : ''}`}
                    className={`w-6 h-6 text-xs rounded ${span === n ? 'bg-accent text-white' : 'bg-secondary text-text hover:bg-selected'}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            )}

            <div className={editing ? 'pointer-events-none outline-dashed outline-1 outline-accent/40 rounded' : ''}>
              {panels[id]}
            </div>
          </div>
        )
      })}
    </div>
  )
}
