import { useState, useEffect } from 'react'

// A 3-column panel grid for the game detail page. Each column stacks its panels
// vertically (top-to-bottom). A panel can span 1-3 columns wide; a spanning
// panel occupies its home column plus the next column(s) on that row.
//
// Layout model (backwards compatible):
//   { columns: [ [ {id,span}, ... ], [...], [...] ] }   <- current
//   { items: [ {id,span}, ... ] }                        <- prior flat (migrated)
//   { columns: [ [id,...], ... ] }                       <- legacy strings (migrated)
//
// Rendering uses an explicit CSS grid with per-panel column placement so that
// spans cross columns while each column still stacks independently.

const COLUMN_COUNT = 3
const clampSpan = (n) => Math.min(COLUMN_COUNT, Math.max(1, Number(n) || 1))

// Default: previews (span 2) in the left column; everything else stacked in the
// right column.
const DEFAULT_COLUMNS = [
  [{ id: 'previews', span: 2 }],
  [],
  [
    { id: 'versions', span: 1 },
    { id: 'rating', span: 1 },
    { id: 'details', span: 1 },
    { id: 'links', span: 1 },
    { id: 'tags', span: 1 },
  ],
]

const DEFAULT_SPAN = { previews: 2 }

// Normalize any stored layout to exactly COLUMN_COUNT columns of {id,span},
// keeping only ids that have a node, dropping duplicates, and appending any
// available-but-unplaced id to the shortest column so nothing disappears.
export function normalizeDetailLayout(layout, availableIds) {
  const available = new Set(availableIds)
  const seen = new Set()
  const columns = Array.from({ length: COLUMN_COUNT }, () => [])

  const place = (colIndex, id, span) => {
    if (!available.has(id) || seen.has(id)) return
    columns[Math.min(colIndex, COLUMN_COUNT - 1)].push({ id, span: clampSpan(span) })
    seen.add(id)
  }

  if (Array.isArray(layout?.columns)) {
    layout.columns.slice(0, COLUMN_COUNT).forEach((col, i) => {
      if (!Array.isArray(col)) return
      for (const entry of col) {
        if (typeof entry === 'string') place(i, entry, DEFAULT_SPAN[entry] || 1)
        else if (entry && typeof entry === 'object') place(i, entry.id, entry.span)
      }
    })
  } else if (Array.isArray(layout?.items)) {
    // Prior flat model: put everything in the appropriate default column.
    for (const entry of layout.items) {
      const id = typeof entry === 'string' ? entry : entry?.id
      const span = typeof entry === 'string' ? (DEFAULT_SPAN[entry] || 1) : entry?.span
      if (id === 'previews') place(0, id, span)
      else place(2, id, span)
    }
  }

  // Append any available id not yet placed to the shortest column.
  for (const id of availableIds) {
    if (seen.has(id)) continue
    let shortest = 0
    for (let i = 1; i < COLUMN_COUNT; i++) {
      if (columns[i].length < columns[shortest].length) shortest = i
    }
    place(shortest, id, DEFAULT_SPAN[id] || 1)
  }

  return { columns }
}

