// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'

import DownloadsPage from '../src/components/downloads/DownloadsPage.jsx'

// The build chip ("Full Archive" / poster heading) links to the source thread.
// A game-loaded row opens directly; a catalog-only row resolves the entry
// first, the same fetch the banner uses. Rows with no thread stay plain text.

const item = (overrides) => ({
  recordId: null,
  title: 'Game',
  version: 'v1',
  buildLabel: '',
  catalogRef: '',
  url: 'https://mega.nz/f/x',
  host: 'mega.nz',
  source: 'f95',
  state: 'done',
  totalBytes: 0,
  receivedBytes: 0,
  onComplete: 'replace',
  bannerCandidates: [],
  ...overrides,
})

const mount = (items, gamesByRecordId, api = {}) => {
  window.electronAPI = {
    downloadsList: vi.fn().mockResolvedValue({ success: true, items }),
    downloadsFolder: vi.fn().mockResolvedValue({ success: false }),
    openExternalUrl: vi.fn(),
    getCatalogEntry: vi.fn(),
    ...api,
  }
  return render(<DownloadsPage gamesByRecordId={gamesByRecordId} />)
}

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { cleanup(); delete window.electronAPI })

describe('build chip thread link', () => {
  it('opens the thread directly when the game is loaded', async () => {
    mount(
      [item({ id: 1, recordId: 7 })],
      new Map([[7, { hasInstalledVersion: true, f95_id: '63437' }]]),
    )
    const [chip] = await waitFor(() => screen.getAllByTitle('Open source thread for this download'))
    expect(chip.tagName).toBe('BUTTON')
    fireEvent.click(chip)
    expect(window.electronAPI.openExternalUrl).toHaveBeenCalledWith('https://f95zone.to/threads/63437/')
  })

  it('resolves the catalog entry when there is no loaded game', async () => {
    mount(
      [item({ id: 2, buildLabel: 'Season 1', catalogRef: 'catalog:30956' })],
      new Map(),
      { getCatalogEntry: vi.fn().mockResolvedValue({
        success: true, game: { siteUrl: 'https://f95zone.to/threads/some-slug.30956/' },
      }) },
    )
    const [chip] = await waitFor(() => screen.getAllByTitle('Open source thread for this download'))
    fireEvent.click(chip)
    await waitFor(() => expect(window.electronAPI.getCatalogEntry).toHaveBeenCalledWith('catalog:30956'))
    expect(window.electronAPI.openExternalUrl)
      .toHaveBeenCalledWith('https://f95zone.to/threads/some-slug.30956/')
  })

  it('opens nothing when the entry has no thread', async () => {
    mount(
      [item({ id: 3, buildLabel: 'Season 1', catalogRef: 'catalog:30956' })],
      new Map(),
      { getCatalogEntry: vi.fn().mockResolvedValue({ success: true, game: {} }) },
    )
    const [chip] = await waitFor(() => screen.getAllByTitle('Open source thread for this download'))
    fireEvent.click(chip)
    await waitFor(() => expect(window.electronAPI.getCatalogEntry).toHaveBeenCalled())
    expect(window.electronAPI.openExternalUrl).not.toHaveBeenCalled()
  })

  it('stays plain text when no thread is known', async () => {
    mount(
      [item({ id: 4, recordId: 8 })],
      new Map([[8, { hasInstalledVersion: false }]]),
    )
    await waitFor(() => expect(screen.getByText('Full Archive')).toBeTruthy())
    expect(screen.queryByTitle('Open source thread for this download')).toBeNull()
    expect(screen.getByText('Full Archive').tagName).toBe('SPAN')
  })

  it('renders no chip for legacy rows without a build label', async () => {
    mount(
      [item({ id: 5, recordId: 7, buildLabel: null })],
      new Map([[7, { hasInstalledVersion: true, f95_id: '63437' }]]),
    )
    await waitFor(() => expect(screen.getByTitle('Remove from list')).toBeTruthy())
    expect(screen.queryByTitle('Open source thread for this download')).toBeNull()
  })
})
