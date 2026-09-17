// @vitest-environment jsdom
import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

import ActionBar from '../src/components/detail/page/ActionBar.jsx'

// The Blacklist button sits next to Add to Wishlist on a Browse title's detail
// page. GameDetailPage decides canBlacklist (catalog row, not installed); the
// bar only has to honour it and route the click.

afterEach(cleanup)

const BROWSE_GAME = { title: 'Browse Game', f95_id: 321, isCatalogEntry: true }

const renderBar = (props = {}) =>
  render(
    <ActionBar
      game={BROWSE_GAME}
      canLaunch={false}
      canInstallFromDetail={false}
      canManageLocalTitle={false}
      canManageWishlist={true}
      launchState="idle"
      onLaunch={() => {}}
      onToggleWishlist={() => {}}
      {...props}
    />,
  )

test('a Browse title shows Blacklist beside the wishlist button and routes the click', () => {
  const onBlacklist = vi.fn()
  renderBar({ canBlacklist: true, onBlacklist })

  expect(screen.getByText('Add to Wishlist')).toBeTruthy()
  fireEvent.click(screen.getByText('Blacklist'))
  expect(onBlacklist).toHaveBeenCalledTimes(1)
})

test('no Blacklist button when the page says the title cannot be blacklisted', () => {
  renderBar({ canBlacklist: false, onBlacklist: vi.fn() })
  expect(screen.queryByText('Blacklist')).toBeNull()
})

test('the button is disabled while the write is in flight', () => {
  const onBlacklist = vi.fn()
  renderBar({ canBlacklist: true, blacklistBusy: true, onBlacklist })
  const button = screen.getByText('Blacklist').closest('button')
  expect(button.disabled).toBe(true)
  fireEvent.click(button)
  expect(onBlacklist).not.toHaveBeenCalled()
})
