import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ACTION_BTN } from './gameDetailUtils.js'

// ── Split button menu ────────────────────────────────────────────────────────
//
// A caret beside a primary action button, opening a menu of the alternatives.
// Wraps the button it belongs to, so the menu can be aligned to that button
// rather than to the caret.
//
// ── WHY THE MENU IS A PORTAL ────────────────────────────────────────────────
//
// The action bar is `sticky top-0 z-30`. Position plus z-index creates a
// STACKING CONTEXT, so every z-index inside the bar is resolved relative to 30 --
// the menu cannot paint above the sidebar (z-50) or anything else outside the
// bar no matter how large its own z-index is. The bar's `backdropFilter` makes it
// a containing block as well.
//
// Raising the menu's z-index therefore cannot work, and raising the BAR's would
// change what the whole detail header paints over. So the menu is portalled to
// document.body and positioned with measured coordinates, which is the same
// approach ui/ContextMenu.jsx already takes for submenus, including the
// viewport clamping and the paint-after-measuring trick below.
//
// ── ALIGNMENT ───────────────────────────────────────────────────────────────
//
// The menu's left edge sits on the host BUTTON's left edge and it grows to the
// right, so it never extends past the bottom-left corner of the button it hangs
// from. Anchoring to the caret instead would push a 240px menu left across the
// button and out the other side.

// Matches ContextMenu's edge padding so both keep the same distance from the
// window edge.
const EDGE_PADDING = 8
const MENU_MIN_WIDTH = 240
// Distance between the button and the menu.
const MENU_OFFSET = 4

/**
 * Where the menu goes, given the host button's rect and its own.
 *
 * Pure and exported so the rule is asserted rather than eyeballed -- jsdom has no
 * layout, so a component test cannot see any of this. The two requirements it
 * encodes:
 *
 *   1. The menu's left edge sits on the BUTTON's left edge and it grows right, so
 *      it never extends past the button's bottom-left corner. Anchoring to the
 *      caret instead pushed a 240px menu leftwards across the button and out the
 *      other side.
 *   2. It is offset clear of the button rather than flush against it, and clamped
 *      inside the viewport -- flipping above the button when there is no room
 *      below, which happens on a short window.
 *
 * Clamping beats requirement 1 when they conflict: a menu pushed off the right
 * edge of the window is unusable, while one starting slightly left of the button
 * is merely imperfect.
 */
export function placeSplitMenu({ anchor, panel, viewport }) {
  const edge = EDGE_PADDING
  let left = anchor.left
  const maxLeft = viewport.width - panel.width - edge
  // Only pull left when the menu would overflow; a narrow viewport can make
  // maxLeft smaller than the padding, so the lower bound is applied last.
  if (left > maxLeft) left = maxLeft
  left = Math.max(edge, left)

  let top = anchor.bottom + MENU_OFFSET
  if (top + panel.height > viewport.height - edge) {
    const above = anchor.top - panel.height - MENU_OFFSET
    top = above >= edge ? above : viewport.height - panel.height - edge
  }
  top = Math.max(edge, top)

  return { left, top }
}

