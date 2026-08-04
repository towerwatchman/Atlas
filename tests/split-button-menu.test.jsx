// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

import SplitButtonMenu, { placeSplitMenu } from '../src/components/detail/page/SplitButtonMenu.jsx'

// The caret half of the INSTALL split button. Behaviour worth asserting rather
// than eyeballing:
//
//   - it renders nothing when there is nothing to offer, because a split button
//     with an empty menu advertises choices that do not exist
//   - the menu opens, invokes the item, and CLOSES on selection -- leaving it
//     open over a panel that just appeared underneath it is the obvious way to
//     get this wrong
//   - outside click and Escape close it, which is the part that silently rots
//     when a listener is added on 'click' instead of 'mousedown' or the cleanup
//     is dropped
//
// This file also serves the purpose component-render-smoke.test.jsx exists for:
// a missing import or a hook-order mistake bundles cleanly through vite and only
// throws on mount.

afterEach(() => cleanup())

const manualItem = (onSelect) => ({
  id: 'manual-install',
  label: 'Manual Install',
  description: 'Install from an archive, folder, or executable you already have.',
  icon: 'fas fa-file-import',
  onSelect,
})

describe('SplitButtonMenu', () => {
  it('renders nothing when there are no items', () => {
    render(<SplitButtonMenu items={[]}><button type="button">INSTALL</button></SplitButtonMenu>)
    // The primary button still renders - the caret is what disappears.
    expect(screen.getByRole('button', { name: 'INSTALL' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'More options' })).toBeNull()
  })

  it('renders nothing when an item has no handler', () => {
    // A caret whose only entry does nothing is worse than no caret: it looks
    // like a working control.
    render(
      <SplitButtonMenu items={[{ id: 'x', label: 'Broken', onSelect: null }]}>
        <button type="button">INSTALL</button>
      </SplitButtonMenu>,
    )
    expect(screen.queryByRole('button', { name: 'More options' })).toBeNull()
  })

  it('mounts with the menu closed', () => {
    render(<SplitButtonMenu items={[manualItem(vi.fn())]}><button type="button">INSTALL</button></SplitButtonMenu>)
    const trigger = screen.getByRole('button', { name: 'More options' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens the menu and shows the item with its description', () => {
    render(<SplitButtonMenu items={[manualItem(vi.fn())]}><button type="button">INSTALL</button></SplitButtonMenu>)
    fireEvent.click(screen.getByRole('button', { name: 'More options' }))
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /Manual Install/ })).toBeTruthy()
    expect(screen.getByText(/archive, folder, or executable/)).toBeTruthy()
  })

  it('invokes the item and closes on selection', () => {
    const onSelect = vi.fn()
    render(<SplitButtonMenu items={[manualItem(onSelect)]}><button type="button">INSTALL</button></SplitButtonMenu>)
    fireEvent.click(screen.getByRole('button', { name: 'More options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Manual Install/ }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    // The import panel appears where this menu was floating, so it must go.
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes on an outside pointer down without invoking anything', () => {
    const onSelect = vi.fn()
    render(<SplitButtonMenu items={[manualItem(onSelect)]}><button type="button">INSTALL</button></SplitButtonMenu>)
    fireEvent.click(screen.getByRole('button', { name: 'More options' }))
    expect(screen.getByRole('menu')).toBeTruthy()
    // mousedown, not click: the listener has to fire before a control underneath
    // swallows the event.
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('closes on Escape', () => {
    render(<SplitButtonMenu items={[manualItem(vi.fn())]}><button type="button">INSTALL</button></SplitButtonMenu>)
    fireEvent.click(screen.getByRole('button', { name: 'More options' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('toggles shut when the caret is clicked again', () => {
    render(<SplitButtonMenu items={[manualItem(vi.fn())]}><button type="button">INSTALL</button></SplitButtonMenu>)
    const trigger = screen.getByRole('button', { name: 'More options' })
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(trigger)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('removes its document listeners when unmounted while open', () => {
    // A listener surviving unmount calls setState on a dead component. The
    // symptom is a warning in dev and nothing at all in production, so it is
    // asserted rather than noticed.
    const remove = vi.spyOn(document, 'removeEventListener')
    const { unmount } = render(<SplitButtonMenu items={[manualItem(vi.fn())]}><button type="button">INSTALL</button></SplitButtonMenu>)
    fireEvent.click(screen.getByRole('button', { name: 'More options' }))
    unmount()
    const removed = remove.mock.calls.map((call) => call[0])
    expect(removed).toContain('mousedown')
    expect(removed).toContain('keydown')
    remove.mockRestore()
  })

  it('renders several items in order', () => {
    // Nothing adds a second entry today, but the component takes a list and the
    // separator logic is index-based, so the multi-item path is exercised.
    render(
      <SplitButtonMenu
        items={[
          { id: 'a', label: 'First', onSelect: vi.fn() },
          { id: 'b', label: 'Second', onSelect: vi.fn() },
        ]}
      >
        <button type="button">INSTALL</button>
      </SplitButtonMenu>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'More options' }))
    const labels = screen.getAllByRole('menuitem').map((node) => node.textContent)
    expect(labels).toEqual(['First', 'Second'])
  })
})

describe('placeSplitMenu', () => {
  // The reported problems, as assertions. jsdom has no layout, so none of this is
  // visible from a render test - which is why the maths is a pure function.
  const viewport = { width: 1280, height: 800 }
  // A 130px button at x=200 in the action bar, 36px tall.
  const button = { left: 200, right: 230, top: 100, bottom: 136 }
  const menu = { width: 240, height: 70 }

  it('aligns the menu with the button\u2019s left edge', () => {
    const { left } = placeSplitMenu({ anchor: button, panel: menu, viewport })
    expect(left).toBe(button.left)
  })

  it('never starts left of the button when there is room', () => {
    // The bug: anchoring to the caret put the menu's RIGHT edge at the caret and
    // pushed 240px of menu leftwards, past the button's bottom-left corner.
    for (const x of [0, 50, 200, 600, 900]) {
      const { left } = placeSplitMenu({
        anchor: { ...button, left: x, right: x + 30 },
        panel: menu,
        viewport,
      })
      if (x + menu.width <= viewport.width - 8) expect(left).toBeGreaterThanOrEqual(x)
    }
  })

  it('offsets the menu clear of the button rather than flush against it', () => {
    const { top } = placeSplitMenu({ anchor: button, panel: menu, viewport })
    expect(top).toBeGreaterThan(button.bottom)
  })

  it('pulls a menu back inside the right edge of the window', () => {
    // Clamping wins over left-alignment here: a menu hanging off the window is
    // unusable, one starting slightly left of the button is merely imperfect.
    const { left } = placeSplitMenu({
      anchor: { ...button, left: 1200, right: 1230 },
      panel: menu,
      viewport,
    })
    expect(left).toBe(viewport.width - menu.width - 8)
    expect(left + menu.width).toBeLessThanOrEqual(viewport.width - 8)
  })

  it('flips above the button when there is no room below', () => {
    const short = { width: 1280, height: 200 }
    const low = { left: 200, right: 230, top: 120, bottom: 156 }
    const { top } = placeSplitMenu({ anchor: low, panel: menu, viewport: short })
    expect(top).toBeLessThan(low.top)
  })

  it('never goes off the top or left edge, even when nothing fits', () => {
    const tiny = { width: 120, height: 60 }
    const { left, top } = placeSplitMenu({ anchor: button, panel: menu, viewport: tiny })
    expect(left).toBeGreaterThanOrEqual(8)
    expect(top).toBeGreaterThanOrEqual(8)
  })
})

describe('SplitButtonMenu stacking', () => {
  it('portals the menu out of its container', () => {
    // The action bar is `sticky top-0 z-30`, and position + z-index creates a
    // stacking context: every z-index inside it resolves relative to 30, so the
    // menu could not paint above the sidebar (z-50) however large its own
    // z-index. It has to leave the subtree, not out-bid from inside it.
    const { container } = render(
      <div style={{ position: 'sticky', zIndex: 30 }}>
        <SplitButtonMenu items={[manualItem(vi.fn())]}>
          <button type="button">INSTALL</button>
        </SplitButtonMenu>
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'More options' }))
    const menu = screen.getByRole('menu')
    expect(menu).toBeTruthy()
    expect(container.contains(menu)).toBe(false)
    expect(document.body.contains(menu)).toBe(true)
    expect(menu.style.position).toBe('fixed')
  })
})
