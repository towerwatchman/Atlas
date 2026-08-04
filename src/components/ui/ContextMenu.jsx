import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Custom context menu, replacing Electron's native one for game rows.
//
// Native menus are drawn by the OS and cannot be styled at all — no accent
// colour on Play, no theme awareness. They also ignore a click on any item that
// has a submenu, which is why the old menu needed a separate "Play (v1.2)" entry
// alongside a "Play Version" submenu. Both limitations go away here.
//
// Submenus are rendered into a PORTAL rather than nested inside their parent
// panel. They used to be absolutely positioned children at left:100%, which
// worked one level deep but not two: a submenu panel needs overflow-y:auto so a
// long collection list can scroll, and any overflow value other than `visible`
// makes that panel a clipping box. So "Manage ▸ Remove from Collection ▸ …" was
// drawn outside its scrolling parent and clipped to nothing — it looked like a
// z-index problem but no z-index could have fixed it, because the pixels were
// never painted. A portal takes each panel out of every ancestor's clip box,
// which also means each one can be flipped and clamped against the real viewport
// on its own instead of sharing one decision made from the root's position.
//
// Item shape:
//   { label, icon?, variant?: 'play', data?, submenu?, disabled?, danger?, hint? }
//   { type: 'separator' }

const MENU_MIN_WIDTH = 200
const EDGE_PADDING = 8
const SUBMENU_GAP = 2

// Link icons arrive as full Font Awesome classes ('fab fa-steam'), while the
// menu's own icons are bare glyph names ('fa-play'). Prefixing a bare name with
// `fas` is right; prefixing 'fab fa-steam' with it silently breaks the glyph.
const iconClassName = (icon) =>
  /(?:^|\s)(fas|far|fab|fal|fad|fa-solid|fa-regular|fa-brands)(?:\s|$)/.test(icon)
    ? icon
    : `fas ${icon}`

export default function ContextMenu({ open, x = 0, y = 0, items = [], onClose, onAction }) {
  const rootRef = useRef(null)
  // Portaled panels are not DOM descendants of rootRef, so the outside-click
  // check has to know about them or clicking any submenu item would close the
  // menu on pointerdown before the click ever landed.
  const panelsRef = useRef(new Set())
  const [position, setPosition] = useState({ left: x, top: y })
  // One open key PER DEPTH. A single value meant a nested submenu (Manage ▸
  // Remove from Collection ▸ …) set the key to its own, which made the parent's
  // condition false and unmounted the branch the cursor was inside.
  const [openPath, setOpenPath] = useState([])

  const registerPanel = useCallback((node) => {
    if (!node) return undefined
    panelsRef.current.add(node)
    return () => panelsRef.current.delete(node)
  }, [])

  // onClose read through a ref so it is NOT an effect dependency.
  //
  // The call site passes `onClose={() => setGameMenu(null)}` - a new function on
  // every parent render - and the listener effect below both listed onClose in
  // its dependencies and reset the open submenu path in its body. So anything
  // that re-rendered App closed the open submenu, wherever the cursor was. The
  // import progress bar was the visible symptom because it ticks several times a
  // second, but any parent state at any cadence did it.
  //
  // A ref rather than asking the caller for a useCallback: a menu that only stays
  // open while its parent happens not to re-render is not a fixed menu, and the
  // next call site would reintroduce it. The ref is kept current on every render,
  // so `close` is stable AND never stale.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])
  const close = useCallback(() => onCloseRef.current?.(), [])

  // Measured after paint so the real height is known before deciding to clamp.
  useLayoutEffect(() => {
    if (!open || !rootRef.current) return
    const rect = rootRef.current.getBoundingClientRect()
    const maxLeft = window.innerWidth - rect.width - EDGE_PADDING
    const maxTop = window.innerHeight - rect.height - EDGE_PADDING
    setPosition({
      left: Math.max(EDGE_PADDING, Math.min(x, maxLeft)),
      top: Math.max(EDGE_PADDING, Math.min(y, maxTop)),
    })
  }, [open, x, y, items])

  // Collapsing the submenus is tied to the menu OPENING, which is the only thing
  // that should reset navigation. It used to live in the listener effect below,
  // where it ran again on every re-registration - and the listeners re-registered
  // on every parent render. Reopening on a different game must still start fresh,
  // since the component is never unmounted (it returns null while closed) and the
  // path would otherwise persist.
  useEffect(() => {
    if (open) setOpenPath([])
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    }
    // `capture` so the menu closes before an underlying element handles the
    // click; without it a right-click elsewhere reopens before this closes.
    const onPointerDown = (event) => {
      if (rootRef.current?.contains(event.target)) return
      for (const panel of panelsRef.current) {
        if (panel.contains(event.target)) return
      }
      close()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
    // `close` is stable, so these listeners are registered once per open rather
    // than once per parent render.
  }, [open, close])

  const run = useCallback((item) => {
    if (!item || item.disabled) return
    close()
    if (item.data) onAction?.(item.data)
    else item.onSelect?.()
  }, [onAction, close])

  if (!open) return null

  const renderItem = (item, index, depth = 0) => {
    if (item.type === 'separator') {
      return <div key={`sep-${depth}-${index}`} className="my-1 border-t border-border" />
    }
    const hasSubmenu = Array.isArray(item.submenu) && item.submenu.length > 0
    const isPlay = item.variant === 'play'
    const submenuKey = `${depth}-${index}`
    const showSubmenu = hasSubmenu && openPath[depth] === submenuKey

    const openThis = () =>
      setOpenPath((current) => {
        const next = current.slice(0, depth)
        if (hasSubmenu) next[depth] = submenuKey
        return next
      })

    return (
      <SubmenuAnchor
        key={submenuKey}
        onHover={openThis}
        showSubmenu={showSubmenu}
        registerPanel={registerPanel}
        submenu={showSubmenu ? item.submenu.map((child, i) => renderItem(child, i, depth + 1)) : null}
      >
        <button
          type="button"
          disabled={item.disabled}
          // A parent with a submenu is still clickable — that is the point of
          // not using a native menu. Clicking Play launches; hovering reveals
          // the other versions.
          onClick={() => {
            if (item.data || item.onSelect) run(item)
            else openThis()
          }}
          className={`flex w-full items-center gap-2.5 px-3 text-left text-sm transition-colors disabled:opacity-40 ${
            isPlay
              ? 'mb-1 rounded-sm bg-[#2e7d32] py-2 font-bold uppercase tracking-wide text-white hover:bg-[#388e3c]'
              : `py-1.5 ${item.danger ? 'text-danger hover:bg-danger/15' : 'text-text hover:bg-selected'}`
          }`}
        >
          {item.icon && (
            <i
              className={`${iconClassName(item.icon)} w-3.5 shrink-0 text-center ${isPlay ? '' : 'text-muted'}`}
              aria-hidden="true"
            />
          )}
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.hint && <span className="shrink-0 text-[11px] text-muted">{item.hint}</span>}
          {hasSubmenu && (
            <i className="fas fa-chevron-right shrink-0 text-[9px] text-muted" aria-hidden="true" />
          )}
        </button>
      </SubmenuAnchor>
    )
  }

  return (
    // No overflow-hidden on the root: submenus are portaled out of it entirely,
    // and even before that they sat outside its box. Rounding is kept without
    // clipping since nothing at this level needs cropping.
    <div
      ref={rootRef}
      role="menu"
      className="fixed z-[3000] rounded border border-border bg-primary p-1 shadow-2xl"
      style={{ left: position.left, top: position.top, minWidth: MENU_MIN_WIDTH }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) => renderItem(item, index))}
    </div>
  )
}

