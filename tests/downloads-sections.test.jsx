// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, act } from '@testing-library/react'

import DownloadsPage from '../src/components/downloads/DownloadsPage.jsx'

// Reorder rewrites only the ids it is handed. Keeping the backing list as an id
// order array lets a refresh after each reverse show the new order too.
const unsubscribe = () => {}
const queued = (id, title) => ({ id, title, state: 'queued', queueOrder: id })
const done = (id, title) => ({ id, title, state: 'done', queueOrder: id })

let byId
let order

const seed = (rows) => {
  byId = new Map(rows.map((row) => [row.id, row]))
  order = rows.map((row) => row.id)
}

const stubElectronAPI = () => ({
  // refresh() only accepts success:true and keeps the array it is handed, so
  // every list call has to return a fresh one.
  downloadsList: vi.fn(async () => ({ success: true, items: order.map((id) => byId.get(id)) })),
  downloadsFolder: vi.fn().mockResolvedValue({ success: true, path: '/tmp' }),
  downloadsAction: vi.fn().mockResolvedValue({ success: true }),
  downloadsRemove: vi.fn().mockResolvedValue({ success: true }),
  downloadsReorder: vi.fn(async ({ ids }) => {
    await Promise.resolve()
    const slots = order.map((id, index) => (ids.includes(id) ? index : -1)).filter((index) => index >= 0)
    const next = ids.slice()
    slots.forEach((slot, index) => { order[slot] = next[index] })
    return { success: true }
  }),
  downloadsReveal: vi.fn().mockResolvedValue({ success: true }),
  downloadsOpenFolder: vi.fn().mockResolvedValue({ success: true }),
  downloadsClearFinished: vi.fn().mockResolvedValue({ success: true }),
  downloadsAttachFile: vi.fn().mockResolvedValue({ success: true }),
  openExternalUrl: vi.fn(),
  onDownloadAdded: unsubscribe,
  onDownloadUpdated: unsubscribe,
  onDownloadRemoved: unsubscribe,
  onDownloadsChanged: unsubscribe,
})

const renderPage = async () => {
  let view
  await act(async () => {
    view = render(<DownloadsPage gamesByRecordId={new Map()} />)
  })
  return view
}

const click = async (view, label) => {
  await act(async () => {
    fireEvent.click(view.getByRole('button', { name: label }))
  })
}

beforeEach(() => {
  seed([queued(1, 'A'), queued(2, 'B'), queued(3, 'C'), done(4, 'X'), done(5, 'Y')])
  window.electronAPI = stubElectronAPI()
})

afterEach(() => {
  cleanup()
  delete window.electronAPI
})

describe('download sections collapse and expand on their own', () => {
  it('hides and restores Up next rows without touching Completed', async () => {
    const view = await renderPage()
    expect(view.queryAllByText('A')).toHaveLength(2)
    expect(view.queryAllByText('X')).toHaveLength(2)

    await click(view, 'Collapse Up next')
    expect(view.queryAllByText('A')).toHaveLength(0)
    expect(view.queryAllByText('X')).toHaveLength(2)

    await click(view, 'Expand Up next')
    expect(view.queryAllByText('A')).toHaveLength(2)
  })

  it('collapses Completed without touching Up next', async () => {
    const view = await renderPage()
    await click(view, 'Collapse Completed')
    expect(view.queryAllByText('X')).toHaveLength(0)
    expect(view.queryAllByText('A')).toHaveLength(2)

    await click(view, 'Expand Completed')
    expect(view.queryAllByText('X')).toHaveLength(2)
  })
})

describe('Reverse rewrites only one section', () => {
  it('reverses Up next and refreshes', async () => {
    const view = await renderPage()
    await click(view, 'Reverse Up next order')
    expect(window.electronAPI.downloadsReorder).toHaveBeenCalledTimes(1)
    expect(window.electronAPI.downloadsReorder).toHaveBeenCalledWith({ ids: [3, 2, 1] })
    expect(window.electronAPI.downloadsList).toHaveBeenCalledTimes(2)
  })

  it('has no sort control for Completed and keeps its rows newest-first', async () => {
    const view = await renderPage()
    expect(view.queryByRole('button', { name: 'Reverse Completed order' })).toBeNull()
    expect(view.getAllByText(/^(X|Y)$/).map((node) => node.textContent)).toEqual(['X', 'X', 'Y', 'Y'])
  })

  it('restores the original ids when reversed twice', async () => {
    const view = await renderPage()
    await click(view, 'Reverse Up next order')
    expect(window.electronAPI.downloadsReorder).toHaveBeenLastCalledWith({ ids: [3, 2, 1] })
    await click(view, 'Reverse Up next order')
    expect(window.electronAPI.downloadsReorder).toHaveBeenLastCalledWith({ ids: [1, 2, 3] })
    expect(order).toEqual([1, 2, 3, 4, 5])
  })

  it('handles a section with a single row', async () => {
    seed([queued(1, 'A')])
    window.electronAPI = stubElectronAPI()
    const view = await renderPage()
    await click(view, 'Reverse Up next order')
    expect(window.electronAPI.downloadsReorder).toHaveBeenCalledWith({ ids: [1] })
  })

  it('has no Reverse control for an empty Up next', async () => {
    seed([{ id: 9, title: 'Live', state: 'downloading', queueOrder: 9 }])
    window.electronAPI = stubElectronAPI()
    const view = await renderPage()
    expect(view.queryByRole('button', { name: 'Reverse Up next order' })).toBeNull()
    expect(view.getByText('There are no downloads in the queue')).toBeTruthy()
  })

  it('has no Completed controls when there are no finished rows', async () => {
    seed([queued(1, 'A')])
    window.electronAPI = stubElectronAPI()
    const view = await renderPage()
    expect(view.queryByRole('button', { name: 'Collapse Completed' })).toBeNull()
    expect(view.queryByRole('button', { name: 'Reverse Completed order' })).toBeNull()
  })
})