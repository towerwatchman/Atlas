// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'

import UpdateModal from '../src/components/downloads/UpdateModal.jsx'

// Nothing mounted this modal before, which is how the flat mirror list survived
// as long as it did: linkSections was unit tested, the modal that renders it was
// not, and the two disagreed about what a "section" was.
//
// The case that matters: two DLCs posted under
// separate headings but the same "<b>Win/Linux/Mac</b>" platform bold. They must
// render as TWO named builds, not one option called Win/Linux/Mac.

const link = (host, group, platform = '', section = '') => ({
  url: `https://${host}/f/${group.replace(/\W+/g, '')}${section.replace(/\W+/g, '')}`,
  host,
  group,
  platform,
  section,
  label: 'Download',
  masked: true,
  compressed: false,
  platforms: [],
})

const mount = (links) => {
  window.electronAPI = {
    updateLinksGet: vi.fn().mockResolvedValue({ ok: true, threadId: '95982', links }),
    openExternalUrl: vi.fn(),
    downloadsResolveMasked: vi.fn(),
    downloadsEnqueue: vi.fn(),
  }
  return render(
    <UpdateModal
      game={{ title: 'FreshWomen', f95_id: '95982', latestVersion: 'Season 2 Final' }}
      open
      onClose={() => {}}
      onQueued={() => {}}
    />,
  )
}

// Both linked sources, each returning its own live version. lcPending holds
// the LewdCorner promise open so the F95 tab can be checked while it runs.
const mountBoth = ({ f95Version = 'v1.0', lcVersion = 'v2.0', lcPending = false } = {}) => {
  let resolveLc = () => {}
  const pending = lcPending ? new Promise((resolve) => { resolveLc = resolve }) : null
  window.electronAPI = {
    updateLinksGet: vi.fn().mockResolvedValue({
      ok: true,
      threadId: '1',
      version: f95Version,
      links: [link('mega.nz', 'Full Archive', 'Win/Linux')],
    }),
    lcLinksGet: pending
      ? vi.fn(() => pending)
      : vi.fn().mockResolvedValue({ ok: true, threadId: '2', version: lcVersion, links: [] }),
    openExternalUrl: vi.fn(),
    downloadsResolveMasked: vi.fn(),
    downloadsEnqueue: vi.fn(),
  }
  render(
    <UpdateModal
      game={{ title: 'Summertime Saga', f95_id: '1', lc_id: '2', latestVersion: 'wip.8189' }}
      open
      onClose={() => {}}
      onQueued={() => {}}
    />,
  )
  return { resolveLc }
}

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { cleanup(); delete window.electronAPI })

