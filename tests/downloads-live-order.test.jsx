// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'

import DownloadsPage from '../src/components/downloads/DownloadsPage.jsx'

// Live events carry one row at a time. The rendered list must stay in the same
// order as listDownloads: non-terminal rows first, then queueOrder, then id.
const rowTitles = (container) =>
  [...container.querySelectorAll('div.group')].map((row) => row.querySelector('.truncate')?.textContent || '')

const unsubscribe = () => {}

describe('live download events keep the rendered list in queue order', () => {
  let onAdded, onUpdated

  beforeEach(() => {
    onAdded = unsubscribe
    onUpdated = unsubscribe
    window.electronAPI = {
      downloadsList: vi.fn().mockResolvedValue({
        success: true,
        items: [
          { id: 1, title: 'A', state: 'queued', queueOrder: 0 },
          { id: 2, title: 'B', state: 'queued', queueOrder: 1 },
          { id: 3, title: 'X', state: 'done', queueOrder: 2 },
        ],
      }),
      downloadsFolder: vi.fn().mockResolvedValue({ success: true, path: '/tmp' }),
      downloadsAction: vi.fn().mockResolvedValue({ success: true }),
      downloadsRemove: vi.fn().mockResolvedValue({ success: true }),
      downloadsReorder: vi.fn().mockResolvedValue({ success: true }),
      downloadsReveal: vi.fn().mockResolvedValue({ success: true }),
      downloadsOpenFolder: vi.fn().mockResolvedValue({ success: true }),
      downloadsClearFinished: vi.fn().mockResolvedValue({ success: true }),
      downloadsAttachFile: vi.fn().mockResolvedValue({ success: true }),
      openExternalUrl: vi.fn(),
      onDownloadAdded: (cb) => { onAdded = cb; return unsubscribe },
      onDownloadUpdated: (cb) => { onUpdated = cb; return unsubscribe },
      onDownloadRemoved: unsubscribe,
      onDownloadsChanged: unsubscribe,
    }
  })

  afterEach(() => {
    cleanup()
    delete window.electronAPI
  })

  it('sorts rows after each add and update event', async () => {
    let container
    await act(async () => {
      const result = render(<DownloadsPage gamesByRecordId={new Map()} />)
      container = result.container
    })

    expect(rowTitles(container)).toEqual(['A', 'B', 'X'])

    await act(async () => {
      onAdded({ id: 4, title: 'C', state: 'queued', queueOrder: -1 })
    })
    expect(rowTitles(container)).toEqual(['C', 'A', 'B', 'X'])

    await act(async () => {
      onUpdated({ id: 1, title: 'A', state: 'done', queueOrder: -2 })
    })
    expect(rowTitles(container)).toEqual(['C', 'B', 'A', 'X'])

    await act(async () => {
      onUpdated({ id: 2, title: 'B', state: 'queued', queueOrder: -5 })
    })
    expect(rowTitles(container)).toEqual(['B', 'C', 'A', 'X'])
  })
})
