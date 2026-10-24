// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react'

import UpdateModal from '../src/components/downloads/UpdateModal.jsx'

// One modal, one tab per linked source. Both linked sources start when the
// modal opens so neither tab waits on the other; a click only switches the
// visible tab. Each fetch goes through update-links-get ({ threadId }) or
// lewdcorner-links-get ({ lcId }), which enforces the tier gate main-side and
// answers TIER_RESTRICTED with the reason.

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
    updateLinksGet: vi.fn().mockResolvedValue({ ok: true, threadId: '95982', links: f95, version: '0.20' }),
    lcLinksGet: vi.fn().mockImplementation(async () =>
      lcError
        ? { ok: false, error: lcError.error, code: lcError.code }
        : { ok: true, threadId: '3272', links: lc, version: '0.19' }),
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
  it('dual-sourced shows both tabs and starts both sources on open', async () => {
    mount({ title: 'Game', f95_id: '95982', lc_id: '3272' })
    await waitFor(() => { expect(screen.getByText('mega.nz')).toBeTruthy() })
    expect(screen.getByRole('tab', { name: /F95/i })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /LewdCorner/i })).toBeTruthy()
    expect(window.electronAPI.updateLinksGet).toHaveBeenCalledWith({ threadId: '95982', force: false })
    // Both sources start up front; the click only switches tabs.
    await waitFor(() => {
      expect(window.electronAPI.lcLinksGet).toHaveBeenCalledWith({ lcId: '3272', force: false })
    })
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

  it('single-source F95 still shows its tab, carrying the version', async () => {
    mount({ title: 'Game', f95_id: '95982' })
    await waitFor(() => { expect(screen.getByText('mega.nz')).toBeTruthy() })
    expect(screen.getByRole('tab', { name: 'F95zone 0.20' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: /LewdCorner/i })).toBeNull()
    expect(window.electronAPI.lcLinksGet).not.toHaveBeenCalled()
  })

  it('LC-only game shows its tab and loads LC on open', async () => {
    mount({ title: 'Game', lc_id: '3272' })
    await waitFor(() => { expect(screen.getByText('vikingfile.com')).toBeTruthy() })
    expect(screen.getByRole('tab', { name: 'LewdCorner 0.19' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: /F95/i })).toBeNull()
    expect(window.electronAPI.updateLinksGet).not.toHaveBeenCalled()
  })

  it('no linked source keeps the tab row out', async () => {
    mount({ title: 'Game' })
    expect(screen.queryByRole('tab')).toBeNull()
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

  it('shows Unknown on a tab whose thread title carries no version', async () => {
    // Dev-only titles like "Bazooka Cafe [Trabulance]" parse to no version:
    // the chip reads Unknown instead of showing a creator name as a version.
    window.electronAPI = {
      updateLinksGet: vi.fn().mockResolvedValue({ ok: true, threadId: '95982', links: f95Links, version: '' }),
      lcLinksGet: vi.fn().mockResolvedValue({ ok: true, threadId: '3272', links: lcLinks, version: '' }),
      openExternalUrl: vi.fn(),
      downloadsResolveMasked: vi.fn(),
      downloadsEnqueue: vi.fn(),
    }
    render(<UpdateModal game={{ title: 'Bazooka Cafe', f95_id: '95982', lc_id: '3272' }} open onClose={() => {}} onQueued={() => {}} />)
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'F95zone Unknown' })).toBeTruthy()
      expect(screen.getByRole('tab', { name: 'LewdCorner Unknown' })).toBeTruthy()
    })
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

  it('a response from the previous game never lands on the next modal', async () => {
    const pending = []
    window.electronAPI = {
      updateLinksGet: vi.fn(() => new Promise((resolve) => pending.push(resolve))),
      lcLinksGet: vi.fn(),
      openExternalUrl: vi.fn(),
      downloadsResolveMasked: vi.fn(),
      downloadsEnqueue: vi.fn(),
    }
    const { rerender } = render(
      <UpdateModal game={{ title: 'Game', f95_id: '111', lc_id: null }} open onClose={() => {}} onQueued={() => {}} />,
    )
    rerender(
      <UpdateModal game={{ title: 'Game', f95_id: '222', lc_id: null }} open onClose={() => {}} onQueued={() => {}} />,
    )
    await waitFor(() => { expect(window.electronAPI.updateLinksGet).toHaveBeenCalledTimes(2) })

    // The first game's slow fetch resolves while the second game's own fetch is
    // still running; its links must not appear on the reopened modal. act
    // flushes the stale write before B resolves, so the assertion cannot pass
    // by B simply overwriting the same state slot afterwards.
    await act(async () => {
      pending[0]({ ok: true, threadId: '111', links: [link('stalehost.com', 'Old Game Build')] })
    })
    expect(screen.queryByText('stalehost.com')).toBeNull()

    await act(async () => {
      pending[1]({ ok: true, threadId: '222', links: f95Links })
    })
    await waitFor(() => { expect(screen.getByText('mega.nz')).toBeTruthy() })
  })
})
