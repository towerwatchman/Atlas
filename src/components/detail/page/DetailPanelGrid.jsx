import { useState } from 'react'

// Row + column-band layout for the game detail page.
//
// The page is a vertical stack of "rows". Each row is either:
//   { type: 'full',    panels: [id, ...] }                          full-width
//   { type: 'columns', columns: [{ width }], cells: [[id,...], ...] } a band
//
// In a column band, panels stack vertically inside their column and never span
// across columns, so panels can never overlap. Full-width panels live in their
// own 'full' row. The LEFTMOST column of every band is locked to Flexible (1fr)
// so it always fills leftover space. Other columns can be Auto / Flex / Fixed.
//
// Column width modes:
//   { mode: 'flex' }              -> 1fr  (grows, shares leftover space)
//   { mode: 'auto' }              -> auto (only as wide as its content)
//   { mode: 'fixed', px: 320 }    -> fixed pixel width
//
// Legacy layouts ({items:[...]} or {columns:[[...]]}) are migrated on read.

const MIN_COLS = 1
const MAX_COLS = 5
const DEFAULT_FIXED_PX = 320
const DEFAULT_SPAN = { previews: 2 } // only used when migrating very old data

export const DEFAULT_DETAIL_LAYOUT = {
  rows: [
    {
      type: 'columns',
      columns: [{ mode: 'flex' }, { mode: 'auto' }, { mode: 'fixed', px: 340 }],
      cells: [
        ['previews'],
        [],
        ['versions', 'rating', 'details', 'links', 'tags'],
      ],
    },
  ],
}

const colWidthToTrack = (col, isLeftmost) => {
  // Leftmost column is always flexible so it fills leftover space.
  if (isLeftmost) return 'minmax(0, 1fr)'
  if (!col || col.mode === 'flex') return 'minmax(0, 1fr)'
  if (col.mode === 'fixed') return `${Math.max(120, Number(col.px) || DEFAULT_FIXED_PX)}px`
  return 'auto'
}

// Normalize any stored layout into the rows model, keeping only ids that have a
// node, dropping duplicates, and appending any available-but-unplaced id to the
// last column of the last column-band (or a new band) so nothing disappears.
export function normalizeDetailLayout(layout, availableIds) {
  const available = new Set(availableIds)
  const seen = new Set()

  const cleanId = (id) => (available.has(id) && !seen.has(id) ? (seen.add(id), true) : false)

  let rows = []

  if (Array.isArray(layout?.rows)) {
    for (const row of layout.rows) {
      if (!row || typeof row !== 'object') continue
      if (row.type === 'full') {
        const panels = (Array.isArray(row.panels) ? row.panels : []).filter(cleanId)
        rows.push({ type: 'full', panels })
      } else if (row.type === 'columns') {
        const cols = Array.isArray(row.columns) ? row.columns : []
        const cells = Array.isArray(row.cells) ? row.cells : []
        const n = Math.min(MAX_COLS, Math.max(MIN_COLS, Math.max(cols.length, cells.length, 1)))
        const columns = []
        const outCells = []
        for (let i = 0; i < n; i++) {
          columns.push(cols[i] && typeof cols[i] === 'object' ? { mode: cols[i].mode || 'flex', px: cols[i].px } : { mode: i === 0 ? 'flex' : 'auto' })
          outCells.push((Array.isArray(cells[i]) ? cells[i] : []).filter(cleanId))
        }
        rows.push({ type: 'columns', columns, cells: outCells })
      }
    }
  } else if (Array.isArray(layout?.columns)) {
    // Legacy column model -> single band.
    const cells = layout.columns.slice(0, MAX_COLS).map((col) =>
      (Array.isArray(col) ? col : [])
        .map((e) => (typeof e === 'string' ? e : e?.id))
        .filter((id) => id && cleanId(id)),
    )
    const columns = cells.map((_, i) => ({ mode: i === 0 ? 'flex' : 'auto' }))
    rows.push({ type: 'columns', columns, cells })
  } else if (Array.isArray(layout?.items)) {
    // Legacy flat model -> single 3-col band, previews left, rest right.
    const left = []
    const right = []
    for (const it of layout.items) {
      const id = typeof it === 'string' ? it : it?.id
      if (!id || !cleanId(id)) continue
      if (id === 'previews') left.push(id)
      else right.push(id)
    }
    rows.push({ type: 'columns', columns: [{ mode: 'flex' }, { mode: 'auto' }, { mode: 'fixed', px: 340 }], cells: [left, [], right] })
  }

  // Ensure at least one column band exists to receive leftovers.
  if (!rows.some((r) => r.type === 'columns')) {
    rows.push({ type: 'columns', columns: [{ mode: 'flex' }], cells: [[]] })
  }

  // Append any unplaced ids to the last column of the last band.
  const lastBand = [...rows].reverse().find((r) => r.type === 'columns')
  for (const id of availableIds) {
    if (seen.has(id)) continue
    lastBand.cells[lastBand.cells.length - 1].push(id)
    seen.add(id)
  }

  // Drop empty full rows.
  rows = rows.filter((r) => r.type !== 'full' || r.panels.length > 0)
  if (rows.length === 0) rows = [{ type: 'columns', columns: [{ mode: 'flex' }], cells: [[]] }]

  return { rows }
}

