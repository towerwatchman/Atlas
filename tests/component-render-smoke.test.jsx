// @vitest-environment jsdom
import { test, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'

// Actually renders components, which nothing did before.
//
// This closes the gap that let three bugs through in one session: `toMediaSrc`
// and `useMemo` used without being imported, and hook order problems. All of
// them produce a clean `vite build` — it bundles without resolving identifiers —
// and then throw on first render. Mounting the component is the only check that
// sees them.
//
// Deliberately shallow assertions. The point is "does it mount", not pixel
// behaviour; a brittle DOM-shape suite over components still being iterated on
// would cost more than it catches.

import TagEditor from '../src/components/tags/TagEditor.jsx'
import TagChipInput from '../src/components/tags/TagChipInput.jsx'
import BulkTagModal from '../src/components/collections/BulkTagModal.jsx'
import CollectionTile from '../src/components/collections/CollectionTile.jsx'
import CollectionsView from '../src/components/collections/CollectionsView.jsx'
import CollectionModal from '../src/components/collections/CollectionModal.jsx'
import GameTree from '../src/components/library/GameTree.jsx'
import Settings from '../src/components/settings/Settings.jsx'
import ExtensionSettings from '../src/components/settings/ExtensionSettings.jsx'
import SearchSidebar from '../src/components/search/SearchSidebar.jsx'

// Components that call useKnownTags() fetch on mount and set state when the
// promise resolves. Rendering them outside act() produces a "not wrapped in
// act(...)" warning — harmless but noisy, and noise in a smoke suite is how real
// warnings get ignored. This flushes the mount effects before asserting.
const renderSettled = async (ui) => {
  let result
  await act(async () => { result = render(ui) })
  return result
}

beforeEach(() => {
  cleanup()
  // Components fetch through the preload bridge; give them a quiet stub so a
  // mount failure is a real failure rather than a missing global.
  vi.stubGlobal('window', Object.assign(globalThis.window, {
    electronAPI: {
      getKnownTags: async () => ['3dcg', 'fantasy', 'adventure'],
      getTagState: async () => ({ tags: [], catalogTags: [], overridden: false }),
      setTagOverride: async () => ({ success: true, tags: [], catalogTags: [] }),
      resetTagOverride: async () => ({ success: true, tags: [], catalogTags: [] }),
      bulkEditTags: async () => ({ success: true, changed: 0, skipped: 0, failed: [] }),
      showContextMenu: () => {},
      onWindowStateChanged: () => () => {},
      onStartSettingsTour: () => () => {},
      onUpdateStatus: () => () => {},
      getConfig: async () => ({ Interface: {}, Extension: {} }),
      getAppUpdateState: async () => ({ status: 'idle' }),
      getExtensionStatus: async () => ({ running: false, port: 57096, extensionPath: '/test/ext' }),
      getExtensionPath: async () => ({ extensionPath: '/test/ext', exists: true }),
      getUniqueFilterOptions: async () => ({ tags: [], categories: [], engines: [], statuses: [], censored: [] }),
      minimizeWindow: () => {},
      maximizeWindow: () => {},
      closeWindow: () => {},
    },
  }))
})

test('TagEditor mounts and shows catalog and added tags', async () => {
  await renderSettled(
    <TagEditor
      tags={['3dcg', 'mine']}
      catalogTags={['3dcg', 'dropped']}
      overridden
      onChange={() => {}}
      onReset={() => {}}
    />,
  )
  expect(screen.getByText('3dcg')).toBeTruthy()
  expect(screen.getByText('mine')).toBeTruthy()
  // The catalog tag the user removed is offered back.
  expect(screen.getByText('Removed')).toBeTruthy()
  expect(screen.getByText('dropped')).toBeTruthy()
  // Reset only appears when overridden.
  expect(screen.getByText('Reset')).toBeTruthy()
})

test('TagEditor hides Reset when not overridden', async () => {
  await renderSettled(<TagEditor tags={['a']} catalogTags={['a']} onChange={() => {}} onReset={() => {}} />)
  expect(screen.queryByText('Reset')).toBeNull()
})

test('TagEditor renders an empty list without throwing', async () => {
  await renderSettled(<TagEditor tags={[]} catalogTags={[]} onChange={() => {}} />)
  expect(screen.getByText('No tags')).toBeTruthy()
})

test('TagChipInput mounts', async () => {
  await renderSettled(<TagChipInput tags={['one']} onChange={() => {}} />)
  expect(screen.getByText('one')).toBeTruthy()
})

test('BulkTagModal mounts open and reports the record count', async () => {
  await renderSettled(
    <BulkTagModal
      open
      collectionName="Favourites"
      recordIds={[1, 2, 3]}
      presentTags={['3dcg']}
      onClose={() => {}}
    />,
  )
  expect(screen.getByText('Tag Collection')).toBeTruthy()
  expect(screen.getByText('Apply to 3')).toBeTruthy()
})

test('BulkTagModal renders nothing when closed', () => {
  const { container } = render(<BulkTagModal open={false} onClose={() => {}} />)
  expect(container.firstChild).toBeNull()
})

test('CollectionTile mounts with and without art', () => {
  const collection = { id: 1, name: 'Queue', color: '#3b82f6', gameCount: 7 }
  render(<CollectionTile collection={collection} artGames={[]} onOpen={() => {}} />)
  expect(screen.getByText('Queue')).toBeTruthy()
  expect(screen.getByText('( 7 )')).toBeTruthy()

  cleanup()
  render(
    <CollectionTile
      collection={collection}
      artGames={[{ record_id: 1, banner_url: '/tmp/a.png' }]}
      onOpen={() => {}}
    />,
  )
  expect(screen.getByText('Queue')).toBeTruthy()
})

test('CollectionsView mounts empty and with collections', () => {
  render(<CollectionsView collections={[]} gamesByRecordId={new Map()} onCreateCollection={() => {}} />)
  expect(screen.getByText('Create a New Collection')).toBeTruthy()

  cleanup()
  render(
    <CollectionsView
      collections={[{ id: 1, name: 'Playing', color: null, gameCount: 2 }]}
      artRecordIds={{ 1: [9] }}
      gamesByRecordId={new Map([[9, { record_id: 9, banner_url: null }]])}
      onCreateCollection={() => {}}
      onOpenCollection={() => {}}
    />,
  )
  expect(screen.getByText('Playing')).toBeTruthy()
})

test('CollectionModal mounts in create and rename modes', () => {
  render(<CollectionModal open mode="create" onSubmit={() => {}} onCancel={() => {}} />)
  expect(screen.getByText('Create a New Collection')).toBeTruthy()

  cleanup()
  render(
    <CollectionModal open mode="rename" initialName="Old" onSubmit={() => {}} onCancel={() => {}} />,
  )
  expect(screen.getByText('Rename Collection')).toBeTruthy()
})

test('GameTree mounts grouped and ungrouped', () => {
  const games = [
    { record_id: 1, title: 'Alpha', hasInstalledVersion: true },
    { record_id: 2, title: 'Beta', hasInstalledVersion: true },
  ]
  const collections = [{ id: 5, name: 'Playing', color: '#fff' }]
  const byRecord = new Map([[1, [5]]])

  render(
    <GameTree
      games={games}
      collections={collections}
      collectionIdsByRecord={byRecord}
      expandedIds={new Set(['5'])}
      onToggleExpanded={() => {}}
      onSelectGame={() => {}}
    />,
  )
  // Group name is uppercased via CSS, so the text node is still mixed case.
  expect(screen.getByText('Playing')).toBeTruthy()
  expect(screen.getByText('Alpha')).toBeTruthy()
  // The un-collected game lands in the derived Uncategorized bucket.
  expect(screen.getByText('Uncategorized')).toBeTruthy()

  cleanup()
  render(<GameTree games={games} grouped={false} onSelectGame={() => {}} />)
  expect(screen.getByText('Beta')).toBeTruthy()
})

test('GameTree shows the empty message with no games', () => {
  render(<GameTree games={[]} emptyMessage="Nothing here" />)
  expect(screen.getByText('Nothing here')).toBeTruthy()
})

test('Settings mounts and renders sidebar tabs', async () => {
  await renderSettled(<Settings />)
  expect(screen.getByText('ATLAS SETTINGS')).toBeTruthy()
  expect(screen.getAllByText('Interface').length).toBeGreaterThan(0)
  expect(screen.getByText('Extension')).toBeTruthy()
})

test('ExtensionSettings mounts and shows extension info', async () => {
  await renderSettled(<ExtensionSettings />)
  expect(screen.getByText('Browser Extension')).toBeTruthy()
  expect(screen.getByText('Atlas RPC Local Server')).toBeTruthy()
})

test('SearchSidebar shows library-only quick filters in library mode', async () => {
  await renderSettled(
    <SearchSidebar
      isVisible={true}
      isCatalogMode={false}
      activeFilters={{
        installState: 'all',
        updateAvailable: false,
        favoritesOnly: false,
        multipleInstalledVersions: false,
      }}
      onFilterChange={() => {}}
    />,
  )
  await act(() => screen.getByText('Quick Filters').click())
  expect(screen.getByText('Library scope')).toBeTruthy()
  expect(screen.getByText('Show only games with updates available')).toBeTruthy()
  expect(screen.getByText('Favorites only')).toBeTruthy()
  expect(screen.getByText('Show games with multiple installed versions')).toBeTruthy()
  expect(screen.queryByText('Has Steam mapping')).toBeNull()
})

test('SearchSidebar shows catalog-only ratings in catalog mode', async () => {
  await renderSettled(
    <SearchSidebar
      isVisible={true}
      isCatalogMode={true}
      activeFilters={{
        installState: 'all',
        communityRatingMin: 0,
        updateAvailable: false,
        favoritesOnly: false,
        multipleInstalledVersions: false,
      }}
      onFilterChange={() => {}}
    />,
  )
  await act(() => screen.getByText('Quick Filters').click())
  expect(screen.getByText('Library scope')).toBeTruthy()
  expect(screen.queryByText('Show only games with updates available')).toBeNull()
  expect(screen.queryByText('Favorites only')).toBeNull()
  expect(screen.queryByText('Show games with multiple installed versions')).toBeNull()
  expect(screen.queryByText('Has Steam mapping')).toBeNull()
})

test('SearchSidebar shows the Last Seen block in catalog mode', async () => {
  await renderSettled(
    <SearchSidebar
      isVisible={true}
      isCatalogMode={true}
      activeFilters={{ installState: 'all', communityRatingMin: 0 }}
      onFilterChange={() => {}}
    />,
  )
  await act(() => screen.getByText('Quick Filters').click())
  expect(screen.getByText('Only new tiles')).toBeTruthy()
  expect(screen.getByText('Since last startup')).toBeTruthy()
  expect(screen.getByText('Since last tracked')).toBeTruthy()
  expect(screen.getByText('Clear last tracked')).toBeTruthy()
})

test('SearchSidebar shows the Last Seen block in library mode', async () => {
  await renderSettled(
    <SearchSidebar
      isVisible={true}
      isCatalogMode={false}
      activeFilters={{ installState: 'all', updateAvailable: false }}
      onFilterChange={() => {}}
    />,
  )
  await act(() => screen.getByText('Quick Filters').click())
  expect(screen.getByText('Only new tiles')).toBeTruthy()
  expect(screen.getByText('Since last startup')).toBeTruthy()
  expect(screen.getByText('Since last tracked')).toBeTruthy()
  expect(screen.getByText('Clear last tracked')).toBeTruthy()
})

// The control is the part those render tests leave uncovered: it has to send the
// chosen mode and map "Any" back to no filter. The label has no htmlFor, so the
// select is found by the one option value only it carries.
const lastSeenSelect = (container) =>
  Array.from(container.querySelectorAll('select')).find((el) =>
    Array.from(el.options).some((o) => o.value === 'startup'),
  )

test('SearchSidebar Last Seen select sends the chosen mode', async () => {
  const onFilterChange = vi.fn()
  const { container } = await renderSettled(
    <SearchSidebar
      isVisible={true}
      isCatalogMode={true}
      activeFilters={{ installState: 'all', communityRatingMin: 0 }}
      onFilterChange={onFilterChange}
    />,
  )
  await act(() => screen.getByText('Quick Filters').click())
  fireEvent.change(lastSeenSelect(container), { target: { value: 'startup' } })
  expect(onFilterChange).toHaveBeenCalled()
  expect(onFilterChange.mock.calls[0][0].lastSeen).toBe('startup')
})

test('SearchSidebar Last Seen maps Any back to a null filter', async () => {
  const onFilterChange = vi.fn()
  const { container } = await renderSettled(
    <SearchSidebar
      isVisible={true}
      isCatalogMode={true}
      activeFilters={{ installState: 'all', communityRatingMin: 0, lastSeen: 'startup' }}
      onFilterChange={onFilterChange}
    />,
  )
  await act(() => screen.getByText('Quick Filters').click())
  fireEvent.change(lastSeenSelect(container), { target: { value: 'any' } })
  expect(onFilterChange).toHaveBeenCalled()
  expect(onFilterChange.mock.calls[0][0].lastSeen).toBeNull()
})

test('SearchSidebar Clear last tracked calls the main process', async () => {
  const clearLastTracked = vi.fn()
  const previous = window.electronAPI.clearLastTracked
  window.electronAPI.clearLastTracked = clearLastTracked
  try {
    await renderSettled(
      <SearchSidebar
        isVisible={true}
        isCatalogMode={true}
        activeFilters={{ installState: 'all', communityRatingMin: 0 }}
        onFilterChange={() => {}}
      />,
    )
    await act(() => screen.getByText('Quick Filters').click())
    await act(async () => { screen.getByText('Clear last tracked').click(); await flush() })
    expect(clearLastTracked).toHaveBeenCalled()
  } finally {
    window.electronAPI.clearLastTracked = previous
  }
})

// Drains the microtask queue so an awaiting handler settles; call inside act().
const flush = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve() }

