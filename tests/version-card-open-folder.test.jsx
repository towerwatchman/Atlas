// @vitest-environment jsdom
import { test, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import fs from 'fs'
import path from 'path'

import ActionBar from '../src/components/detail/page/ActionBar.jsx'
import VersionCard from '../src/components/detail/page/VersionCard.jsx'

// The nav bar's folder button could only ever open ONE version -- actionVersion,
// the selected one -- while sitting in a bar that says nothing about versions.
// To open a different one you had to select it first, which is a different
// action with a persisted side effect (games.selected_version_id).
//
// It moves onto the card, beside that version's playstate control, where the
// version it acts on is the one you are looking at.

afterEach(cleanup)

const GAME = { record_id: 1, title: 'Test Game', isUpdateAvailable: false }

const version = (over = {}) => ({
  version: 'v1.0',
  version_id: 11,
  game_path: '/games/Test/v1.0',
  exec_path: '/games/Test/v1.0/game.exe',
  isInstalled: true,
  playstate: null,
  ...over,
})

const renderCard = (props = {}) =>
  render(
    <VersionCard
      version={version()}
      isSelected={false}
      canManageLocalTitle={true}
      onSelect={() => {}}
      onSetPlaystate={() => {}}
      onOpenFolder={() => {}}
      {...props}
    />,
  )

const folderButton = () => screen.queryByRole('button', { name: /open folder/i })

// ── Gone from the nav bar ───────────────────────────────────────────────────

test('the action bar no longer carries a folder button', () => {
  render(
    <ActionBar
      game={GAME}
      canLaunch={true}
      canManageLocalTitle={true}
      launchState="idle"
      onLaunch={() => {}}
    />,
  )
  expect(folderButton()).toBeNull()
})

// The prop going unused would leave a dead wire between the page and the bar,
// which is the shape of every "adding a handler with no caller" note in
// CLAUDE.md.
test('ActionBar takes no folder props at all', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'components', 'detail', 'page', 'ActionBar.jsx'),
    'utf8',
  )
  expect(source).not.toContain('canOpenFolder')
  expect(source).not.toContain('onOpenFolder')
})

// ── On the card ─────────────────────────────────────────────────────────────

test('each card carries its own folder button', () => {
  renderCard()
  expect(folderButton()).not.toBeNull()
})

test('the button opens THAT card, not the selected one', () => {
  const onOpenFolder = vi.fn()
  const onSelect = vi.fn()
  renderCard({ version: version({ version: 'v0.9', version_id: 9 }), onOpenFolder, onSelect })

  fireEvent.click(folderButton())
  expect(onOpenFolder).toHaveBeenCalledTimes(1)
  // Opening a folder must not change which version is selected -- selection is
  // persisted as games.selected_version_id and is a different decision.
  expect(onSelect).not.toHaveBeenCalled()
})

// The card body is itself a <button> (it selects the version), so the folder
// control has to sit outside it. A nested button is invalid HTML and the inner
// click does not reliably fire.
test('the folder button is not nested inside the select button', () => {
  const { container } = renderCard()
  expect(container.querySelector('button button')).toBeNull()
})

test('a missing version shows the button disabled rather than hiding it', () => {
  const onOpenFolder = vi.fn()
  renderCard({ version: version({ isInstalled: false }), onOpenFolder })

  const button = folderButton()
  expect(button).not.toBeNull()
  expect(button.disabled).toBe(true)
  fireEvent.click(button)
  expect(onOpenFolder).not.toHaveBeenCalled()
})

// Nothing to open, so nothing to offer -- same rule the context menu uses.
test('a version with no path recorded gets no folder button', () => {
  renderCard({ version: version({ game_path: '' }) })
  expect(folderButton()).toBeNull()
})

// ── Playstate control, unchanged ────────────────────────────────────────────

test('the folder button sits beside the playstate control', () => {
  const { container } = renderCard()
  const row = folderButton().parentElement
  expect(row.textContent).toMatch(/set playstate/i)
  expect(container.textContent).toContain('v1.0')
})

// A catalog-ish row has no playstate control, and that must not take the folder
// button with it -- they answer to different conditions.
test('the folder button survives without a playstate control', () => {
  renderCard({ canManageLocalTitle: false })
  expect(folderButton()).not.toBeNull()
  expect(screen.queryByText(/set playstate/i)).toBeNull()
})

test('selecting the card still works', () => {
  const onSelect = vi.fn()
  renderCard({ onSelect })
  fireEvent.click(screen.getByText('v1.0'))
  expect(onSelect).toHaveBeenCalledTimes(1)
})
