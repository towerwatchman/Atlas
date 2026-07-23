import { useEffect, useRef, useState } from 'react'
import { PLAYSTATE_OPTIONS, playstateMeta, normalizePlaystate } from '../../utils/playstates.js'

// Compact playstate control used for both a single version and the whole title.
// Renders a small pill showing the current state; clicking opens a menu of the
// five states plus "Clear". Works on desktop and mobile (the menu is a simple
// absolutely-positioned list; tapping an item or outside closes it).
//
// Props:
//   value      current playstate (string | null)
//   onChange   (nextValue|null) => void   — called when a state is chosen/cleared
//   disabled   when true, renders a static pill with no menu
//   size       'sm' (default) | 'md'
//   label      optional leading label (e.g. "Title")
export default function PlaystatePicker({ value, onChange, disabled = false, size = 'sm', label = '' }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const current = normalizePlaystate(value)
  const meta = playstateMeta(current)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const pad = size === 'md' ? '4px 10px' : '2px 8px'
  const fontSize = size === 'md' ? 12 : 11

  const pill = (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: pad, fontSize,
        borderRadius: 999,
        border: '1px solid var(--color-border)',
        background: 'var(--color-primary)',
        color: meta ? meta.color : 'var(--color-muted)',
        cursor: disabled ? 'default' : 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      <i className={meta ? meta.icon : 'far fa-circle'} style={{ fontSize: fontSize - 1 }} aria-hidden="true"></i>
      {meta ? meta.label : 'Set playstate'}
      {!disabled && <i className="fas fa-caret-down" style={{ fontSize: fontSize - 2, opacity: 0.7 }} aria-hidden="true"></i>}
    </span>
  )

  if (disabled) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {label && <span style={{ fontSize, color: 'var(--color-muted)' }}>{label}</span>}
        {pill}
      </span>
    )
  }

  const choose = (next) => {
    setOpen(false)
    if (next !== current) onChange?.(next)
  }

  return (
    <span ref={rootRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {label && <span style={{ fontSize, color: 'var(--color-muted)' }}>{label}</span>}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
        title="Set playstate"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {pill}
      </button>
      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute', top: '100%', left: label ? 'auto' : 0, marginTop: 4, zIndex: 40,
            minWidth: 160,
            background: 'var(--color-secondary)',
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
            overflow: 'hidden',
          }}
        >
          {PLAYSTATE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={(e) => { e.stopPropagation(); choose(opt.value) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '8px 12px', fontSize: 12, textAlign: 'left',
                background: opt.value === current ? 'var(--color-selected)' : 'transparent',
                border: 'none', cursor: 'pointer', color: 'var(--color-text)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-tertiary, var(--color-selected))' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = opt.value === current ? 'var(--color-selected)' : 'transparent' }}
            >
              <i className={opt.icon} style={{ width: 16, textAlign: 'center', color: opt.color }} aria-hidden="true"></i>
              <span style={{ flex: 1 }}>{opt.label}</span>
              {opt.value === current && <i className="fas fa-check" style={{ fontSize: 11, color: 'var(--color-accent)' }} aria-hidden="true"></i>}
            </button>
          ))}
          {current && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); choose(null) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '8px 12px', fontSize: 12, textAlign: 'left',
                background: 'transparent', border: 'none', borderTop: '1px solid var(--color-border)',
                cursor: 'pointer', color: 'var(--color-muted)',
              }}
            >
              <i className="fas fa-xmark" style={{ width: 16, textAlign: 'center' }} aria-hidden="true"></i>
              <span style={{ flex: 1 }}>Clear</span>
            </button>
          )}
        </div>
      )}
    </span>
  )
}
