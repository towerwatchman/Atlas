// @vitest-environment jsdom
import { test, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

import ActionBar from '../src/components/detail/page/ActionBar.jsx'

// "Download Version" on the split-button caret opens the downloads modal (every
// build and mirror the thread offers) for a title that already has a version
// installed.
//
// The gap it fills: showInstallCta is `!canLaunch && canInstallFromDetail`, so
// an installed title shows PLAY, not INSTALL, and the install route is gone.
// The only other door to that modal is the UPDATE button, which renders only
// when game.isUpdateAvailable. An installed game with no pending update
// therefore had NO path to the downloads list, which is what made installing a
// different version of something you already have impossible from this page.

afterEach(cleanup)

const INSTALLED_GAME = { record_id: 1, title: 'Test Game', f95_id: 44821, isUpdateAvailable: false }

const renderBar = (props = {}) =>
  render(
    <ActionBar
      game={INSTALLED_GAME}
      // Installed and launchable: the state where the entry matters.
      canLaunch={true}
      canInstallFromDetail={false}
      canManageLocalTitle={true}
      canManageWishlist={false}
      launchState="idle"
      onLaunch={() => {}}
      onToggleLocalImport={() => {}}
      {...props}
    />,
  )

const openCaret = () => fireEvent.click(screen.getByLabelText("More install options"))

test('an installed title can reach the downloads modal through the caret', () => {
  const onOpenUpdate = vi.fn()
  renderBar({ onOpenUpdate })

  // The primary button is PLAY -- there is no INSTALL to click.
  expect(screen.getByText('PLAY')).toBeTruthy()

  openCaret()
  fireEvent.click(screen.getByText('Download Version'))
  expect(onOpenUpdate).toHaveBeenCalledTimes(1)
})

test('Manual Install is still offered alongside it', () => {
  const onToggleLocalImport = vi.fn()
  renderBar({ onOpenUpdate: () => {}, onToggleLocalImport })

  openCaret()
  expect(screen.getByText('Download Version')).toBeTruthy()
  fireEvent.click(screen.getByText('Manual Install'))
  expect(onToggleLocalImport).toHaveBeenCalledTimes(1)
})

test('it goes straight to the downloads modal even when Steam is also a source', () => {
  // The source picker answers "where should this come from". This entry has
  // already answered it, so it must not detour through the picker.
  const onOpenUpdate = vi.fn()
  const onOpenInstallSources = vi.fn()
  const onSteamInstall = vi.fn()

  renderBar({ onOpenUpdate, onOpenInstallSources, onSteamInstall })

  openCaret()
  fireEvent.click(screen.getByText('Download Version'))
  expect(onOpenUpdate).toHaveBeenCalledTimes(1)
  expect(onOpenInstallSources).not.toHaveBeenCalled()
  expect(onSteamInstall).not.toHaveBeenCalled()
})

test('it is shown disabled, with a reason, for a title with no F95 thread', () => {
  // UpdateModal looks the thread up by f95_id and has nothing to show without
  // one. Disabled rather than hidden so the route stays visible and explains
  // itself instead of appearing and disappearing between titles.
  const onOpenUpdate = vi.fn()
  renderBar({ game: { ...INSTALLED_GAME, f95_id: null }, onOpenUpdate })

  openCaret()
  const item = screen.getByText('Download Version').closest('button')
  expect(item.disabled).toBe(true)
  expect(item.textContent).toContain('No F95zone thread')

  fireEvent.click(item)
  expect(onOpenUpdate).not.toHaveBeenCalled()
})

test('it is disabled when the page was rendered without the modal handler', () => {
  renderBar({ onOpenUpdate: null })
  openCaret()
  expect(screen.getByText('Download Version').closest('button').disabled).toBe(true)
})

test('the entry is also present for an uninstalled title', () => {
  // "Everywhere the caret shows" -- the entry does not come and go depending on
  // whether a version happens to be installed.
  const onOpenUpdate = vi.fn()
  renderBar({ canLaunch: false, canInstallFromDetail: true, onOpenUpdate })

  openCaret()
  fireEvent.click(screen.getByText('Download Version'))
  expect(onOpenUpdate).toHaveBeenCalledTimes(1)
})