export default function DetailPanelGrid({ layout, panels, editing, onLayoutChange }) {
  const [drag, setDrag] = useState(null) // { id }

  const availableIds = Object.keys(panels).filter((id) => panels[id] != null)
  const norm = normalizeDetailLayout(layout, availableIds)

  const commit = (rows) => onLayoutChange?.({ rows })

  // Remove an id from wherever it currently sits (mutates a deep copy).
  const removeFrom = (rows, id) => {
    for (const row of rows) {
      if (row.type === 'full') {
        const at = row.panels.indexOf(id)
        if (at !== -1) { row.panels.splice(at, 1); return }
      } else {
        for (const cell of row.cells) {
          const at = cell.indexOf(id)
          if (at !== -1) { cell.splice(at, 1); return }
        }
      }
    }
  }

  const clone = () => norm.rows.map((r) =>
    r.type === 'full'
      ? { type: 'full', panels: r.panels.slice() }
      : { type: 'columns', columns: r.columns.map((c) => ({ ...c })), cells: r.cells.map((c) => c.slice()) },
  )

  const dropIntoCell = (rowIndex, colIndex) => {
    if (!drag) return
    const rows = clone()
    removeFrom(rows, drag.id)
    rows[rowIndex].cells[colIndex].push(drag.id)
    commit(rows)
    setDrag(null)
  }

  const dropIntoFull = (rowIndex) => {
    if (!drag) return
    const rows = clone()
    removeFrom(rows, drag.id)
    rows[rowIndex].panels.push(drag.id)
    commit(rows)
    setDrag(null)
  }

  const dropIntoNewFull = (position) => {
    if (!drag) return
    const rows = clone()
    removeFrom(rows, drag.id)
    const row = { type: 'full', panels: [drag.id] }
    if (position === 'top') rows.unshift(row)
    else rows.push(row)
    commit(rows)
    setDrag(null)
  }

  const addColumn = (rowIndex) => {
    const rows = clone()
    const band = rows[rowIndex]
    if (band.columns.length >= MAX_COLS) return
    band.columns.push({ mode: 'auto' })
    band.cells.push([])
    commit(rows)
  }

  const removeColumn = (rowIndex, colIndex) => {
    const rows = clone()
    const band = rows[rowIndex]
    if (band.columns.length <= MIN_COLS) return
    // Move this column's panels into the neighboring column (left, or right if
    // removing the first) so nothing is lost.
    const target = colIndex > 0 ? colIndex - 1 : 1
    band.cells[target] = band.cells[target].concat(band.cells[colIndex])
    band.columns.splice(colIndex, 1)
    band.cells.splice(colIndex, 1)
    commit(rows)
  }

  const setColMode = (rowIndex, colIndex, mode) => {
    const rows = clone()
    rows[rowIndex].columns[colIndex] = { mode, px: mode === 'fixed' ? (rows[rowIndex].columns[colIndex].px || DEFAULT_FIXED_PX) : undefined }
    commit(rows)
  }

  const setColPx = (rowIndex, colIndex, px) => {
    const rows = clone()
    rows[rowIndex].columns[colIndex] = { mode: 'fixed', px: Math.max(120, Number(px) || DEFAULT_FIXED_PX) }
    commit(rows)
  }

  const renderPanel = (id) => (
    <div
      key={id}
      draggable={editing}
      onDragStart={editing ? (e) => { e.stopPropagation(); setDrag({ id }) } : undefined}
      onDragEnd={editing ? () => setDrag(null) : undefined}
      className={`relative ${editing ? 'cursor-move' : ''} ${drag?.id === id ? 'opacity-40' : ''}`}
    >
      {editing && (
        <div className="absolute top-2 right-2 z-10 bg-accent text-white text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 pointer-events-none">
          <i className="fas fa-up-down-left-right" aria-hidden="true"></i> Drag
        </div>
      )}
      <div className={editing ? 'pointer-events-none outline-dashed outline-1 outline-accent/40 rounded' : ''}>
        {panels[id]}
      </div>
    </div>
  )

  const dropZone = (label, onDropFn) => (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); onDropFn() }}
      className="border border-dashed border-accent/50 rounded text-xs text-muted flex items-center justify-center h-12 my-2"
    >
      {label}
    </div>
  )

  return (
    <div className="flex flex-col gap-6">
      {editing && drag && dropZone('Drop here for a full-width row (top)', () => dropIntoNewFull('top'))}

      {norm.rows.map((row, rowIndex) => {
        if (row.type === 'full') {
          return (
            <div
              key={`full-${rowIndex}`}
              onDragOver={editing ? (e) => e.preventDefault() : undefined}
              onDrop={editing ? (e) => { e.preventDefault(); dropIntoFull(rowIndex) } : undefined}
              className={editing ? 'rounded outline-dashed outline-1 outline-border p-2' : ''}
            >
              {editing && <div className="text-[11px] uppercase tracking-wide text-muted mb-2">Full-width row</div>}
              <div className="flex flex-col gap-6">
                {row.panels.length === 0 && editing
                  ? <div className="text-xs text-muted h-10 flex items-center justify-center">Drop a panel here</div>
                  : row.panels.map(renderPanel)}
              </div>
            </div>
          )
        }

        const template = row.columns.map((c, i) => colWidthToTrack(c, i === 0)).join(' ')
        return (
          <div key={`cols-${rowIndex}`} className={editing ? 'rounded outline-dashed outline-1 outline-border p-2' : ''}>
            {editing && (
              <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
                <span className="uppercase tracking-wide text-muted">Columns:</span>
                <button onClick={() => addColumn(rowIndex)} disabled={row.columns.length >= MAX_COLS}
                  className="px-2 py-1 rounded bg-secondary border border-border hover:bg-selected disabled:opacity-40">
                  <i className="fas fa-plus mr-1" />Add column
                </button>
                <span className="text-muted">({row.columns.length}/{MAX_COLS})</span>
              </div>
            )}

            {editing && (
              <div className="grid gap-3 mb-3" style={{ gridTemplateColumns: template }}>
                {row.columns.map((col, colIndex) => {
                  const isLeft = colIndex === 0
                  return (
                    <div key={colIndex} className="border border-border rounded bg-primary/60 p-2 text-xs">
                      <div className="font-semibold mb-1">Col {colIndex + 1}{isLeft && ' (fills space)'}</div>
                      {isLeft ? (
                        <div className="text-muted">Flexible &mdash; locked</div>
                      ) : (
                        <div className="flex flex-col gap-1">
                          <div className="flex gap-1">
                            {['auto', 'flex', 'fixed'].map((m) => (
                              <button key={m} onClick={() => setColMode(rowIndex, colIndex, m)}
                                className={`px-2 py-0.5 rounded capitalize ${col.mode === m ? 'bg-accent text-white' : 'bg-secondary hover:bg-selected'}`}>
                                {m}
                              </button>
                            ))}
                          </div>
                          {col.mode === 'fixed' && (
                            <label className="flex items-center gap-1 mt-1">
                              <input type="number" min="120" max="1200" step="20" value={col.px || DEFAULT_FIXED_PX}
                                onChange={(e) => setColPx(rowIndex, colIndex, e.target.value)}
                                className="w-20 bg-secondary border border-border rounded px-1 py-0.5" />
                              <span className="text-muted">px</span>
                            </label>
                          )}
                          <button onClick={() => removeColumn(rowIndex, colIndex)} disabled={row.columns.length <= MIN_COLS}
                            className="mt-1 px-2 py-0.5 rounded bg-danger/80 text-white hover:bg-danger disabled:opacity-40">
                            Remove
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            <div className="grid gap-6 items-start" style={{ gridTemplateColumns: template }}>
              {row.cells.map((cell, colIndex) => (
                <div
                  key={colIndex}
                  className="flex flex-col gap-6 min-w-0"
                  style={{ minHeight: editing ? 60 : undefined }}
                  onDragOver={editing ? (e) => e.preventDefault() : undefined}
                  onDrop={editing ? (e) => { e.preventDefault(); dropIntoCell(rowIndex, colIndex) } : undefined}
                >
                  {cell.length === 0 && editing && (
                    <div className="border border-dashed border-border rounded text-xs text-muted flex items-center justify-center h-16">
                      Drop a panel here
                    </div>
                  )}
                  {cell.map(renderPanel)}
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {editing && drag && dropZone('Drop here for a full-width row (bottom)', () => dropIntoNewFull('bottom'))}
    </div>
  )
}