describe('UpdateModal build options', () => {
  it('shows two builds that share a platform as two options', async () => {
    mount([
      link('mega.nz', "Chloe's: Desire Express DLC", 'Win/Linux/Mac'),
      link('mega.nz', 'Julia in Japan DLC', 'Win/Linux/Mac'),
    ])
    await waitFor(() => {
      expect(screen.getByText("Chloe's: Desire Express DLC")).toBeTruthy()
    })
    expect(screen.getByText('Julia in Japan DLC')).toBeTruthy()
    // The platform is a badge on each build, never the build's name.
    expect(screen.queryByText('Win/Linux/Mac', { selector: 'span.text-xs' })).toBeNull()
    expect(screen.getAllByText('Win/Linux/Mac').length).toBe(2)
  })

  it('shortens a "<platform> <qualifier>" head to the qualifier the badge already shows', async () => {
    mount([
      link('gofile.io', 'Win/Linux Heavy', 'Win/Linux'),
      link('mega.nz', 'Win/Linux Lite', 'Win/Linux'),
    ])
    await waitFor(() => { expect(screen.getByText('Heavy')).toBeTruthy() })
    expect(screen.getByText('Lite')).toBeTruthy()
    // The full label is not printed when the qualifier alone names the section -
    // the two badges carry the platform words.
    expect(screen.queryByText('Win/Linux Heavy')).toBeNull()
    expect(screen.queryByText('Win/Linux Lite')).toBeNull()
    expect(screen.getAllByText('Win/Linux')).toHaveLength(2)
  })

  it('labels the mirror chips with the bare host, which is what the thread shows', async () => {
    mount([
      link('mega.nz', 'Season 2 Final 4K', 'Win/Linux'),
      link('buzzheavier.com', 'Season 2 Final 4K', 'Win/Linux'),
    ])
    await waitFor(() => { expect(screen.getByText('mega.nz')).toBeTruthy() })
    // The longest host name in the data, and the one the chip width was sized to.
    expect(screen.getByText('buzzheavier.com')).toBeTruthy()
  })

  it('counts the mirrors of each build', async () => {
    mount([
      link('mega.nz', 'Season 2', 'Win'),
      link('pixeldrain.com', 'Season 2', 'Win'),
      link('mega.nz', 'Season 1', 'Win'),
    ])
    await waitFor(() => { expect(screen.getByText('Season 2')).toBeTruthy() })
    expect(screen.getByText(/2 mirrors/)).toBeTruthy()
    expect(screen.getByText(/1 mirror$/)).toBeTruthy()
  })

  it('renders a repack section beside its part and queues it in the build label', async () => {
    mount([
      link('mega.nz', 'Part 6', 'Win/Linux'),
      link('pixeldrain.com', 'Part 6', 'Win/Linux', 'COMPRESSED (V95)'),
    ])
    await waitFor(() => { expect(screen.getByText('COMPRESSED (V95)')).toBeTruthy() })
    // Both rows are headed "Part 6"; the section is the only thing telling them
    // apart, and it sits between the name and the platform badge.
    expect(screen.getAllByText('Part 6')).toHaveLength(2)
    window.electronAPI.downloadsResolveMasked.mockResolvedValue({
      ok: true, url: 'https://pixeldrain.com/api/file/x', host: 'pixeldrain.com',
    })
    window.electronAPI.downloadsEnqueue.mockResolvedValue({ success: true, item: {} })
    fireEvent.click(screen.getByText('pixeldrain.com'))
    await waitFor(() => { expect(window.electronAPI.downloadsEnqueue).toHaveBeenCalled() })
    // The queue row says which archive it is fetching, not just the part name.
    expect(window.electronAPI.downloadsEnqueue.mock.calls[0][0].buildLabel)
      .toBe('Part 6 \u00b7 COMPRESSED (V95)')
  })

  it('hides the build heading when there is only one, and still lists its mirrors', async () => {
    // A label on a list with no alternative is noise.
    mount([
      link('mega.nz', 'Season 2 Final', 'Win'),
      link('pixeldrain.com', 'Season 2 Final', 'Win'),
    ])
    await waitFor(() => { expect(screen.getByText('mega.nz')).toBeTruthy() })
    expect(screen.queryByText('Season 2 Final')).toBeNull()
    expect(screen.getByText('pixeldrain.com')).toBeTruthy()
  })

  it('tells the user to pick a build first only when there is more than one', async () => {
    mount([link('mega.nz', 'A', 'Win'), link('mega.nz', 'B', 'Win')])
    await waitFor(() => {
      expect(screen.getByText(/Pick the build first, then a mirror/)).toBeTruthy()
    })
  })

  it('names the unlabeled block instead of showing a blank heading', async () => {
    mount([link('mega.nz', '', 'Win'), link('mega.nz', 'Season 1', 'Win')])
    await waitFor(() => { expect(screen.getByText('Full Archive')).toBeTruthy() })
  })

  it('expands a multi-file gofile folder into a picker and queues the picked file', async () => {
    mount([link('gofile.io', 'Season 2', 'Win')])
    window.electronAPI.downloadsResolveMasked.mockResolvedValue({
      ok: true, url: 'https://gofile.io/d/AbCdEfGh', host: 'gofile.io',
    })
    window.electronAPI.downloadsListFolder = vi.fn().mockResolvedValue({
      ok: true,
      choices: [
        { name: 'part1.zip', size: 10, directUrl: 'https://store1.gofile.io/1' },
        { name: 'part2.zip', size: 20, directUrl: 'https://store1.gofile.io/2' },
      ],
    })
    window.electronAPI.downloadsEnqueue.mockResolvedValue({ success: true, item: {} })
    await waitFor(() => { expect(screen.getByText('gofile.io')).toBeTruthy() })
    fireEvent.click(screen.getByText('gofile.io'))
    await waitFor(() => { expect(screen.getByText('part1.zip')).toBeTruthy() })
    expect(screen.getByText('10 B')).toBeTruthy()
    fireEvent.click(screen.getByText('part2.zip'))
    await waitFor(() => { expect(window.electronAPI.downloadsEnqueue).toHaveBeenCalled() })
    expect(window.electronAPI.downloadsEnqueue.mock.calls[0][0].url).toBe('https://store1.gofile.io/2')
  })

  it('queues a direct file link when no plugin claims it instead of refusing', async () => {
    mount([link('gofile.io', 'Season 2', 'Win')])
    window.electronAPI.downloadsResolveMasked.mockResolvedValue({
      ok: true, url: 'https://store1.gofile.io/download/web/u1/game.zip', host: 'store1.gofile.io',
    })
    window.electronAPI.downloadsListFolder = vi.fn().mockResolvedValue({
      ok: false, error: 'No plugin for this host',
    })
    window.electronAPI.downloadsEnqueue.mockResolvedValue({ success: true, item: {} })
    await waitFor(() => { expect(screen.getByText('gofile.io')).toBeTruthy() })
    fireEvent.click(screen.getByText('gofile.io'))
    await waitFor(() => { expect(window.electronAPI.downloadsEnqueue).toHaveBeenCalled() })
    expect(window.electronAPI.downloadsEnqueue.mock.calls[0][0].url).toBe('https://store1.gofile.io/download/web/u1/game.zip')
  })

  it('shows the picker for a gofile listing that returns choices', async () => {
    mount([link('gofile.io', 'Season 2', 'Win')])
    window.electronAPI.downloadsResolveMasked.mockResolvedValue({
      ok: true, url: 'https://gofile.io/d/AbCdEfGh', host: 'gofile.io',
    })
    window.electronAPI.downloadsListFolder = vi.fn().mockResolvedValue({
      ok: true,
      choices: [
        { name: 'a.zip', size: 1, directUrl: 'https://store1.gofile.io/1' },
      ],
    })
    window.electronAPI.downloadsEnqueue.mockResolvedValue({ success: true, item: {} })
    await waitFor(() => { expect(screen.getByText('gofile.io')).toBeTruthy() })
    fireEvent.click(screen.getByText('gofile.io'))
    await waitFor(() => { expect(screen.getByText('a.zip')).toBeTruthy() })
    expect(window.electronAPI.downloadsEnqueue).not.toHaveBeenCalled()
  })

  it('queues a non-gofile link untouched without calling the folder listing', async () => {
    // Regression: the listing step once rewrote every host's resolved URL.
    // Buzzheavier's ?v= token was stripped and the CDN 403d. Only folder
    // hosts take that step now, so the queued URL keeps its query.
    mount([link('buzzheavier.com', 'Season 2', 'Win')])
    window.electronAPI.downloadsResolveMasked.mockResolvedValue({
      ok: true, url: 'https://ts.bzzhr.to/d/uld7h6izau9t?v=token', host: 'ts.bzzhr.to',
    })
    window.electronAPI.downloadsListFolder = vi.fn().mockResolvedValue({
      ok: true, directUrl: 'https://ts.bzzhr.to/d/uld7h6izau9t',
    })
    window.electronAPI.downloadsEnqueue.mockResolvedValue({ success: true, item: {} })
    await waitFor(() => { expect(screen.getByText('buzzheavier.com')).toBeTruthy() })
    fireEvent.click(screen.getByText('buzzheavier.com'))
    await waitFor(() => { expect(window.electronAPI.downloadsEnqueue).toHaveBeenCalled() })
    expect(window.electronAPI.downloadsListFolder).not.toHaveBeenCalled()
    expect(window.electronAPI.downloadsEnqueue.mock.calls[0][0].url)
      .toBe('https://ts.bzzhr.to/d/uld7h6izau9t?v=token')
  })

  it('shows a failed folder listing instead of queueing blindly', async () => {
    mount([link('gofile.io', 'Season 2', 'Win')])
    window.electronAPI.downloadsResolveMasked.mockResolvedValue({
      ok: true, url: 'https://gofile.io/d/AbCdEfGh', host: 'gofile.io',
    })
    window.electronAPI.downloadsListFolder = vi.fn().mockResolvedValue({
      ok: false, error: 'Gofile returned error-teapot',
    })
    window.electronAPI.downloadsEnqueue.mockResolvedValue({ success: true, item: {} })
    await waitFor(() => { expect(screen.getByText('gofile.io')).toBeTruthy() })
    fireEvent.click(screen.getByText('gofile.io'))
    await waitFor(() => { expect(screen.getByText('Gofile returned error-teapot')).toBeTruthy() })
    expect(window.electronAPI.downloadsEnqueue).not.toHaveBeenCalled()
  })

  it('queues a single-file listing directly with no picker', async () => {
    mount([link('gofile.io', 'Season 2', 'Win')])
    window.electronAPI.downloadsResolveMasked.mockResolvedValue({
      ok: true, url: 'https://gofile.io/d/AbCdEfGh', host: 'gofile.io',
    })
    window.electronAPI.downloadsListFolder = vi.fn().mockResolvedValue({
      ok: true, directUrl: 'https://store1.gofile.io/download/web/u1/game.zip',
      fileName: 'game.zip', fileSize: 42,
    })
    window.electronAPI.downloadsEnqueue.mockResolvedValue({ success: true, item: {} })
    await waitFor(() => { expect(screen.getByText('gofile.io')).toBeTruthy() })
    fireEvent.click(screen.getByText('gofile.io'))
    await waitFor(() => { expect(window.electronAPI.downloadsEnqueue).toHaveBeenCalled() })
    // The share URL, never the listing: no second probe, no picker.
    expect(window.electronAPI.downloadsEnqueue.mock.calls[0][0].url)
      .toBe('https://store1.gofile.io/download/web/u1/game.zip')
  })

  it('falls back to the resolved url when the listing api is missing', async () => {
    mount([link('gofile.io', 'Season 2', 'Win')])
    window.electronAPI.downloadsResolveMasked.mockResolvedValue({
      ok: true, url: 'https://gofile.io/d/AbCdEfGh', host: 'gofile.io',
    })
    // Older preload without downloadsListFolder: optional call short-circuits
    // to undefined instead of throwing into the error path.
    delete window.electronAPI.downloadsListFolder
    window.electronAPI.downloadsEnqueue.mockResolvedValue({ success: true, item: {} })
    await waitFor(() => { expect(screen.getByText('gofile.io')).toBeTruthy() })
    fireEvent.click(screen.getByText('gofile.io'))
    await waitFor(() => { expect(window.electronAPI.downloadsEnqueue).toHaveBeenCalled() })
    expect(window.electronAPI.downloadsEnqueue.mock.calls[0][0].url).toBe('https://gofile.io/d/AbCdEfGh')
  })
})

describe('UpdateModal source prefetch', () => {
  it('starts both linked sources on open and shows each live version', async () => {
    mountBoth()
    await waitFor(() => expect(window.electronAPI.updateLinksGet).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(window.electronAPI.lcLinksGet).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('v1.0')).toBeTruthy())
    expect(screen.getByText('v2.0')).toBeTruthy()
    // The catalog copy is stale and is no longer printed as a single header.
    expect(screen.queryByText(/wip\.8189/)).toBeNull()
  })

  it('paints the finished source without waiting for the other', async () => {
    const { resolveLc } = mountBoth({ lcPending: true })
    await waitFor(() => expect(screen.getByText('mega.nz')).toBeTruthy())
    expect(screen.getByText('v1.0')).toBeTruthy()
    resolveLc({ ok: true, threadId: '2', version: 'v2.0', links: [] })
    await waitFor(() => expect(screen.getByText('v2.0')).toBeTruthy())
  })
})
