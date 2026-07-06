import { useState } from 'react'
import {
  SUPPORTED_BANNER_SLOTS,
  BANNER_PANEL_SIDES,
} from '../../library/bannerLayout/bannerLayoutSchema.js'
import { BROWSE_MODE_ENABLED } from '../../../features.js'

// Unified banner "Layout" tab: place any field into the image OR any enabled
// panel by dragging a field chip onto a zone (or selecting a field and clicking
// a zone). The center canvas mirrors the banner's real shape — image in the
// middle with its 3x3 slot grid, panels on their sides showing their rows — so
// where you drop is where it lands. Panel styling (size/color/border) stays in
// the Panels tab; this tab is purely about field placement + per-field options.

// The nine positional image slots, laid out as they appear on the banner.
const IMAGE_SLOT_GRID = [
  ['top-left', 'top-center', 'top-right'],
  ['center-left', 'center', 'center-right'],
  ['bottom-left', 'bottom-center', 'bottom-right'],
]
// Floating slots overlap the top corners; offered in the inspector dropdown.
const PANEL_LABELS = { top: 'Top panel', right: 'Right panel', bottom: 'Bottom panel', left: 'Left panel' }
const ALIGN_LABELS = { left: 'Left', center: 'Center', right: 'Right', between: 'Space between' }

const DND_MIME = 'application/x-atlas-banner-field'

// Fields whose resolver renders an icon (so the icon-size control is relevant).
const ICON_FIELDS = new Set([
  'playtime', 'lastPlayed', 'sourceRating', 'personalRating',
  'likes', 'views', 'downloads', 'comments', 'lastUpdated', 'favorite', 'wishlist',
])