export default function SplitButtonMenu({
  items = [],
  label = 'More options',
  // Painted onto the caret so it reads as part of the button it is attached to:
  // green beside PLAY, accent beside INSTALL or UPDATE.
  caretBackground = 'var(--color-detail-accent)',
  caretColor = 'var(--color-detail-accent-text)',
  children,
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState(null)
  // The wrapper starts at the host button's left edge, since the button is its
  // first child and the caret comes after it.
  const hostRef = useRef(null)
  const caretRef = useRef(null)
  const menuRef = useRef(null)

  // An item earns a place if it can be chosen, OR if it is deliberately shown
  // disabled to say the route exists but is unavailable for this title. Without
  // the second clause a disabled item would need a dummy onSelect to survive
  // this filter, which is how a "disabled" control ends up firing.
  const usable = items.filter((item) =>
    item && (typeof item.onSelect === 'function' || item.disabled === true))

  const place = useCallback(() => {
    const host = hostRef.current
    const menu = menuRef.current
    if (!host || !menu) return
    setPosition(placeSplitMenu({
      anchor: host.getBoundingClientRect(),
      panel: menu.getBoundingClientRect(),
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }))
  }, [])

  // Measured before paint, so the menu never appears at 0,0 and jump to place.
  useLayoutEffect(() => {
    if (!open) { setPosition(null); return }
    place()
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onDocPointer = (event) => {
      // The caret is outside the portalled menu, so both have to be excluded or
      // clicking the caret to close would close and immediately reopen.
      if (menuRef.current?.contains(event.target)) return
      if (caretRef.current?.contains(event.target)) return
      setOpen(false)
    }
    const onEsc = (event) => { if (event.key === 'Escape') setOpen(false) }
    // The bar is sticky and the page behind it scrolls, so a fixed menu has to
    // be told to follow. Capture, because the scroll happens on an inner
    // container rather than the window.
    const onReflow = () => place()
    document.addEventListener('mousedown', onDocPointer)
    document.addEventListener('keydown', onEsc)
    window.addEventListener('resize', onReflow)
    window.addEventListener('scroll', onReflow, true)
    return () => {
      document.removeEventListener('mousedown', onDocPointer)
      document.removeEventListener('keydown', onEsc)
      window.removeEventListener('resize', onReflow)
      window.removeEventListener('scroll', onReflow, true)
    }
  }, [open, place])

  // Nothing to offer means no caret. A split button whose menu is empty is worse
  // than a plain one: it advertises choices that do not exist.
  if (usable.length === 0) return <>{children}</>

  const choose = (item) => {
    // A disabled item is inert: it neither runs nor closes the menu, so the
    // reason text stays on screen where the user just clicked.
    if (item.disabled === true || typeof item.onSelect !== 'function') return
    setOpen(false)
    item.onSelect()
  }

  return (
    <span
      ref={hostRef}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        // A small gap, NOT flush. The caret is its own control and reads as one.
        // The surrounding row uses gap: 8, which is too wide to group the two, so
        // the pair is its own flex child with a tighter gap of its own.
        gap: 4,
        flexShrink: 0,
      }}
    >
      {children}
      <button
        ref={caretRef}
        type="button"
        onClick={(event) => { event.stopPropagation(); setOpen((value) => !value) }}
        style={{
          ...ACTION_BTN,
          width: 30,
          minWidth: 30,
          padding: 0,
          // Fully rounded: detached from the button, so it keeps its own corners.
          borderRadius: 2,
          background: caretBackground,
          color: caretColor,
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

      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{
            position: 'fixed',
            left: position?.left ?? 0,
            top: position?.top ?? 0,
            // Above the sidebar and the sticky bar. Matches the band
            // ui/ContextMenu.jsx uses for the same reason.
            zIndex: 3001,
            minWidth: MENU_MIN_WIDTH,
            maxWidth: `min(320px, calc(100vw - ${EDGE_PADDING * 2}px))`,
            background: 'var(--color-secondary)',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
            overflow: 'hidden',
            // Hidden until measured, so it is never briefly visible in the wrong
            // place. It still occupies layout, which is what lets it be measured.
            visibility: position ? 'visible' : 'hidden',
          }}
        >
          {usable.map((item, index) => (
            <button
              key={item.id || item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled === true}
              aria-disabled={item.disabled === true || undefined}
              onClick={(event) => { event.stopPropagation(); choose(item) }}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%',
                padding: '10px 12px', textAlign: 'left',
                background: 'transparent', border: 'none',
                cursor: item.disabled === true ? 'not-allowed' : 'pointer',
                color: 'var(--color-text)',
                // Dimmed rather than hidden: the route exists, it just cannot be
                // taken for this title, and the description says why.
                opacity: item.disabled === true ? 0.5 : 1,
                borderTop: index > 0 ? '1px solid var(--color-border)' : 'none',
              }}
              onMouseEnter={(event) => {
                if (item.disabled === true) return
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
        </div>,
        document.body,
      )}
    </span>
  )
}
