// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

import InstallMenuButton from '../src/components/detail/page/InstallMenuButton.jsx'

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

describe('InstallMenuButton', () => {
  it('renders nothing when there are no items', () => {
    const { container } = render(<InstallMenuButton items={[]} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when an item has no handler', () => {
    // A caret whose only entry does nothing is worse than no caret: it looks
    // like a working control.
    const { container } = render(
      <InstallMenuButton items={[{ id: 'x', label: 'Broken', onSelect: null }]} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('mounts with the menu closed', () => {
    render(<InstallMenuButton items={[manualItem(vi.fn())]} />)
    const trigger = screen.getByRole('button', { name: 'More install options' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens the menu and shows the item with its description', () => {
    render(<InstallMenuButton items={[manualItem(vi.fn())]} />)
    fireEvent.click(screen.getByRole('button', { name: 'More install options' }))
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /Manual Install/ })).toBeTruthy()
    expect(screen.getByText(/archive, folder, or executable/)).toBeTruthy()
  })

  it('invokes the item and closes on selection', () => {
    const onSelect = vi.fn()
    render(<InstallMenuButton items={[manualItem(onSelect)]} />)
    fireEvent.click(screen.getByRole('button', { name: 'More install options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Manual Install/ }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    // The import panel appears where this menu was floating, so it must go.
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes on an outside pointer down without invoking anything', () => {
    const onSelect = vi.fn()
    render(<InstallMenuButton items={[manualItem(onSelect)]} />)
    fireEvent.click(screen.getByRole('button', { name: 'More install options' }))
    expect(screen.getByRole('menu')).toBeTruthy()
    // mousedown, not click: the listener has to fire before a control underneath
    // swallows the event.
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('closes on Escape', () => {
    render(<InstallMenuButton items={[manualItem(vi.fn())]} />)
    fireEvent.click(screen.getByRole('button', { name: 'More install options' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('toggles shut when the caret is clicked again', () => {
    render(<InstallMenuButton items={[manualItem(vi.fn())]} />)
    const trigger = screen.getByRole('button', { name: 'More install options' })
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
    const { unmount } = render(<InstallMenuButton items={[manualItem(vi.fn())]} />)
    fireEvent.click(screen.getByRole('button', { name: 'More install options' }))
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
      <InstallMenuButton
        items={[
          { id: 'a', label: 'First', onSelect: vi.fn() },
          { id: 'b', label: 'Second', onSelect: vi.fn() },
        ]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'More install options' }))
    const labels = screen.getAllByRole('menuitem').map((node) => node.textContent)
    expect(labels).toEqual(['First', 'Second'])
  })
})
