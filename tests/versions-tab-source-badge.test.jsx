// @vitest-environment jsdom
import { test, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

import VersionsTab from '../src/components/detail/window/VersionsTab.jsx'
import VersionCard from '../src/components/detail/page/VersionCard.jsx'

// Properties Versions list shows no source while GameDetails does.
// Both views show the same Steam/GOG/Itch chip.

afterEach(cleanup)

const noop = () => {}

const versions = [
  { version: 'Acting Lessons', source: 'steam', isInstalled: false },
  { version: 'Witcher 3', source: 'gog', isInstalled: true },
  { version: 'Hollow Knight', source: 'itch', isInstalled: true },
  { version: 'Local Game', source: 'download', isInstalled: true },
]

const renderTab = () =>
  render(
    <VersionsTab
      versions={versions}
      selectedVersion={versions[0]}
      versionData={{}}
      onVersionSelect={noop}
      onVersionInputChange={noop}
      onSetPath={noop}
      onOpenGamePath={noop}
      onRefreshVersionSize={noop}
      onChangeExecutable={noop}
      onAddVersion={noop}
      onRemoveVersion={noop}
      onDeleteVersionFiles={noop}
    />,
  )

test('properties versions list marks steam, gog and itch sources', () => {
  renderTab()
  expect(screen.getByText('Acting Lessons').closest('li').textContent).toMatch(/Steam/)
  expect(screen.getByText('Witcher 3').closest('li').textContent).toMatch(/GOG/)
  expect(screen.getByText('Hollow Knight').closest('li').textContent).toMatch(/Itch/)
})

test('properties versions list leaves local versions unmarked', () => {
  renderTab()
  expect(screen.getByText('Local Game').closest('li').textContent).not.toMatch(/Steam|GOG|Itch/)
})

test('game details version card marks itch source', () => {
  render(
    <VersionCard
      version={{ version: 'v9.9', source: 'itch', isInstalled: true }}
      isSelected={false}
      canManageLocalTitle={false}
      onSelect={noop}
      onSetPlaystate={noop}
      onOpenFolder={noop}
    />,
  )
  expect(screen.getByText(/Itch/)).toBeTruthy()
})
