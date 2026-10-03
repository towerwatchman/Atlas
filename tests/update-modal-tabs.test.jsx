// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'

import UpdateModal from '../src/components/downloads/UpdateModal.jsx'

// Task 04: one modal, one tab per linked source. The F95 tab keeps today's
// behaviour (loads on open); the LewdCorner tab fetches lazily on first
// click through lewdcorner-links-get ({ lcId }), which already enforces the
// tier gate main-side and answers TIER_RESTRICTED with the reason.

const link = (host, group) => ({
  url: `https://${host}/f/${group.replace(/\W+/g, '')}`,
  host,
  group,
  platform: 'Win',
  label: 'Download',
  masked: true,
  compressed: false,
  platforms: [],
})

const f95Links = [link('mega.nz', 'Season 2'), link('pixeldrain.com', 'Season 2')]
const lcLinks = [link('vikingfile.com', 'Season 2')]

const mount = (game, { f95 = f95Links, lc = lcLinks, lcError = null } = {}) => {
  window.electronAPI = {
    updateLinksGet: vi.fn().mockResolvedValue({ ok: true, threadId: '95982', links: f95 }),
    lcLinksGet: vi.fn().mockImplementation(async () =>
      lcError
        ? { ok: false, error: lcError.error, code: lcError.code }
        : { ok: true, threadId: '3272', links: lc }),
    openExternalUrl: vi.fn(),
    downloadsResolveMasked: vi.fn(),
    downloadsEnqueue: vi.fn().mockResolvedValue({ success: true, item: {} }),
  }
  return render(
    <UpdateModal
      game={game}
      open
      onClose={() => {}}
      onQueued={() => {}}
    />,
  )
}

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { cleanup(); delete window.electronAPI })

