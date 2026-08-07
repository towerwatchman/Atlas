// @vitest-environment jsdom
import { test, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

import ActionBar from '../src/components/detail/page/ActionBar.jsx'
import InstallSourceModal from '../src/components/detail/page/InstallSourceModal.jsx'
import { resolveInstallSources } from '../src/components/detail/page/installSources.js'

// ── The Steam takeover, asserted where it actually happened ──────────────────
//
// resolveActionBarRoutes is unit tested next door, and it was NOT the whole
// story: ActionBar derived its own `steamInstallCta` in the component body and
// used that for both the click handler and the label. So the routing function
// could be correct and the button still hand off to Steam, because the button
// was reading a second copy of the rule that nothing asserted.
//
// That is the case these mount. A pure test of the resolver cannot see it.

afterEach(cleanup)

const GAME = { record_id: 1, title: 'Test Game', isUpdateAvailable: false }

const renderBar = (props = {}) =>
  render(
    <ActionBar
      game={GAME}
      canLaunch={false}
      canInstallFromDetail={true}
      canManageLocalTitle={true}
      canManageWishlist={false}
      launchState="idle"
      onLaunch={() => {}}
      onToggleLocalImport={() => {}}
      {...props}
    />,
  )

test('a title with Steam AND mirrors opens the picker rather than Steam', () => {
  const onSteamInstall = vi.fn()
  const onOpenUpdate = vi.fn()
  const onOpenInstallSources = vi.fn()

  renderBar({
    onSteamInstall,
    onOpenUpdate,
    onOpenInstallSources,
    installSources: resolveInstallSources({ hasMirrors: true, hasSteamInstall: true }),
  })

  fireEvent.click(screen.getByText('INSTALL'))
  expect(onOpenInstallSources).toHaveBeenCalledTimes(1)
  // The regression, stated directly: Steam must not be invoked just because it
  // exists. It used to be, and the mirrors were then unreachable from this page.
  expect(onSteamInstall).not.toHaveBeenCalled()
  expect(onOpenUpdate).not.toHaveBeenCalled()
})

test('the button still says INSTALL when Steam is present', () => {
  renderBar({
    onSteamInstall: () => {},
    onOpenUpdate: () => {},
    onOpenInstallSources: () => {},
    installSources: resolveInstallSources({ hasMirrors: true, hasSteamInstall: true }),
  })
  // It used to wear a Steam glyph, which told the user the decision had already
  // been made for them. The label is only Steam-branded when Steam is the sole
  // source — see the next test.
  expect(screen.getByText('INSTALL')).toBeTruthy()
  expect(document.querySelector('.fa-steam')).toBeNull()
})

test('Steam-only still goes straight to Steam, with its glyph', () => {
  const onSteamInstall = vi.fn()
  const onOpenInstallSources = vi.fn()

  renderBar({
    onSteamInstall,
    onOpenInstallSources,
    installSources: resolveInstallSources({ hasSteamInstall: true }),
  })

  // One source is not a choice: no dialog, and the glyph is now a description
  // of where the button goes rather than an override of where it should have.
  expect(document.querySelector('.fa-steam')).not.toBeNull()
  fireEvent.click(screen.getByText('INSTALL'))
  expect(onSteamInstall).toHaveBeenCalledTimes(1)
  expect(onOpenInstallSources).not.toHaveBeenCalled()
})

test('mirrors-only goes straight to the mirror picker', () => {
  const onOpenUpdate = vi.fn()
  const onOpenInstallSources = vi.fn()

  renderBar({
    onOpenUpdate,
    onOpenInstallSources,
    installSources: resolveInstallSources({ hasMirrors: true }),
  })

  fireEvent.click(screen.getByText('INSTALL'))
  expect(onOpenUpdate).toHaveBeenCalledTimes(1)
  expect(onOpenInstallSources).not.toHaveBeenCalled()
})

test('a source the user disabled is not offered, even when the game has it', () => {
  const onSteamInstall = vi.fn()
  const onOpenUpdate = vi.fn()
  const onOpenInstallSources = vi.fn()

  renderBar({
    onSteamInstall,
    onOpenUpdate,
    onOpenInstallSources,
    // Steam removed in Settings > Metadata. That leaves one source, so the
    // button goes straight to it and no dialog appears.
    installSources: resolveInstallSources({
      hasMirrors: true,
      hasSteamInstall: true,
      sourceOrder: 'f95',
    }),
  })

  fireEvent.click(screen.getByText('INSTALL'))
  expect(onOpenUpdate).toHaveBeenCalledTimes(1)
  expect(onSteamInstall).not.toHaveBeenCalled()
  expect(onOpenInstallSources).not.toHaveBeenCalled()
})

// ── The picker itself ───────────────────────────────────────────────────────

test('the picker lists every source and reports the one chosen', () => {
  const onSelect = vi.fn()
  const sources = resolveInstallSources({
    hasMirrors: true,
    hasSteamInstall: true,
    gogStoreUrl: 'https://www.gog.com/game/x',
  })

  render(
    <InstallSourceModal
      open
      title="Test Game"
      sources={sources}
      onSelect={onSelect}
      onClose={() => {}}
    />,
  )

  expect(screen.getByText('F95Zone')).toBeTruthy()
  expect(screen.getByText('Steam')).toBeTruthy()
  expect(screen.getByText('GOG')).toBeTruthy()

  fireEvent.click(screen.getByText('Steam'))
  expect(onSelect).toHaveBeenCalledWith('steam')
})

test('the picker renders nothing when there is nothing to pick', () => {
  const { container } = render(
    <InstallSourceModal open title="Test Game" sources={[]} onSelect={() => {}} onClose={() => {}} />,
  )
  // Guards the invariant the routing relies on: fewer than two sources never
  // reaches this component, and if it somehow does it must not show an empty
  // dialog over the page.
  expect(container.firstChild).toBeNull()
})
