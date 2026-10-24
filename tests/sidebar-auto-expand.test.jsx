// @vitest-environment jsdom
import { test, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import SearchSidebar from '../src/components/search/SearchSidebar.jsx'

// A section holding applied values must open itself: jumping to a tag lands
// with the Tags section applied but collapsed, which reads as "nothing
// happened". The user can still collapse afterwards until values change.
beforeEach(() => {
  cleanup()
  vi.stubGlobal('window', Object.assign(globalThis.window, {
    electronAPI: {
      getKnownTags: async () => ['Action'],
      getTagState: async () => ({ tags: [], catalogTags: [], overridden: false }),
      getUniqueFilterOptions: async () => ({
        tags: ['Action'], categories: [], engines: [], statuses: [], censored: [],
      }),
      getConfig: async () => ({ Interface: {}, Search: {} }),
    },
  }))
})

const baseFilters = {
  text: '',
  tags: ['Action'],
  category: [],
  engine: [],
  status: [],
  excludedTags: [],
  installState: 'all',
  updateAvailable: false,
  favoritesOnly: false,
  multipleInstalledVersions: false,
}

test('the Tags section opens itself when tags are applied', async () => {
  let result
  await act(async () => {
    result = render(
      <SearchSidebar
        isVisible={true}
        isCatalogMode={false}
        activeFilters={baseFilters}
        onFilterChange={() => {}}
      />,
    )
  })
  expect(screen.getAllByText('Action').length).toBeGreaterThanOrEqual(2)
  result.unmount()
})

test('the Tags header shows the applied count while collapsed', async () => {
  let result
  await act(async () => {
    result = render(
      <SearchSidebar
        isVisible={true}
        isCatalogMode={false}
        activeFilters={{ ...baseFilters, tags: [] }}
        onFilterChange={() => {}}
      />,
    )
  })
  // No values: no badge, section stays shut.
  expect(screen.queryByText('Action')).toBeNull()
  result.unmount()
})

test('auto-expand focuses the Tags input so more tags can follow', async () => {
  let result
  await act(async () => {
    result = render(
      <SearchSidebar
        isVisible={true}
        isCatalogMode={false}
        activeFilters={baseFilters}
        onFilterChange={() => {}}
      />,
    )
  })
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve))
  })
  expect(screen.getByPlaceholderText('Search tags...')).toBe(document.activeElement)
  result.unmount()
})

test('toggling values while open leaves focus alone', async () => {
  let result
  await act(async () => {
    result = render(
      <SearchSidebar
        isVisible={true}
        isCatalogMode={false}
        activeFilters={baseFilters}
        onFilterChange={() => {}}
      />,
    )
  })
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve))
  })
  const input = screen.getByPlaceholderText('Search tags...')
  expect(document.activeElement).toBe(input)
  await act(async () => { input.blur() })
  await act(async () => {
    result.rerender(
      <SearchSidebar
        isVisible={true}
        isCatalogMode={false}
        activeFilters={{ ...baseFilters, tags: ['Action', 'RPG'] }}
        onFilterChange={() => {}}
      />,
    )
  })
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve))
  })
  expect(document.activeElement).not.toBe(input)
  result.unmount()
})

test('exclude-only values open the section with a count badge', async () => {
  let result
  await act(async () => {
    result = render(
      <SearchSidebar
        isVisible={true}
        isCatalogMode={false}
        activeFilters={{ ...baseFilters, tags: [], excludedEngines: ['Unity'] }}
        onFilterChange={() => {}}
      />,
    )
  })
  expect(screen.getByText('Engine').parentElement.textContent).toContain('1')
  result.unmount()
})

test('escape in sidebar inputs releases focus like the header box', async () => {
  let result
  await act(async () => {
    result = render(
      <SearchSidebar
        isVisible={true}
        isCatalogMode={false}
        activeFilters={baseFilters}
        onFilterChange={() => {}}
      />,
    )
  })
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve))
  })
  for (const placeholder of ['Search tags...', 'Search Atlas']) {
    const input = screen.getByPlaceholderText(placeholder)
    await act(async () => { input.focus() })
    expect(document.activeElement).toBe(input)
    await act(async () => { fireEvent.keyDown(input, { key: 'Escape' }) })
    expect(document.activeElement).not.toBe(input)
  }
  result.unmount()
})
