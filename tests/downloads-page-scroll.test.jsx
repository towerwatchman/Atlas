// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, act } from '@testing-library/react'

import DownloadsPage from '../src/components/downloads/DownloadsPage.jsx'

// ── Downloads page scroll region ─────────────────────────────────────────────
//
// App.jsx mounts this view as a direct child of a pane that is `overflow-hidden`
// for every non-detail view (see the className at the `selectedGame ? ... : ...`
// branch). So the list cannot rely on an ancestor to scroll it -- the old
// comment in this file claimed #gameGrid did, and it does not appear in that
// path at all. Before the fix the list was clipped to a screenful and the
// entries below the fold were unreachable.
//
// The scrollbar itself is hidden until the user scrolls or moves into the
// right-side zone, toggled by a `scrollbar-visible` class rather than a CSS
// `:hover` rule (which would show it anywhere over the list).
//
// These assert the rendered DOM and the class transitions rather than grepping
// the source: a text match passes on any file containing the right strings,
// fails on harmless reformatting, and cannot see whether the timers actually
// hide the bar again.

const noop = () => {}
const unsubscribe = () => noop

const stubElectronAPI = () => ({
  downloadsList: vi.fn().mockResolvedValue({ ok: true, items: [] }),
  downloadsFolder: vi.fn().mockResolvedValue({ ok: true, path: '/tmp' }),
  downloadsAction: vi.fn().mockResolvedValue({ ok: true }),
  downloadsRemove: vi.fn().mockResolvedValue({ ok: true }),
  downloadsReorder: vi.fn().mockResolvedValue({ ok: true }),
  downloadsReveal: vi.fn().mockResolvedValue({ ok: true }),
  downloadsOpenFolder: vi.fn().mockResolvedValue({ ok: true }),
  downloadsClearFinished: vi.fn().mockResolvedValue({ ok: true }),
  downloadsAttachFile: vi.fn().mockResolvedValue({ ok: true }),
  openExternalUrl: vi.fn(),
  onDownloadAdded: unsubscribe,
  onDownloadUpdated: unsubscribe,
  onDownloadRemoved: unsubscribe,
  onDownloadsChanged: unsubscribe,
})

const renderPage = async () => {
  let result
  await act(async () => {
    result = render(<DownloadsPage gamesByRecordId={new Map()} />)
  })
  return result
}

// The scrolling element: the only overflow-y-auto box in the view.
const scroller = (container) => container.querySelector('.downloads-scroll')

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  window.electronAPI = stubElectronAPI()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  delete window.electronAPI
})

describe('the Downloads page scrolls its own list', () => {
  it('renders exactly one scroll container, below a pinned header', async () => {
    const { container } = await renderPage()

    const scrollers = container.querySelectorAll('.overflow-y-auto')
    expect(scrollers).toHaveLength(1)

    const box = scroller(container)
    expect(box).toBeTruthy()
    expect(box.className).toContain('overflow-y-auto')

    // The view root fills the pane and does not itself scroll -- otherwise the
    // header would scroll away with the list.
    const root = container.firstElementChild
    expect(root.className).toContain('h-full')
    expect(root.className).toContain('overflow-hidden')
    expect(root.className).not.toContain('overflow-y-auto')

    // The header is a sibling of the scroller, not inside it.
    const header = root.firstElementChild
    expect(header.className).toContain('shrink-0')
    expect(header.contains(box)).toBe(false)
    expect(header.textContent).toContain('Downloads')
  })
})

describe('the scrollbar is hidden until it is needed', () => {
  it('starts hidden', async () => {
    const { container } = await renderPage()
    expect(scroller(container).className).not.toContain('scrollbar-visible')
  })

  it('appears on scroll and hides again once scrolling stops', async () => {
    const { container } = await renderPage()
    const box = scroller(container)

    fireEvent.scroll(box)
    expect(box.className).toContain('scrollbar-visible')

    // Still up midway through the grace period, so a pause mid-scroll does not
    // flicker it.
    await act(async () => { vi.advanceTimersByTime(300) })
    expect(box.className).toContain('scrollbar-visible')

    await act(async () => { vi.advanceTimersByTime(300) })
    expect(box.className).not.toContain('scrollbar-visible')
  })

  it('appears when the cursor enters the right-side zone and not before', async () => {
    const { container } = await renderPage()
    const box = scroller(container)
    // jsdom has no layout, so the rect is supplied.
    box.getBoundingClientRect = () => ({ left: 0, right: 800, top: 0, bottom: 600, width: 800, height: 600 })

    // Well clear of the edge: nothing happens.
    fireEvent.mouseMove(box, { clientX: 400 })
    expect(box.className).not.toContain('scrollbar-visible')

    // Inside the 60px zone.
    fireEvent.mouseMove(box, { clientX: 780 })
    expect(box.className).toContain('scrollbar-visible')
  })

  it('stays up while the cursor remains in the zone', async () => {
    const { container } = await renderPage()
    const box = scroller(container)
    box.getBoundingClientRect = () => ({ left: 0, right: 800, top: 0, bottom: 600, width: 800, height: 600 })

    fireEvent.mouseMove(box, { clientX: 780 })
    // Well past the hide delay, with the cursor still in the zone.
    await act(async () => { vi.advanceTimersByTime(2000) })
    expect(box.className).toContain('scrollbar-visible')
  })

  it('hides after the cursor leaves the zone, and survives a re-entry', async () => {
    const { container } = await renderPage()
    const box = scroller(container)
    box.getBoundingClientRect = () => ({ left: 0, right: 800, top: 0, bottom: 600, width: 800, height: 600 })

    fireEvent.mouseMove(box, { clientX: 780 })
    fireEvent.mouseMove(box, { clientX: 400 })
    // Grace period: still visible.
    await act(async () => { vi.advanceTimersByTime(300) })
    expect(box.className).toContain('scrollbar-visible')

    // Re-entering during the grace period must keep it up, not restart a cycle
    // that leaves it hidden.
    fireEvent.mouseMove(box, { clientX: 780 })
    await act(async () => { vi.advanceTimersByTime(2000) })
    expect(box.className).toContain('scrollbar-visible')

    // Leaving for good hides it.
    fireEvent.mouseMove(box, { clientX: 400 })
    await act(async () => { vi.advanceTimersByTime(600) })
    expect(box.className).not.toContain('scrollbar-visible')
  })

  it('hides when the pointer leaves the list entirely', async () => {
    const { container } = await renderPage()
    const box = scroller(container)
    box.getBoundingClientRect = () => ({ left: 0, right: 800, top: 0, bottom: 600, width: 800, height: 600 })

    fireEvent.mouseMove(box, { clientX: 780 })
    fireEvent.mouseLeave(box)
    await act(async () => { vi.advanceTimersByTime(600) })
    expect(box.className).not.toContain('scrollbar-visible')
  })

  it('keeps the bar up when a scroll is still within its own grace period', async () => {
    // The two reasons are independent: leaving the zone must not cancel a hide
    // that scrolling owns.
    const { container } = await renderPage()
    const box = scroller(container)
    box.getBoundingClientRect = () => ({ left: 0, right: 800, top: 0, bottom: 600, width: 800, height: 600 })

    fireEvent.mouseMove(box, { clientX: 780 })
    fireEvent.scroll(box)
    fireEvent.mouseLeave(box)
    await act(async () => { vi.advanceTimersByTime(300) })
    expect(box.className).toContain('scrollbar-visible')
  })
})
