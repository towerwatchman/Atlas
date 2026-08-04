// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

import ContextMenu from '../src/components/ui/ContextMenu.jsx'

// The bug: an open submenu closed every time the import progress bar ticked,
// wherever the cursor was. Nothing about progress touches the menu - the path was
// entirely through React identity.
//
//   App holds importProgress in state, so every 'import-progress' IPC event
//   re-renders App. Its call site passes `onClose={() => setGameMenu(null)}`, a
//   NEW function on every render. ContextMenu's listener effect listed onClose in
//   its dependencies AND called setOpenPath([]) in its body, so a new identity
//   re-ran the effect and wiped the open-submenu path.
//
// So the menu was reacting to the parent re-rendering, not to user input, and any
// state the parent updated at any cadence would do it - progress just happened to
// be the one that fires several times a second.
//
// Rendering is the only way to catch this. context-menu.test.js asserts the menu
// DATA from buildGameContextMenu and passes either way; nothing mounted the
// component itself.

const menuItems = [
  { label: 'Play', data: { action: 'play' } },
  {
    label: 'Add to',
    submenu: [
      { label: 'Favorites', data: { action: 'setFavorite' } },
      { label: 'RPG', data: { action: 'addToCollection', collectionId: 1 } },
    ],
  },
  {
    label: 'Manage',
    submenu: [
      {
        label: 'Remove from Collection',
        submenu: [{ label: 'RPG', data: { action: 'removeFromCollection' } }],
      },
    ],
  },
]

// Mirrors the real call site: a fresh arrow function on every parent render.
// `items` stays referentially stable, as gameMenu.items does while the menu is
// open, so the only thing changing is the callback identity.
const renderMenu = () =>
  render(
    <ContextMenu open x={20} y={20} items={menuItems} onClose={() => {}} onAction={() => {}} />,
  )

const progressTick = (rerender) =>
  rerender(
    <ContextMenu open x={20} y={20} items={menuItems} onClose={() => {}} onAction={() => {}} />,
  )

const hover = (label) => fireEvent.mouseEnter(screen.getByText(label).closest('div'))

afterEach(() => cleanup())

describe('ContextMenu submenu stability', () => {
  it('keeps a submenu open when the parent re-renders for an unrelated reason', () => {
    const { rerender } = renderMenu()
    hover('Add to')
    expect(screen.getByText('Favorites')).toBeTruthy()

    // One progress bar update. The cursor has not moved and nothing was clicked.
    progressTick(rerender)
    expect(screen.queryByText('Favorites')).toBeTruthy()
  })

  it('survives a burst of them, which is what an import actually produces', () => {
    const { rerender } = renderMenu()
    hover('Add to')
    for (let tick = 0; tick < 25; tick += 1) progressTick(rerender)
    expect(screen.queryByText('Favorites')).toBeTruthy()
  })

  it('keeps a SECOND-level submenu open too', () => {
    // "Manage > Remove from Collection > RPG" is the deepest path in the real
    // menu and the one most expensive to re-navigate.
    const { rerender } = renderMenu()
    hover('Manage')
    hover('Remove from Collection')
    expect(screen.getAllByText('RPG').length).toBeGreaterThan(0)

    progressTick(rerender)
    expect(screen.getByText('Remove from Collection')).toBeTruthy()
    expect(screen.getAllByText('RPG').length).toBeGreaterThan(0)
  })

  it('still resets the open path when the menu is genuinely reopened', () => {
    // The setOpenPath([]) being moved out of the listener effect had a real job:
    // reopening the menu on a different game must not inherit the previous
    // submenu. Losing that would be a worse bug than the one being fixed.
    const { rerender } = renderMenu()
    hover('Add to')
    expect(screen.getByText('Favorites')).toBeTruthy()

    rerender(
      <ContextMenu open={false} x={20} y={20} items={menuItems} onClose={() => {}} onAction={() => {}} />,
    )
    progressTick(rerender)
    expect(screen.queryByText('Favorites')).toBeNull()
  })

  it('still closes on an outside pointerdown, with the latest onClose', () => {
    // The listener now reads onClose through a ref. If that ref were not kept
    // current, the menu would call a STALE closer - closing nothing, or closing
    // the wrong thing.
    const first = vi.fn()
    const latest = vi.fn()
    const { rerender } = render(
      <ContextMenu open x={20} y={20} items={menuItems} onClose={first} onAction={() => {}} />,
    )
    rerender(
      <ContextMenu open x={20} y={20} items={menuItems} onClose={latest} onAction={() => {}} />,
    )
    fireEvent.pointerDown(document.body)
    expect(latest).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
  })

  it('still closes on Escape', () => {
    const onClose = vi.fn()
    render(
      <ContextMenu open x={20} y={20} items={menuItems} onClose={onClose} onAction={() => {}} />,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close when the pointer goes down inside a portaled submenu', () => {
    // Submenu panels are portaled to document.body, so they are not DOM
    // descendants of the root. Clicking one used to close the menu on
    // pointerdown before the click landed.
    const onClose = vi.fn()
    render(
      <ContextMenu open x={20} y={20} items={menuItems} onClose={onClose} onAction={() => {}} />,
    )
    hover('Add to')
    fireEvent.pointerDown(screen.getByText('Favorites'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