// Wraps one row and, when open, portals its submenu to the body positioned
// against the row's own viewport rect.
function SubmenuAnchor({ children, submenu, showSubmenu, onHover, registerPanel }) {
  const anchorRef = useRef(null)
  const panelRef = useRef(null)
  const [pos, setPos] = useState(null)

  useEffect(() => {
    if (!showSubmenu) return undefined
    return registerPanel(panelRef.current)
  }, [showSubmenu, registerPanel, pos])

  // Measured after the panel is in the DOM but before paint, so its real size is
  // known. Rendered hidden until then to avoid a flash at the wrong spot.
  useLayoutEffect(() => {
    if (!showSubmenu) {
      setPos(null)
      return
    }
    const anchor = anchorRef.current
    const panel = panelRef.current
    if (!anchor || !panel) return
    const a = anchor.getBoundingClientRect()
    const p = panel.getBoundingClientRect()

    // Prefer opening right; flip left only if it would actually run off-screen.
    // Decided per panel rather than once from the root, so a third-level submenu
    // near the edge flips even when the first level didn't need to.
    let left = a.right + SUBMENU_GAP
    if (left + p.width > window.innerWidth - EDGE_PADDING) {
      left = a.left - p.width - SUBMENU_GAP
    }
    left = Math.max(EDGE_PADDING, Math.min(left, window.innerWidth - p.width - EDGE_PADDING))

    let top = a.top
    if (top + p.height > window.innerHeight - EDGE_PADDING) {
      top = window.innerHeight - p.height - EDGE_PADDING
    }
    top = Math.max(EDGE_PADDING, top)

    setPos({ left, top })
  }, [showSubmenu, submenu])

  return (
    <div ref={anchorRef} className="relative" onMouseEnter={onHover}>
      {children}
      {showSubmenu
        && createPortal(
          <div
            ref={panelRef}
            role="menu"
            // z above the root menu so a flipped panel overlapping its parent
            // still draws on top. No overflow-hidden: the panel scrolls
            // vertically, and clipping is what hid nested submenus before.
            className="fixed z-[3001] rounded border border-border bg-primary py-1 shadow-xl"
            style={{
              minWidth: MENU_MIN_WIDTH,
              maxHeight: '60vh',
              overflowY: 'auto',
              left: pos?.left ?? 0,
              top: pos?.top ?? 0,
              visibility: pos ? 'visible' : 'hidden',
            }}
            onContextMenu={(event) => event.preventDefault()}
          >
            {submenu}
          </div>,
          document.body,
        )}
    </div>
  )
}
