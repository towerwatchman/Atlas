import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

// Custom context menu, replacing Electron's native one for game rows.
//
// Native menus are drawn by the OS and cannot be styled at all — no accent
// colour on Play, no theme awareness. They also ignore a click on any item that
// has a submenu, which is why the old menu needed a separate "Play (v1.2)" entry
// alongside a "Play Version" submenu. Both limitations go away here.
//
// The trade-off, deliberately accepted: this cannot extend beyond the window, so
// near an edge it flips instead of overflowing onto the desktop.
//
// Item shape:
//   { label, icon?, variant?: 'play', data?, submenu?, disabled?, danger? }
//   { type: 'separator' }

const MENU_MIN_WIDTH = 200
const EDGE_PADDING = 8

export default function ContextMenu({ open, x = 0, y = 0, items = [], onClose, onAction }) {
  const rootRef = useRef(null)
  const [position, setPosition] = useState({ left: x, top: y })
  const [openSubmenu, setOpenSubmenu] = useState(null)
  const [submenuFlip, setSubmenuFlip] = useState(false)

  // Measured after paint so the real height is known before deciding to flip.
  useLayoutEffect(() => {
    if (!open || !rootRef.current) return
    const rect = rootRef.current.getBoundingClientRect()
    const maxLeft = window.innerWidth - rect.width - EDGE_PADDING
    const maxTop = window.innerHeight - rect.height - EDGE_PADDING
    setPosition({
      left: Math.max(EDGE_PADDING, Math.min(x, maxLeft)),
      top: Math.max(EDGE_PADDING, Math.min(y, maxTop)),
    })
    // A submenu opening to the right would run off-screen, so flip it left.
    setSubmenuFlip(x + rect.width + MENU_MIN_WIDTH > window.innerWidth - EDGE_PADDING)
  }, [open, x, y, items])

  useEffect(() => {
    if (!open) return undefined
    setOpenSubmenu(null)
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose?.()
      }
    }
    // `capture` so the menu closes before an underlying element handles the
    // click; without it a right-click elsewhere reopens before this closes.
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) onClose?.()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [open, onClose])

  const run = useCallback((item) => {
    if (!item || item.disabled) return
    onClose?.()
    if (item.data) onAction?.(item.data)
    else item.onSelect?.()
  }, [onAction, onClose])

  if (!open) return null

  const renderItem = (item, index, depth = 0) => {
    if (item.type === 'separator') {
      return <div key={`sep-${index}`} className="my-1 border-t border-border" />
    }
    const hasSubmenu = Array.isArray(item.submenu) && item.submenu.length > 0
    const isPlay = item.variant === 'play'
    const submenuKey = `${depth}-${index}`
    const showSubmenu = hasSubmenu && openSubmenu === submenuKey

    return (
      <div
        key={submenuKey}
        className="relative"
        onMouseEnter={() => setOpenSubmenu(hasSubmenu ? submenuKey : null)}
      >
        <button
          type="button"
          disabled={item.disabled}
          // A parent with a submenu is still clickable — that is the point of
          // not using a native menu. Clicking Play launches; hovering reveals
          // the other versions.
          onClick={() => (item.data || item.onSelect ? run(item) : setOpenSubmenu(submenuKey))}
          className={`flex w-full items-center gap-2.5 px-3 text-left text-sm transition-colors disabled:opacity-40 ${
            isPlay
              ? 'mb-1 rounded-sm bg-[#2e7d32] py-2 font-bold uppercase tracking-wide text-white hover:bg-[#388e3c]'
              : `py-1.5 ${item.danger ? 'text-danger hover:bg-danger/15' : 'text-text hover:bg-selected'}`
          }`}
        >
          {item.icon && (
            <i
              className={`fas ${item.icon} w-3.5 shrink-0 text-center ${isPlay ? '' : 'text-muted'}`}
              aria-hidden="true"
            />
          )}
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.hint && <span className="shrink-0 text-[11px] text-muted">{item.hint}</span>}
          {hasSubmenu && (
            <i className="fas fa-chevron-right shrink-0 text-[9px] text-muted" aria-hidden="true" />
          )}
        </button>

        {showSubmenu && (
          <div
            className="absolute top-0 z-10 overflow-hidden rounded border border-border bg-primary py-1 shadow-xl"
            style={{
              minWidth: MENU_MIN_WIDTH,
              maxHeight: '60vh',
              overflowY: 'auto',
              ...(submenuFlip ? { right: '100%', marginRight: 2 } : { left: '100%', marginLeft: 2 }),
            }}
          >
            {item.submenu.map((child, childIndex) => renderItem(child, childIndex, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      role="menu"
      className="fixed z-[3000] overflow-hidden rounded border border-border bg-primary p-1 shadow-2xl"
      style={{ left: position.left, top: position.top, minWidth: MENU_MIN_WIDTH }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) => renderItem(item, index))}
    </div>
  )
}