const BannerLayoutEditor = ({
  layout,
  fieldLabels,
  slotLabels,
  badgeFields,
  fieldRegistry,
  fieldCategories,
  onFieldChange,
  onResetField,
  onAddDivider,
  onRemoveField,
  onEnablePanel,
  onDisablePanel,
  eyedropperAvailable = false,
  onPickColor,
}) => {
  const [selectedFieldId, setSelectedFieldId] = useState('title')
  const [placingFieldId, setPlacingFieldId] = useState(null)
  const [dropTarget, setDropTarget] = useState(null) // key of the hovered zone

  const fields = layout.fields || []
  const panels = layout.panels || {}
  const getField = (id) => fields.find((field) => field.id === id)
  const selectedField = getField(selectedFieldId)

  const enabledPanelSides = BANNER_PANEL_SIDES.filter(
    (side) => panels[side]?.enabled && (panels[side]?.size || 0) > 0,
  )

  // ── Placement ──────────────────────────────────────────────────────────────
  const place = (fieldId, target) => {
    if (!fieldId) return
    onFieldChange(fieldId, { ...target, visible: true })
    setSelectedFieldId(fieldId)
    setPlacingFieldId(null)
    setDropTarget(null)
  }

  const handleZoneClick = (target) => {
    if (placingFieldId) place(placingFieldId, target)
  }

  const handleDrop = (event, target) => {
    event.preventDefault()
    const fieldId = event.dataTransfer.getData(DND_MIME) || event.dataTransfer.getData('text/plain')
    place(fieldId, target)
  }

  const dragProps = (fieldId) => ({
    draggable: true,
    onDragStart: (event) => {
      event.dataTransfer.setData(DND_MIME, fieldId)
      event.dataTransfer.setData('text/plain', fieldId)
      event.dataTransfer.effectAllowed = 'move'
      setSelectedFieldId(fieldId)
    },
  })

  const zoneProps = (key, target) => ({
    onDragOver: (event) => {
      event.preventDefault()
      if (dropTarget !== key) setDropTarget(key)
    },
    onDragLeave: () => setDropTarget((current) => (current === key ? null : current)),
    onDrop: (event) => handleDrop(event, target),
    onClick: () => handleZoneClick(target),
  })

  const isDropZoneActive = (key) => dropTarget === key || (placingFieldId && key)

  // ── Queries ──────────────────────────────────────────────────────────────
  const imageFieldsInSlot = (slot) =>
    fields.filter((field) => field.visible !== false && (field.region || 'image') === 'image' && field.slot === slot)

  const panelRows = (side) => {
    const inPanel = fields.filter((field) => field.visible !== false && field.region === side)
    const rowMap = new Map()
    inPanel.forEach((field) => {
      const row = field.row || 0
      if (!rowMap.has(row)) rowMap.set(row, [])
      rowMap.get(row).push(field)
    })
    return [...rowMap.entries()].sort((a, b) => a[0] - b[0])
  }
  const nextPanelRow = (side) => {
    const rows = fields.filter((f) => f.visible !== false && f.region === side).map((f) => f.row || 0)
    return rows.length ? Math.max(...rows) + 1 : 0
  }

  const placementSummary = (field) => {
    if (!field || field.visible === false) return 'Hidden'
    const region = field.region || 'image'
    if (region === 'image') return `Image · ${slotLabels[field.slot] || field.slot}`
    return `${PANEL_LABELS[region]} · row ${field.row || 0}`
  }

  // ── Small pieces ───────────────────────────────────────────────────────────
  const PlacedChip = ({ field }) => (
    <span
      {...dragProps(field.id)}
      onClick={(event) => {
        event.stopPropagation()
        setSelectedFieldId(field.id)
        setPlacingFieldId(null)
      }}
      title={field.type === 'divider' ? 'Divider line' : fieldLabels[field.id]}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] cursor-grab max-w-full ${
        selectedFieldId === field.id ? 'bg-accent text-white border-accent' : 'bg-tertiary text-text border-border'
      }`}
    >
      <span className="truncate">{field.type === 'divider' ? (field.orientation === 'vertical' ? '│ Line' : '─ Line') : fieldLabels[field.id]}</span>
      <button
        type="button"
        title="Remove from banner"
        onClick={(event) => {
          event.stopPropagation()
          onFieldChange(field.id, { visible: false })
        }}
        className="opacity-70 hover:opacity-100"
      >
        ×
      </button>
    </span>
  )

  const zoneClass = (key, base) =>
    `${base} ${isDropZoneActive(key) ? 'border-accent bg-accent/10' : 'border-border'}`

  return (
    <section className="flex flex-col flex-1 min-h-0 gap-3">
      <p className="text-xs opacity-60 flex-shrink-0">
        Drag a field from the left onto the image or a panel — or click a field, then click a zone. Panel
        sizes and colors live in the Panels tab.
        {placingFieldId && (
          <span className="ml-2 text-accent">
            Placing “{fieldLabels[placingFieldId]}” — click a zone.{' '}
            <button type="button" className="underline" onClick={() => setPlacingFieldId(null)}>cancel</button>
          </span>
        )}
      </p>

      <div className="grid grid-cols-1 xl:grid-cols-[240px_minmax(340px,1fr)_360px] gap-4 flex-1 min-h-0">
        {/* ── Palette ──────────────────────────────────────────────── */}
        <div className="space-y-3 h-full min-h-0 overflow-y-auto pr-1">
          <button
            type="button"
            onClick={() => { const id = onAddDivider?.(); if (id) { setSelectedFieldId(id); setPlacingFieldId(null) } }}
            className="w-full px-2 py-1 rounded border border-dashed border-border text-sm hover:bg-tertiary"
            title="Add a horizontal or vertical line to a panel row"
          >
            ＋ Add divider line
          </button>
          {fieldCategories.map((category) => {
            const metas = fieldRegistry.filter((meta) => meta.category === category)
            if (metas.length === 0) return null
            return (
              <div key={category}>
                <h4 className="text-xs uppercase tracking-wide opacity-60 mb-1">{category}</h4>
                <div className="space-y-1">
                  {metas.map((meta) => {
                    const field = getField(meta.id)
                    const placed = field && field.visible !== false
                    return (
                      <div
                        key={meta.id}
                        {...dragProps(meta.id)}
                        onClick={() => {
                          setSelectedFieldId(meta.id)
                          setPlacingFieldId(meta.id)
                        }}
                        className={`px-2 py-1 rounded border cursor-grab text-sm flex items-center justify-between gap-2 ${
                          selectedFieldId === meta.id ? 'border-accent bg-accent/10' : 'border-border hover:bg-tertiary'
                        }`}
                      >
                        <span className="truncate">{fieldLabels[meta.id]}</span>
                        <span className={`text-[10px] flex-shrink-0 ${placed ? 'text-accent' : 'opacity-40'}`}>
                          {placed ? placementSummary(field) : 'unplaced'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* ── Zone canvas (banner skeleton) ────────────────────────── */}
        <div className="space-y-2 h-full min-h-0 overflow-y-auto pr-1">
          {/* Top panel */}
          {enabledPanelSides.includes('top')
            ? <PanelZone side="top" />
            : <EnablePanelButton side="top" />}

          <div className="flex gap-2">
            {/* Left panel */}
            {enabledPanelSides.includes('left')
              ? <PanelZone side="left" vertical />
              : <EnablePanelButton side="left" vertical />}

            {/* Image 3x3 grid */}
            <div className="flex-1">
              <div className="text-[10px] uppercase tracking-wide opacity-50 mb-1 text-center">Image</div>
              <div className="grid grid-rows-3 gap-1" style={{ aspectRatio: `${(layout.width || 537)} / ${(layout.height || 251)}` }}>
                {IMAGE_SLOT_GRID.map((rowSlots, rowIndex) => (
                  <div key={rowIndex} className="grid grid-cols-3 gap-1">
                    {rowSlots.map((slot) => {
                      const key = `img:${slot}`
                      const chips = imageFieldsInSlot(slot)
                      return (
                        <div
                          key={slot}
                          {...zoneProps(key, { region: 'image', slot })}
                          title={slotLabels[slot]}
                          className={zoneClass(key, 'border border-dashed rounded p-1 min-h-[38px] flex flex-wrap gap-1 content-start items-start cursor-pointer transition-colors')}
                        >
                          {chips.length === 0 ? (
                            <span className="text-[9px] opacity-30 m-auto">{slotLabels[slot]}</span>
                          ) : (
                            chips.map((field) => <PlacedChip key={field.id} field={field} />)
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>

            {/* Right panel */}
            {enabledPanelSides.includes('right')
              ? <PanelZone side="right" vertical />
              : <EnablePanelButton side="right" vertical />}
          </div>

          {/* Bottom panel */}
          {enabledPanelSides.includes('bottom')
            ? <PanelZone side="bottom" />
            : <EnablePanelButton side="bottom" />}
        </div>

        {/* ── Inspector ────────────────────────────────────────────── */}
        <div className="h-full min-h-0 overflow-y-auto pr-1">
          <Inspector />
        </div>
      </div>
    </section>
  )

  // ── Sub-components (closures over state/handlers) ──────────────────────────
  function EnablePanelButton({ side, vertical }) {
    return (
      <button
        type="button"
        onClick={() => onEnablePanel?.(side)}
        className={`border border-dashed border-border rounded text-[11px] opacity-60 hover:opacity-100 hover:border-accent transition-colors flex items-center justify-center ${
          vertical ? 'w-8 self-stretch' : 'w-full py-1.5'
        }`}
        title={`Enable ${PANEL_LABELS[side]}`}
      >
        {vertical ? '＋' : `＋ Enable ${PANEL_LABELS[side]}`}
      </button>
    )
  }

  function PanelZone({ side, vertical }) {
    const rows = panelRows(side)
    return (
      <div className={`${vertical ? 'w-40' : 'w-full'} border rounded p-1.5 bg-secondary/40`} style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-center justify-between mb-1">
          <div className="text-[10px] uppercase tracking-wide opacity-50">{PANEL_LABELS[side]}</div>
          <button
            type="button"
            onClick={() => onDisablePanel?.(side)}
            title={`Remove ${PANEL_LABELS[side]}`}
            className="text-[11px] leading-none px-1.5 py-0.5 rounded bg-button hover:bg-danger hover:text-white opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </div>
        <div className="space-y-1">
          {rows.map(([row, rowFields]) => {
            const key = `panel:${side}:${row}`
            return (
              <div
                key={row}
                {...zoneProps(key, { region: side, row })}
                className={zoneClass(key, 'border border-dashed rounded p-1 min-h-[30px] flex flex-wrap gap-1 items-center cursor-pointer transition-colors')}
              >
                <span className="text-[9px] opacity-40 mr-1">r{row}</span>
                {rowFields.map((field) => <PlacedChip key={field.id} field={field} />)}
              </div>
            )
          })}
          {/* new-row drop target */}
          {(() => {
            const key = `panel:${side}:new`
            return (
              <div
                {...zoneProps(key, { region: side, row: nextPanelRow(side) })}
                className={zoneClass(key, 'border border-dashed rounded p-1 min-h-[26px] flex items-center justify-center text-[10px] opacity-50 cursor-pointer transition-colors')}
              >
                ＋ new row
              </div>
            )
          })()}
        </div>
      </div>
    )
  }

  function Inspector() {
    if (!selectedField) {
      return (
        <div className="border border-border rounded p-3 bg-secondary/60">
          <p className="text-sm opacity-60">Select a field to edit it.</p>
        </div>
      )
    }
    const field = selectedField
    const region = field.region || 'image'
    if (field.type === 'divider') {
      return (
        <div className="border border-border rounded p-3 bg-secondary/60 space-y-3">
          <div className="font-medium">{field.orientation === 'vertical' ? '│ Vertical line' : '─ Horizontal line'}</div>
          <label className="block text-sm">
            Orientation
            <select className="mt-1 w-full bg-secondary border border-border text-text rounded p-1" value={field.orientation || 'horizontal'} onChange={(e) => onFieldChange(field.id, { orientation: e.target.value })}>
              <option value="horizontal">Horizontal (full row)</option>
              <option value="vertical">Vertical</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className="block">
              Panel
              <select className="mt-1 w-full bg-secondary border border-border text-text rounded p-1" value={region} onChange={(e) => onFieldChange(field.id, { region: e.target.value })}>
                <option value="bottom">Bottom</option>
                <option value="top">Top</option>
                <option value="left">Left</option>
                <option value="right">Right</option>
              </select>
            </label>
            <label className="block">
              Row
              <input type="number" min="0" max="30" className="mt-1 w-full bg-secondary border border-border text-text rounded p-1" value={field.row ?? 0} onChange={(e) => onFieldChange(field.id, { row: Number(e.target.value) })} />
            </label>
          </div>
          <label className="block text-sm">
            Thickness ({field.lineSize ?? 2}px)
            <input type="range" min="1" max="20" step="1" className="mt-2 w-full" value={field.lineSize ?? 2} onChange={(e) => onFieldChange(field.id, { lineSize: Number(e.target.value) })} />
          </label>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className="block">
              Padding top
              <input type="number" min="0" max="48" className="mt-1 w-full bg-secondary border border-border text-text rounded p-1" value={field.padding?.top ?? 2} onChange={(e) => onFieldChange(field.id, { padding: { ...field.padding, top: Number(e.target.value) } })} />
            </label>
            <label className="block">
              Padding bottom
              <input type="number" min="0" max="48" className="mt-1 w-full bg-secondary border border-border text-text rounded p-1" value={field.padding?.bottom ?? 2} onChange={(e) => onFieldChange(field.id, { padding: { ...field.padding, bottom: Number(e.target.value) } })} />
            </label>
            <label className="block">
              Padding left
              <input type="number" min="0" max="48" className="mt-1 w-full bg-secondary border border-border text-text rounded p-1" value={field.padding?.left ?? 4} onChange={(e) => onFieldChange(field.id, { padding: { ...field.padding, left: Number(e.target.value) } })} />
            </label>
            <label className="block">
              Padding right
              <input type="number" min="0" max="48" className="mt-1 w-full bg-secondary border border-border text-text rounded p-1" value={field.padding?.right ?? 4} onChange={(e) => onFieldChange(field.id, { padding: { ...field.padding, right: Number(e.target.value) } })} />
            </label>
          </div>
          <label className="block text-sm">
            Color
            <div className="mt-1 flex items-center gap-2">
              <input type="color" onClick={(e) => e.stopPropagation()} value={/^#[0-9a-fA-F]{6}$/.test(field.lineColor || '') ? field.lineColor : '#ffffff'} onChange={(e) => onFieldChange(field.id, { lineColor: e.target.value })} className="h-8 w-9 rounded bg-transparent cursor-pointer flex-shrink-0" />
              <input type="text" value={field.lineColor ?? '#ffffff'} onChange={(e) => onFieldChange(field.id, { lineColor: e.target.value })} className="flex-1 min-w-0 bg-secondary border border-border text-text rounded p-1" placeholder="#ffffff" />
              {eyedropperAvailable && (
                <button type="button" title="Pick a color from anywhere on screen" onClick={() => onPickColor?.((color) => onFieldChange(field.id, { lineColor: color }))} className="h-8 w-8 flex-shrink-0 flex items-center justify-center rounded bg-button hover:bg-buttonHover">
                  <i className="fas fa-eye-dropper"></i>
                </button>
              )}
            </div>
          </label>
          <button type="button" onClick={() => { onRemoveField?.(field.id); setSelectedFieldId('title') }} className="w-full text-sm bg-button hover:bg-danger hover:text-white px-3 py-1.5 rounded">Remove line</button>
        </div>
      )
    }
    const updateConditions = (patch) =>
      onFieldChange(field.id, { conditions: { ...field.conditions, ...patch } })
    const updateSourceCondition = (source, enabled) => {
      const current = Array.isArray(field.conditions?.source) ? field.conditions.source : []
      updateConditions({ source: enabled ? Array.from(new Set([...current, source])) : current.filter((s) => s !== source) })
    }

    return (
      <div className="border border-border rounded p-3 bg-secondary/60 space-y-3">
        <div className="font-medium">{fieldLabels[field.id]}</div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={field.visible !== false} onChange={(e) => onFieldChange(field.id, { visible: e.target.checked })} />
          Visible on banner
        </label>

        <label className="block text-sm">
          Region
          <select
            className="mt-1 w-full bg-secondary border border-border text-text rounded p-1"
            value={region}
            onChange={(e) => onFieldChange(field.id, { region: e.target.value, visible: true })}
          >
            <option value="image">Image</option>
            {BANNER_PANEL_SIDES.map((side) => (
              <option key={side} value={side} disabled={!enabledPanelSides.includes(side)}>
                {PANEL_LABELS[side]}{enabledPanelSides.includes(side) ? '' : ' (disabled)'}
              </option>
            ))}
          </select>
        </label>

        {region === 'image' ? (
          <label className="block text-sm">
            Slot
            <select
              className="mt-1 w-full bg-secondary border border-border text-text rounded p-1"
              value={field.slot}
              onChange={(e) => onFieldChange(field.id, { slot: e.target.value, visible: true })}
            >
              {SUPPORTED_BANNER_SLOTS.map((slot) => (
                <option key={slot} value={slot}>{slotLabels[slot]}</option>
              ))}
            </select>
          </label>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm">
              Row
              <input type="number" min="0" max="30" className="mt-1 w-full bg-secondary border border-border text-text rounded p-1" value={field.row ?? 0} onChange={(e) => onFieldChange(field.id, { row: Number(e.target.value) })} />
            </label>
            <label className="block text-sm">
              Align
              <select className="mt-1 w-full bg-secondary border border-border text-text rounded p-1" value={field.align || 'left'} onChange={(e) => onFieldChange(field.id, { align: e.target.value })}>
                {Object.entries(ALIGN_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm">
            Offset X
            <input type="number" min="-400" max="400" className="mt-1 w-full bg-secondary border border-border text-text rounded p-1" value={field.offsetX ?? 0} onChange={(e) => onFieldChange(field.id, { offsetX: Number(e.target.value) })} />
          </label>
          <label className="block text-sm">
            Offset Y
            <input type="number" min="-400" max="400" className="mt-1 w-full bg-secondary border border-border text-text rounded p-1" value={field.offsetY ?? 0} onChange={(e) => onFieldChange(field.id, { offsetY: Number(e.target.value) })} />
          </label>
        </div>

        <label className="block text-sm">
          Order (within its slot/row \u2014 lower shows first)
          <input type="number" min="0" max="100" className="mt-1 w-full bg-secondary border border-border text-text rounded p-1" value={field.order ?? 0} onChange={(e) => onFieldChange(field.id, { order: Number(e.target.value) })} />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm">
            Font size
            <input type="number" min="8" max="24" className="mt-1 w-full bg-secondary border border-border text-text rounded p-1" value={field.fontSize ?? 12} onChange={(e) => onFieldChange(field.id, { fontSize: Number(e.target.value) })} />
          </label>
          <label className="flex items-end gap-2 text-sm pb-1">
            <input type="checkbox" disabled={!badgeFields.has(field.id)} checked={badgeFields.has(field.id) && field.badge === true} onChange={(e) => onFieldChange(field.id, { badge: e.target.checked })} />
            Badge style
          </label>
        </div>

        {/* Text styling */}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={field.bold === true} onChange={(e) => onFieldChange(field.id, { bold: e.target.checked })} />
            <span className="font-bold">Bold</span>
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={field.italic === true} onChange={(e) => onFieldChange(field.id, { italic: e.target.checked })} />
            <span className="italic">Italic</span>
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={field.textShadow === true} onChange={(e) => onFieldChange(field.id, { textShadow: e.target.checked })} />
            Text shadow
          </label>
        </div>

        {/* Field border */}
        <div className="grid grid-cols-2 gap-2 text-sm">
          <label className="block">
            Border size
            <input type="number" min="0" max="10" className="mt-1 w-full bg-secondary border border-border text-text rounded p-1" value={field.border?.width ?? 0} onChange={(e) => onFieldChange(field.id, { border: { ...field.border, width: Number(e.target.value) } })} />
          </label>
          <label className="block">
            Border color
            <div className="mt-1 flex items-center gap-2">
              <input type="color" onClick={(e) => e.stopPropagation()} value={/^#[0-9a-fA-F]{6}$/.test(field.border?.color || '') ? field.border.color : '#000000'} onChange={(e) => onFieldChange(field.id, { border: { ...field.border, color: e.target.value } })} className="h-8 w-9 rounded bg-transparent cursor-pointer flex-shrink-0" />
              <input type="text" value={field.border?.color ?? '#000000'} onChange={(e) => onFieldChange(field.id, { border: { ...field.border, color: e.target.value } })} className="flex-1 min-w-0 bg-secondary border border-border text-text rounded p-1" placeholder="#000000" />
              {eyedropperAvailable && (
                <button type="button" title="Pick a color from anywhere on screen" onClick={() => onPickColor?.((color) => onFieldChange(field.id, { border: { ...field.border, color } }))} className="h-8 w-8 flex-shrink-0 flex items-center justify-center rounded bg-button hover:bg-buttonHover">
                  <i className="fas fa-eye-dropper"></i>
                </button>
              )}
            </div>
          </label>
        </div>

        {/* Text color */}
        <label className="block text-sm">
          Text color
          <div className="mt-1 flex items-center gap-2">
            <input type="color" onClick={(e) => e.stopPropagation()} value={/^#[0-9a-fA-F]{6}$/.test(field.textColor || '') ? field.textColor : '#ffffff'} onChange={(e) => onFieldChange(field.id, { textColor: e.target.value })} className="h-8 w-9 rounded bg-transparent cursor-pointer flex-shrink-0" />
            <input type="text" value={field.textColor ?? ''} onChange={(e) => onFieldChange(field.id, { textColor: e.target.value })} className="flex-1 min-w-0 bg-secondary border border-border text-text rounded p-1" placeholder="(default)" />
            {eyedropperAvailable && (
              <button type="button" title="Pick a color from anywhere on screen" onClick={() => onPickColor?.((color) => onFieldChange(field.id, { textColor: color }))} className="h-8 w-8 flex-shrink-0 flex items-center justify-center rounded bg-button hover:bg-buttonHover">
                <i className="fas fa-eye-dropper"></i>
              </button>
            )}
            <button type="button" title="Clear (default)" onClick={() => onFieldChange(field.id, { textColor: '' })} className="h-8 px-2 flex-shrink-0 flex items-center justify-center rounded bg-button hover:bg-buttonHover text-xs">Clear</button>
          </div>
        </label>

        {/* Badge background color — only meaningful for badge-style fields.
            Overrides the built-in engine/status/etc. palette. */}
        {badgeFields.has(field.id) && field.badge === true && (
          <label className="block text-sm">
            Badge color
            <div className="mt-1 flex items-center gap-2">
              <input type="color" onClick={(e) => e.stopPropagation()} value={/^#[0-9a-fA-F]{6}$/.test(field.badgeColor || '') ? field.badgeColor : '#3f4043'} onChange={(e) => onFieldChange(field.id, { badgeColor: e.target.value })} className="h-8 w-9 rounded bg-transparent cursor-pointer flex-shrink-0" />
              <input type="text" value={field.badgeColor ?? ''} onChange={(e) => onFieldChange(field.id, { badgeColor: e.target.value })} className="flex-1 min-w-0 bg-secondary border border-border text-text rounded p-1" placeholder="(auto)" />
              {eyedropperAvailable && (
                <button type="button" title="Pick a color from anywhere on screen" onClick={() => onPickColor?.((color) => onFieldChange(field.id, { badgeColor: color }))} className="h-8 w-8 flex-shrink-0 flex items-center justify-center rounded bg-button hover:bg-buttonHover">
                  <i className="fas fa-eye-dropper"></i>
                </button>
              )}
              <button type="button" title="Clear (auto)" onClick={() => onFieldChange(field.id, { badgeColor: '' })} className="h-8 px-2 flex-shrink-0 flex items-center justify-center rounded bg-button hover:bg-buttonHover text-xs">Clear</button>
            </div>
          </label>
        )}

        {/* Text outline (stroke around the glyphs) */}
        <div className="grid grid-cols-2 gap-2 text-sm">
          <label className="block">
            Outline size
            <input type="number" min="0" max="8" className="mt-1 w-full bg-secondary border border-border text-text rounded p-1" value={field.outline?.width ?? 0} onChange={(e) => onFieldChange(field.id, { outline: { ...field.outline, width: Number(e.target.value) } })} />
          </label>
          <label className="block">
            Outline color
            <div className="mt-1 flex items-center gap-2">
              <input type="color" onClick={(e) => e.stopPropagation()} value={/^#[0-9a-fA-F]{6}$/.test(field.outline?.color || '') ? field.outline.color : '#000000'} onChange={(e) => onFieldChange(field.id, { outline: { ...field.outline, color: e.target.value } })} className="h-8 w-9 rounded bg-transparent cursor-pointer flex-shrink-0" />
              {eyedropperAvailable && (
                <button type="button" title="Pick a color from anywhere on screen" onClick={() => onPickColor?.((color) => onFieldChange(field.id, { outline: { ...field.outline, color } }))} className="h-8 w-8 flex-shrink-0 flex items-center justify-center rounded bg-button hover:bg-buttonHover">
                  <i className="fas fa-eye-dropper"></i>
                </button>
              )}
            </div>
          </label>
        </div>

        {/* Icon size (only for fields that render an icon) */}
        {ICON_FIELDS.has(field.id) && (
          <label className="block text-sm">
            Icon size ({Math.round((field.iconScale ?? 1) * 100)}% of text)
            <input
              type="range"
              min="0.5"
              max="3"
              step="0.1"
              className="mt-2 w-full"
              value={field.iconScale ?? 1}
              onChange={(e) => onFieldChange(field.id, { iconScale: Number(e.target.value) })}
            />
          </label>
        )}

        <button type="button" className="w-full bg-secondary border border-border text-text px-3 py-1 rounded hover:bg-tertiary" onClick={() => onResetField(field.id)}>
          Reset this field
        </button>

        <details className="text-sm">
          <summary className="cursor-pointer opacity-80">Advanced conditions</summary>
          <div className="mt-2 space-y-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={field.hideWhenEmpty === true} onChange={(e) => onFieldChange(field.id, { hideWhenEmpty: e.target.checked })} />
              Hide when empty
            </label>
            {[
              ['localOnly', 'Local only'],
              ...(BROWSE_MODE_ENABLED ? [['browseOnly', 'Browse only']] : []),
              ['wishlistOnly', 'Wishlist only'],
              ['installedOnly', 'Installed only'],
              ['uninstalledOnly', 'Uninstalled only'],
              ['updateOnly', 'Update only'],
              ['favoriteOnly', 'Favorite only'],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2">
                <input type="checkbox" checked={field.conditions?.[key] === true} onChange={(e) => updateConditions({ [key]: e.target.checked })} />
                {label}
              </label>
            ))}
            <div>
              <div className="text-xs opacity-60 mb-1">Source</div>
              {['atlas', 'f95', 'steam', 'lewdcorner'].map((source) => (
                <label key={source} className="mr-3 inline-flex items-center gap-1">
                  <input type="checkbox" checked={(field.conditions?.source || []).includes(source)} onChange={(e) => updateSourceCondition(source, e.target.checked)} />
                  {source}
                </label>
              ))}
            </div>
          </div>
        </details>
      </div>
    )
  }
}

export default BannerLayoutEditor