const renderCatalogSidebar = async (clearLastTracked) => {
  const previous = window.electronAPI.clearLastTracked
  if (clearLastTracked) window.electronAPI.clearLastTracked = clearLastTracked
  const result = await renderSettled(
    <SearchSidebar
      isVisible={true}
      isCatalogMode={true}
      activeFilters={{ installState: 'all', communityRatingMin: 0 }}
      onFilterChange={() => {}}
    />,
  )
  await act(() => screen.getByText('Quick Filters').click())
  return { ...result, restore: () => { window.electronAPI.clearLastTracked = previous } }
}

test('SearchSidebar Last Seen empty option is labelled "-"', async () => {
  const { container } = await renderCatalogSidebar()
  const empty = Array.from(lastSeenSelect(container).options).find((o) => o.value === 'any')
  expect(empty.textContent).toBe('-')
})

test('SearchSidebar disables Clear last tracked until the call settles', async () => {
  let resolveClear
  const { restore } = await renderCatalogSidebar(vi.fn(() => new Promise((res) => { resolveClear = res })))
  try {
    const button = screen.getByText('Clear last tracked')
    await act(async () => { button.click() })
    expect(button.disabled).toBe(true)
    await act(async () => { resolveClear({ cleared: true, watermark: 1 }); await flush() })
    expect(button.disabled).toBe(false)
  } finally {
    restore()
  }
})

