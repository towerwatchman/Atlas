import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getNavItems, navItemIsActive, parseIconParts } from '../src/components/ui/navItems.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => readFileSync(resolve(root, relative), 'utf8')
const has = (src, needle) => expect(src.includes(needle), needle).toBe(true)

const topNav = () => read('src/components/ui/TopNav.jsx')
const app = () => read('src/App.jsx')

describe('Downloads button in the top nav', () => {
  it('places Downloads at the end of the left group', () => {
    const match = topNav().match(/const LEFT_ORDER = \[([^\]]*)\]/)
    expect(match).not.toBeNull()
    const names = match[1].split(',').map((name) => name.trim().replace(/'/g, '')).filter(Boolean)
    expect(names).toEqual(['Library', 'Browse', 'Add', 'Settings', 'Filters', 'Downloads'])
  })

  it('exposes a Downloads item that opens the Downloads view', () => {
    const onOpenDownloads = vi.fn()
    const item = getNavItems({ onOpenDownloads }).find((entry) => entry.name === 'Downloads')
    expect(item).toBeDefined()
    expect(item.path.length).toBeGreaterThan(0)
    item.onClick()
    expect(onOpenDownloads).toHaveBeenCalledTimes(1)
  })

  it('uses an outlined tray icon for Downloads', () => {
    const item = getNavItems({}).find((entry) => entry.name === 'Downloads')
    expect(item.viewBox).toBe('0 0 24 24')
    expect(item.path.map((path) => path.match(/d="([^"]*)"/)[1])).toEqual([
      'M12 3v8.5', 'M7 8 12 13 17 8', 'M4 15.5v4.5h16v-4.5',
    ])
    const parts = parseIconParts(item)
    expect(parts).toHaveLength(3)
    for (const part of parts) {
      expect(part.props.fill).toBe('none')
      expect(part.props.stroke).toBe('currentColor')
      expect(part.props.strokeWidth).toBe('2')
      expect(part.props.strokeLinecap).toBe('round')
      expect(part.props.strokeLinejoin).toBe('round')
    }
  })

  it('lights Downloads alone while that view is current', () => {
    expect(navItemIsActive('Downloads', { downloadsActive: true })).toBe(true)
    expect(navItemIsActive('Downloads', { downloadsActive: false })).toBe(false)
    expect(navItemIsActive('Library', { libraryMode: 'local', downloadsActive: true })).toBe(false)
    expect(navItemIsActive('Favorites', { favoritesActive: true, downloadsActive: true })).toBe(false)
    expect(navItemIsActive('Collections', { collectionsActive: true, downloadsActive: true })).toBe(false)
  })

  it('passes the handler and active state at both TopNav call sites', () => {
    const sites = [...app().matchAll(/<TopNav\b([\s\S]*?)\/>/g)].map((match) => match[1])
    expect(sites).toHaveLength(2)
    for (const site of sites) {
      has(site, 'onOpenDownloads={openDownloads}')
      has(site, "downloadsActive={libraryView === 'downloads'}")
    }
  })

  it('leaves the footer DownloadsStatus wiring untouched', () => {
    const src = app()
    has(src, '<DownloadsStatus')
    has(src, 'onOpen={openDownloads}')
    has(src, "active={libraryView === 'downloads'}")
  })
})
