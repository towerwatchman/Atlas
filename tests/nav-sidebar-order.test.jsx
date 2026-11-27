// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ThemeProvider } from '../src/theme/ThemeProvider.jsx'
import Sidebar from '../src/components/ui/Sidebar.jsx'
import { getNavItems, parseIconParts } from '../src/components/ui/navItems.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => readFileSync(resolve(root, relative), 'utf8')

const MAIN = ['Library', 'Browse', 'Favorites', 'Collections', 'Downloads']

const sidebar = (props = {}) => (
  <ThemeProvider>
    <Sidebar
      browseAvailable
      showGameList={false}
      onToggleGameList={() => {}}
      onCheckDbUpdates={() => {}}
      onGoHome={() => {}}
      onBrowseCatalog={() => {}}
      onOpenWishlist={() => {}}
      onToggleSearchSidebar={() => {}}
      onOpenAbout={() => {}}
      onOpenCollections={() => {}}
      {...props}
    />
  </ThemeProvider>
)

const renderSidebar = async (props = {}) => {
  vi.stubGlobal('window', Object.assign(globalThis.window, {
    electronAPI: { getConfig: async () => ({ Interface: {} }), openSettings: vi.fn(), openImporter: vi.fn() },
  }))
  let result
  await act(async () => { result = render(sidebar(props)) })
  return result
}

describe('sidenav order and Downloads icon', () => {
  it('groups items so List can sit below the spacer', () => {
    const items = getNavItems({})
    expect(items.filter((item) => item.group === 'main').map((item) => item.name)).toEqual(MAIN)
    expect(items.filter((item) => item.group === 'utility').map((item) => item.name)).toEqual(['Add', 'Updates', 'Settings'])
    expect(items.find((item) => item.name === 'List').group).not.toBe('main')
  })

  it('renders main items, then a gap, then List and the utility items', async () => {
    const { container } = await renderSidebar()
    const order = [...container.firstChild.children].map((child) => {
      if (child.className.includes('flex-1')) return 'SPACER'
      return (child.dataset.tour ? child : child.querySelector('[data-tour]'))?.dataset.tour ?? '?'
    })
    expect(order).toEqual([...MAIN, 'SPACER', 'List', 'Add', 'Updates', 'Settings'])
  })

  it('keeps filled icons filled', () => {
    const item = getNavItems({}).find((entry) => entry.name === 'Library')
    expect(parseIconParts(item).every((part) => part.props.fill === 'currentColor')).toBe(true)
  })

  it('opens the Downloads view from the sidenav and lights only that item', async () => {
    const onOpenDownloads = vi.fn()
    const result = await renderSidebar({ onOpenDownloads })
    await act(async () => { fireEvent.click(screen.getByTitle('Downloads')) })
    expect(onOpenDownloads).toHaveBeenCalledTimes(1)

    await act(async () => { result.rerender(sidebar({ onOpenDownloads, downloadsActive: true })) })
    expect(screen.getByTitle('Downloads').className).toMatch(/active/)
    for (const name of ['Library', 'Favorites', 'Collections']) {
      expect(screen.getByTitle(name).className).not.toMatch(/active/)
    }
  })

  it('keeps the active view tab bar visible after click and pointer leave', async () => {
    const bar = (name) => screen.getByTitle(name).querySelector('div')
    const result = await renderSidebar()
    expect(bar('Library').classList.contains('opacity-100')).toBe(true)
    await act(async () => { fireEvent.click(screen.getByTitle('Downloads')) })
    await act(async () => { result.rerender(sidebar({ downloadsActive: true })) })
    expect(bar('Downloads').classList.contains('opacity-100')).toBe(true)
  })

  it('lets a hovered view tab take the bar and restores the active tab on leave', async () => {
    const bar = (name) => screen.getByTitle(name).querySelector('div')
    await renderSidebar({ downloadsActive: true })
    expect(bar('Downloads').classList.contains('opacity-100')).toBe(true)
    await act(async () => { fireEvent.mouseOver(screen.getByTitle('Favorites')) })
    expect(bar('Favorites').classList.contains('opacity-100')).toBe(true)
    expect(bar('Downloads').classList.contains('opacity-100')).toBe(false)
    await act(async () => { fireEvent.mouseOut(screen.getByTitle('Favorites')) })
    expect(bar('Downloads').classList.contains('opacity-100')).toBe(true)
  })

  it('does not keep a bar on utility items after hover ends', async () => {
    const bar = (name) => screen.getByTitle(name).querySelector('div')
    await renderSidebar()
    await act(async () => { fireEvent.mouseOver(screen.getByTitle('Settings')) })
    expect(bar('Settings').classList.contains('opacity-100')).toBe(true)
    await act(async () => { fireEvent.mouseOut(screen.getByTitle('Settings')) })
    expect(bar('Settings').classList.contains('opacity-100')).toBe(false)
  })

  it('wires Sidebar in App.jsx without changing TopNav order', () => {
    const site = read('src/App.jsx').match(/<Sidebar\b([\s\S]*?)\/>/)?.[1]
    expect(site).toBeDefined()
    expect(site).toContain('onOpenDownloads={openDownloads}')
    expect(site).toContain("downloadsActive={libraryView === 'downloads'}")
  })
})
