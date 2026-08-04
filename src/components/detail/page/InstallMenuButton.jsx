import { useEffect, useRef, useState } from 'react'
import { ACTION_BTN } from './gameDetailUtils.js'

// ── Install split button menu ────────────────────────────────────────────────
//
// The caret half of a Steam-style split button: the primary button keeps doing
// the primary thing, and this opens a menu of the alternatives beside it.
//
// It exists because the alternative -- installing from an archive or folder you
// already have -- is a real route into the library but not the common one. As its
// own full-size button it competed with INSTALL for attention and for horizontal
// space; folded INTO install it would have made one button mean two different
// things depending on whether the game happened to have download mirrors, which
// is the exact ambiguity that hid this feature in the first place.
//
// Conventions follow ui/PlaystatePicker.jsx rather than being invented here:
// outside-click closes on mousedown (not click, so it fires before a button
// inside the menu swallows it), Escape closes, the menu is absolutely positioned
// under the trigger, and colours come from CSS vars so themes apply.
//
// Desktop and mobile: the caret is 28px wide with a 36px hit height matching
// ACTION_BTN, which is comfortably tappable, and the menu is width-capped
// against the viewport so it cannot overflow a narrow window.

export default function InstallMenuButton({ items = [], label = 'More install options' }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDocPointer = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false)
    }
    const onEsc = (event) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocPointer)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocPointer)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  // Nothing to offer means no caret. A split button whose menu is empty is worse
  // than a plain one: it advertises choices that do not exist.
  const usable = items.filter((item) => item && typeof item.onSelect === 'function')
  if (usable.length === 0) return null

  const choose = (item) => {
    setOpen(false)
    item.onSelect()
  }

  return (
    <span ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); setOpen((value) => !value) }}
        style={{
          ...ACTION_BTN,
          // Square on the left so it reads as one control with the button it is
          // attached to, rounded on the right to close the pair off.
          width: 28,
          minWidth: 28,
          padding: 0,
          borderRadius: '0 2px 2px 0',
          // A hairline rather than a gap: a gap would read as two buttons that
          // happen to be adjacent.
          borderLeft: '1px solid rgba(0,0,0,0.25)',
          background: 'var(--color-detail-accent)',
          color: 'var(--color-detail-accent-text)',
        }}
        onMouseEnter={(event) => { event.currentTarget.style.filter = 'brightness(1.12)' }}
        onMouseLeave={(event) => { event.currentTarget.style.filter = 'none' }}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <i className="fas fa-caret-down" style={{ fontSize: 12 }} aria-hidden="true"></i>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 40,
            minWidth: 240,
            maxWidth: 'min(320px, 90vw)',
            background: 'var(--color-secondary)',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
            overflow: 'hidden',
          }}
        >
          {usable.map((item, index) => (
            <button
              key={item.id || item.label}
              type="button"
              role="menuitem"
              onClick={(event) => { event.stopPropagation(); choose(item) }}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%',
                padding: '10px 12px', textAlign: 'left',
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--color-text)',
                borderTop: index > 0 ? '1px solid var(--color-border)' : 'none',
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.background = 'var(--color-tertiary, var(--color-selected))'
              }}
              onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent' }}
            >
              {item.icon && (
                <i
                  className={item.icon}
                  style={{ width: 16, textAlign: 'center', marginTop: 2, fontSize: 12 }}
                  aria-hidden="true"
                ></i>
              )}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13 }}>{item.label}</span>
                {item.description && (
                  <span
                    style={{
                      display: 'block', fontSize: 11, marginTop: 2,
                      color: 'var(--color-muted)', whiteSpace: 'normal',
                    }}
                  >
                    {item.description}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