test('SearchSidebar shows no failure line when main resolves a successful clear', async () => {
  // This is exactly the shape electron/ipc/games.js resolves with on success.
  // Inverting the sidebar's success check makes a working clear look failed,
  // so this case fails when that check flips.
  const { restore } = await renderCatalogSidebar(vi.fn(async () => ({ cleared: true, watermark: 40 })))
  try {
    const button = screen.getByText('Clear last tracked')
    await act(async () => { button.click(); await flush() })
    expect(screen.queryByText(/Failed to clear last tracked/)).toBeNull()
    expect(button.disabled).toBe(false)
  } finally {
    restore()
  }
})

test('SearchSidebar reports a clear that cleared nothing', async () => {
  const { restore } = await renderCatalogSidebar(vi.fn(async () => ({ cleared: false })))
  try {
    const button = screen.getByText('Clear last tracked')
    await act(async () => { button.click(); await flush() })
    expect(screen.getByText(/Failed to clear last tracked/)).toBeTruthy()
    expect(button.disabled).toBe(false)
  } finally {
    restore()
  }
})

// The Last Seen control is a Library filter: the Wishlist list never reads it, so
// showing it there is a dead control. The gate is isWishlistMode, not isCatalogMode,
// because the plain local Library (both flags false) must keep it.
const renderSidebarInMode = async ({ isWishlistMode, isCatalogMode }) => {
  const result = await renderSettled(
    <SearchSidebar
      isVisible={true}
      isWishlistMode={isWishlistMode}
      isCatalogMode={isCatalogMode}
      activeFilters={{ installState: 'all', communityRatingMin: 0 }}
      onFilterChange={() => {}}
    />,
  )
  await act(() => screen.getByText('Quick Filters').click())
  return result
}

test('SearchSidebar hides Last Seen in the Wishlist', async () => {
  await renderSidebarInMode({ isWishlistMode: true, isCatalogMode: false })
  expect(screen.queryByText('Only new tiles')).toBeNull()
  expect(screen.queryByText('Clear last tracked')).toBeNull()
})

test('SearchSidebar keeps Last Seen in the local Library', async () => {
  await renderSidebarInMode({ isWishlistMode: false, isCatalogMode: false })
  expect(screen.getByText('Only new tiles')).toBeTruthy()
})