export default function DetailPanelGrid({ layout, panels, editing, onLayoutChange }) {
  const [drag, setDrag] = useState(null) // { id }
  const [dropTarget, setDropTarget] = useState(null) // { col, index }
  // Spans only widen a panel when the grid is actually 3-up (Tailwind `lg`,
  // 1024px). Below that the grid is a single stacked column and every panel is
  // full width, so a calc(200%) width would overflow the viewport.
  const [isWide, setIsWide] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 1024 : true))
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(min-width: 1024px)')
    const handle = () => setIsWide(mq.matches)
    handle()
    mq.addEventListener?.('change', handle)
    return () => mq.removeEventListener?.('change', handle)
  }, [])

  const availableIds = Object.keys(panels).filter((id) => panels[id] != null)
  const norm = normalizeDetailLayout(layout, availableIds)

  const commit = (columns) => onLayoutChange?.({ columns })

  const handleDrop = (col, index) => {
    if (!drag) return
    const next = norm.columns.map((c) => c.map((e) => ({ ...e })))
    let moved = null
    for (const c of next) {
      const at = c.findIndex((e) => e.id === drag.id)
      if (at !== -1) { moved = c.splice(at, 1)[0]; break }
    }
    if (!moved) return
    let insertAt = index
    if (insertAt < 0 || insertAt > next[col].length) insertAt = next[col].length
    next[col].splice(insertAt, 0, moved)
    commit(next)
    setDrag(null)
    setDropTarget(null)
  }

  const setSpan = (id, span) => {
    commit(norm.columns.map((c) => c.map((e) => (e.id === id ? { ...e, span: clampSpan(span) } : e))))
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
      {norm.columns.map((col, colIndex) => (
        <div
          key={colIndex}
          className="flex flex-col gap-6 min-h-[60px]"
          // A spanning panel widens beyond its own column; allow it to overflow
          // visually to the right without affecting the sibling column widths.
          style={{ position: 'relative' }}
          onDragOver={editing ? (e) => { e.preventDefault(); setDropTarget({ col: colIndex, index: col.length }) } : undefined}
          onDrop={editing ? (e) => { e.preventDefault(); handleDrop(colIndex, dropTarget?.col === colIndex ? dropTarget.index : col.length) } : undefined}
        >
          {col.length === 0 && editing && (
            <div className="border border-dashed border-border rounded text-xs text-muted flex items-center justify-center h-16">
              Drop a panel here
            </div>
          )}
          {col.map((entry, index) => {
            const span = clampSpan(entry.span)
            // Widen a spanning panel to cover `span` columns. Each column is
            // ~1/3 of the grid; gap is 1.5rem (gap-6). width = span cols + gaps.
            // Columns to the right of this one (0-based colIndex, COLUMN_COUNT
            // total). If the span would extend past the last column, grow the
            // panel LEFTWARD (negative left margin) so it never runs off the
            // right edge — e.g. a span-2 panel in the rightmost column covers
            // the middle+right columns instead of overflowing the viewport.
            const colsToRight = COLUMN_COUNT - 1 - colIndex
            const overflowCols = Math.max(0, span - 1 - colsToRight)
            const spanStyle = span > 1 && isWide
              ? {
                  width: `calc(${span * 100}% + ${(span - 1) * 1.5}rem)`,
                  marginLeft: overflowCols > 0 ? `calc(-${overflowCols * 100}% - ${overflowCols * 1.5}rem)` : undefined,
                  position: 'relative',
                  zIndex: 1,
                }
              : undefined
            return (
              <div
                key={entry.id}
                draggable={editing}
                onDragStart={editing ? (e) => { e.stopPropagation(); setDrag({ id: entry.id }) } : undefined}
                onDragEnd={editing ? () => { setDrag(null); setDropTarget(null) } : undefined}
                onDragOver={editing ? (e) => {
                  e.preventDefault(); e.stopPropagation()
                  const rect = e.currentTarget.getBoundingClientRect()
                  const before = e.clientY < rect.top + rect.height / 2
                  setDropTarget({ col: colIndex, index: before ? index : index + 1 })
                } : undefined}
                onDrop={editing ? (e) => {
                  e.preventDefault(); e.stopPropagation()
                  handleDrop(colIndex, dropTarget?.col === colIndex ? dropTarget.index : index)
                } : undefined}
                className={`relative ${editing ? 'cursor-move' : ''} ${drag?.id === entry.id ? 'opacity-40' : ''}`}
                style={spanStyle}
              >
                {editing && dropTarget?.col === colIndex && dropTarget?.index === index && (
                  <div className="absolute -top-3 left-0 right-0 h-0.5 bg-accent rounded" />
                )}

                {editing && (
                  <div
                    className="absolute top-2 right-2 z-10 flex items-center gap-1 bg-primary/95 border border-border rounded px-1 py-0.5 shadow"
                    draggable={false}
                    onDragStart={(e) => { e.preventDefault(); e.stopPropagation() }}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <span className="cursor-move text-muted px-1" title="Drag to reorder">
                      <i className="fas fa-up-down-left-right" aria-hidden="true"></i>
                    </span>
                    {[1, 2, 3].map((n) => (
                      <button
                        key={n}
                        onClick={(e) => { e.stopPropagation(); setSpan(entry.id, n) }}
                        title={`Span ${n} column${n > 1 ? 's' : ''}`}
                        className={`w-6 h-6 text-xs rounded ${span === n ? 'bg-accent text-white' : 'bg-secondary text-text hover:bg-selected'}`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                )}

                <div className={editing ? 'pointer-events-none outline-dashed outline-1 outline-accent/40 rounded' : ''}>
                  {panels[entry.id]}
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
