// @vitest-environment jsdom
import { test, expect, vi } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { ThemeProvider } from '../src/theme/ThemeProvider.jsx'
import Sidebar from '../src/components/ui/Sidebar.jsx'
import TopNav from '../src/components/ui/TopNav.jsx'

// Programmatic mode jumps (detail metadata clicks) change libraryMode without
// touching the rail's click flag. The rail must follow the mode, or the jump
// leaves both Library and Browse highlighted.
const railProps = {
  onToggleGameList: () => {},
  onCheckDbUpdates: () => {},
  onGoHome: () => {},
  onBrowseCatalog: () => {},
  onOpenWishlist: () => {},
  onToggleSearchSidebar: () => {},
  onOpenAbout: () => {},
  onOpenCollections: () => {},
  showGameList: false,
  browseAvailable: true,
}

const navNodeFor = (name) => screen.getByTitle(name)

const clickNav = (name) => { fireEvent.click(navNodeFor(name)) }

vi.stubGlobal('window', Object.assign(globalThis.window, {
  electronAPI: { getConfig: async () => ({ Interface: {} }) },
}))

const withTheme = (ui) => <ThemeProvider>{ui}</ThemeProvider>

test('Sidebar follows a programmatic jump back to Library', async () => {
  let result
  await act(async () => {
    result = render(withTheme(<Sidebar {...railProps} libraryMode="catalog" />))
  })
  await act(async () => { clickNav('Browse') })
  expect(navNodeFor('Browse').className).toMatch(/active/)
  await act(async () => {
    result.rerender(withTheme(<Sidebar {...railProps} libraryMode="local" />))
  })
  expect(navNodeFor('Library').className).toMatch(/active/)
  expect(navNodeFor('Browse').className).not.toMatch(/active/)
  result.unmount()
})

test('TopNav follows a programmatic jump back to Library', async () => {
  let result
  await act(async () => {
    result = render(withTheme(<TopNav {...railProps} libraryMode="catalog" group="left" />))
  })
  await act(async () => { clickNav('Browse') })
  await act(async () => {
    result.rerender(withTheme(<TopNav {...railProps} libraryMode="local" group="left" />))
  })
  expect(navNodeFor('Library').className).toMatch(/active/)
  expect(navNodeFor('Browse').className).not.toMatch(/active/)
  result.unmount()
})