describe('UpdateModal source tabs', () => {
  it('dual-sourced shows both tabs and loads F95 on open without touching LC', async () => {
    mount({ title: 'Game', f95_id: '95982', lc_id: '3272' })
    await waitFor(() => { expect(screen.getByText('mega.nz')).toBeTruthy() })
    expect(screen.getByRole('tab', { name: /F95/i })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /LewdCorner/i })).toBeTruthy()
    expect(window.electronAPI.updateLinksGet).toHaveBeenCalledWith({ threadId: '95982', force: false })
    // Lazy: the other source waits for first click, it is never fetched up front.
    expect(window.electronAPI.lcLinksGet).not.toHaveBeenCalled()
  })

  it('clicking the LC tab fetches once and shows its links', async () => {
    mount({ title: 'Game', f95_id: '95982', lc_id: '3272' })
    await waitFor(() => { expect(screen.getByText('mega.nz')).toBeTruthy() })
    fireEvent.click(screen.getByRole('tab', { name: /LewdCorner/i }))
    await waitFor(() => {
      expect(window.electronAPI.lcLinksGet).toHaveBeenCalledWith({ lcId: '3272', force: false })
    })
    await waitFor(() => { expect(screen.getByText('vikingfile.com')).toBeTruthy() })
    // F95 links leave with the tab; the two sources never mix.
    expect(screen.queryByText('mega.nz')).toBeNull()
  })

  it('single-source F95 shows no tab row and behaves as today', async () => {
    mount({ title: 'Game', f95_id: '95982' })
    await waitFor(() => { expect(screen.getByText('mega.nz')).toBeTruthy() })
    expect(screen.queryByRole('tab')).toBeNull()
    expect(window.electronAPI.lcLinksGet).not.toHaveBeenCalled()
  })

  it('LC-only game loads LC on open with no tab row', async () => {
    mount({ title: 'Game', lc_id: '3272' })
    await waitFor(() => { expect(screen.getByText('vikingfile.com')).toBeTruthy() })
    expect(screen.queryByRole('tab')).toBeNull()
    expect(window.electronAPI.updateLinksGet).not.toHaveBeenCalled()
  })

  it('tier failure renders the reason in the LC tab instead of hiding it', async () => {
    mount(
      { title: 'Game', f95_id: '95982', lc_id: '3272' },
      { lcError: { error: 'This thread needs LewdCorner Member+ — upgrade on lewdcorner.com to unlock it.', code: 'TIER_RESTRICTED' } },
    )
    await waitFor(() => { expect(screen.getByText('mega.nz')).toBeTruthy() })
    fireEvent.click(screen.getByRole('tab', { name: /LewdCorner/i }))
    // The gate lives main-side; the tab stays visible and reports why.
    await waitFor(() => { expect(screen.getByText(/LewdCorner Member\+/)).toBeTruthy() })
    expect(screen.getByRole('tab', { name: /LewdCorner/i })).toBeTruthy()
  })

  it('names the open tab in its load error', async () => {
    window.electronAPI = {
      updateLinksGet: vi.fn().mockResolvedValue({ ok: true, threadId: '95982', links: f95Links }),
      lcLinksGet: vi.fn().mockResolvedValue({ ok: false }),
      openExternalUrl: vi.fn(),
      downloadsResolveMasked: vi.fn(),
      downloadsEnqueue: vi.fn(),
    }
    render(<UpdateModal game={{ title: 'Game', f95_id: '95982', lc_id: '3272' }} open onClose={() => {}} onQueued={() => {}} />)
    await waitFor(() => { expect(screen.getByText('mega.nz')).toBeTruthy() })
    fireEvent.click(screen.getByRole('tab', { name: /LewdCorner/i }))
    await waitFor(() => { expect(screen.getByText('Could not load LewdCorner links')).toBeTruthy() })
  })

  it('an F95 error never blanks working LC links', async () => {    window.electronAPI = {
      updateLinksGet: vi.fn().mockResolvedValue({ ok: false, error: 'F95zone sign-in expired', code: 'NOT_LOGGED_IN' }),
      lcLinksGet: vi.fn().mockResolvedValue({ ok: true, threadId: '3272', links: lcLinks }),
      openExternalUrl: vi.fn(),
      downloadsResolveMasked: vi.fn(),
      downloadsEnqueue: vi.fn().mockResolvedValue({ success: true, item: {} }),
    }
    render(<UpdateModal game={{ title: 'Game', f95_id: '95982', lc_id: '3272' }} open onClose={() => {}} onQueued={() => {}} />)
    await waitFor(() => { expect(screen.getByText(/expired/)).toBeTruthy() })
    fireEvent.click(screen.getByRole('tab', { name: /LewdCorner/i }))
    await waitFor(() => { expect(screen.getByText('vikingfile.com')).toBeTruthy() })
  })

  it('queues with the active tab as source', async () => {
    mount({ title: 'Game', f95_id: '95982', lc_id: '3272' })
    await waitFor(() => { expect(screen.getByText('mega.nz')).toBeTruthy() })
    fireEvent.click(screen.getByRole('tab', { name: /LewdCorner/i }))
    await waitFor(() => { expect(screen.getByText('vikingfile.com')).toBeTruthy() })
    window.electronAPI.downloadsResolveMasked.mockResolvedValue({
      ok: true, url: 'https://vikingfile.com/f/x', host: 'vikingfile.com',
    })
    fireEvent.click(screen.getByText('vikingfile.com'))
    await waitFor(() => { expect(window.electronAPI.downloadsEnqueue).toHaveBeenCalled() })
    expect(window.electronAPI.downloadsEnqueue.mock.calls[0][0].source).toBe('lewdcorner')
  })

  it('names the open tab on Refresh when both tabs exist, plain label otherwise', async () => {
    mount({ title: 'Game', f95_id: '95982', lc_id: '3272' })
    await waitFor(() => { expect(screen.getByText('mega.nz')).toBeTruthy() })
    expect(screen.getByRole('button', { name: 'Refresh F95zone links' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /LewdCorner/i }))
    await waitFor(() => { expect(screen.getByText('vikingfile.com')).toBeTruthy() })
    expect(screen.getByRole('button', { name: 'Refresh LewdCorner links' })).toBeTruthy()
  })

  it('single-source keeps the plain Refresh label', async () => {
    mount({ title: 'Game', f95_id: '95982' })
    await waitFor(() => { expect(screen.getByText('mega.nz')).toBeTruthy() })
    expect(screen.getByRole('button', { name: 'Refresh links' })).toBeTruthy()
  })
})
