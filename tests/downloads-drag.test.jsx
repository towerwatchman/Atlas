// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, createEvent, act } from '@testing-library/react'

import DownloadsPage from '../src/components/downloads/DownloadsPage.jsx'

// Only Up next rows are draggable. Geometry is stubbed because jsdom has no
// layout: the component captures row boxes at drag start and hit-tests the
// pointer against those boxes, not the live DOM.
const unsubscribe = () => {}
let items
let frames
let nowMs

const queued = (id, title) => ({ id, title, state: 'queued', queueOrder: id })
const finished = (id, title) => ({ id, title, state: 'done', queueOrder: id })
const downloading = (id, title) => ({ id, title, state: 'downloading', queueOrder: id })

const ROW_HEIGHT = 100
const ROW_GAP = 8
const SLOT_PITCH = ROW_HEIGHT + ROW_GAP

const rowFor = (title) =>
  screen.getAllByText(title).map((node) => node.closest('div.group')).find(Boolean)
const rowTitles = () =>
  [...document.querySelectorAll('div.group')]
    .map((row) => row.querySelector('div.truncate')?.textContent)
    .filter(Boolean)
const upNextRows = () => [...document.querySelectorAll('[data-download-row]')]
const upNextWrapper = () => upNextRows()[0].parentElement
const scroller = () => document.querySelector('.downloads-scroll')

const stubGeometry = () => {
  scroller().getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
  upNextRows().forEach((row, index) => {
    // jsdom loads no CSS, so the mb-2 margin must be set explicitly for the
    // last row's pitch fallback.
    row.style.marginBottom = `${ROW_GAP}px`
    row.getBoundingClientRect = () => ({
      top: index * SLOT_PITCH,
      height: ROW_HEIGHT,
      bottom: index * SLOT_PITCH + ROW_HEIGHT,
      left: 0, right: 0, width: 0,
    })
  })
}

const clientYFor = (title, offset = 10) => {
  const index = upNextRows().findIndex((row) => row.querySelector('div.truncate')?.textContent === title)
  return index * SLOT_PITCH + offset
}

const transformOf = (title) => rowFor(title).style.transform
const highlightedTitles = () => upNextRows()
  .filter((row) => row.style.backgroundColor === 'var(--color-selected)')
  .map((row) => row.querySelector('div.truncate')?.textContent)

const mount = async () => {
  await act(async () => {
    render(<DownloadsPage gamesByRecordId={new Map()} />)
  })
  stubGeometry()
}

const transfer = () => {
  let payload = ''
  const dataTransfer = {
    // Chromium hides drag data during dragover; only drop may read it.
    protected: true,
    setData: vi.fn((type, value) => { payload = String(value) }),
    getData: vi.fn(() => (dataTransfer.protected ? '' : payload)),
    setDragImage: vi.fn(),
  }
  return dataTransfer
}

// jsdom has no DragEvent, so createEvent drops clientX/clientY. Put them back.
const pointerEvent = (name, target, clientY, dataTransfer, clientX = 0) => {
  const event = createEvent[name](target, { dataTransfer, clientY })
  Object.defineProperty(event, 'clientY', { value: clientY })
  Object.defineProperty(event, 'clientX', { value: clientX })
  return event
}

const startDrag = async (title, dataTransfer) => {
  await act(async () => {
    fireEvent.dragStart(rowFor(title).querySelector('[title="Drag to reorder"]'), { dataTransfer })
  })
}
const dragOver = async (clientY, dataTransfer, target) => {
  await act(async () => {
    fireEvent(target || upNextWrapper(), pointerEvent('dragOver', target || upNextWrapper(), clientY, dataTransfer))
  })
}
const dropAt = async (clientY, dataTransfer) => {
  dataTransfer.protected = false
  await act(async () => {
    fireEvent(upNextWrapper(), pointerEvent('drop', upNextWrapper(), clientY, dataTransfer))
  })
}
const drag = async (from, to, dataTransfer) => {
  await startDrag(from, dataTransfer)
  const y = clientYFor(to)
  await dragOver(y, dataTransfer)
  await dropAt(y, dataTransfer)
}
const dragEnd = async (title) => {
  await act(async () => {
    fireEvent.dragEnd(rowFor(title).querySelector('[title="Drag to reorder"]'))
  })
}
const mouseMove = async () => {
  await act(async () => { fireEvent.mouseMove(upNextWrapper()) })
}
const mouseLeave = async () => {
  await act(async () => { fireEvent.mouseLeave(upNextWrapper()) })
}
const runFrames = async () => {
  await act(async () => { frames.splice(0).forEach((callback) => callback()) })
}
const stubClock = () => {
  nowMs = 1000
  vi.stubGlobal('performance', { now: () => nowMs })
}

beforeEach(() => {
  items = []
  frames = []
  vi.stubGlobal('requestAnimationFrame', (callback) => { frames.push(callback); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  window.electronAPI = {
    downloadsList: vi.fn(async () => ({ success: true, items: [...items] })),
    downloadsReorder: vi.fn(async ({ ids }) => {
      await Promise.resolve()
      const byId = new Map(items.map((item) => [item.id, item]))
      items = [...ids.map((id) => byId.get(id)), ...items.filter((item) => !ids.includes(item.id))]
      return { success: true }
    }),
    downloadsFolder: vi.fn(async () => ({ success: true, path: '/tmp' })),
    downloadsAction: vi.fn(async () => ({ success: true })),
    downloadsRemove: vi.fn(async () => ({ success: true })),
    downloadsReveal: vi.fn(async () => ({ success: true })),
    downloadsOpenFolder: vi.fn(async () => ({ success: true })),
    downloadsClearFinished: vi.fn(async () => ({ success: true })),
    downloadsAttachFile: vi.fn(async () => ({ success: true })),
    getCatalogEntry: vi.fn(async () => ({ success: false })),
    openExternalUrl: vi.fn(),
    onDownloadAdded: unsubscribe,
    onDownloadUpdated: unsubscribe,
    onDownloadRemoved: unsubscribe,
    onDownloadsChanged: unsubscribe,
  }
})

afterEach(() => {
  cleanup()
  delete window.electronAPI
  vi.unstubAllGlobals()
})

describe('drag to reorder queued downloads', () => {
  it('puts a handle on Up next rows only and ignores drops on other sections', async () => {
    items = [queued(1, 'A'), queued(2, 'B'), queued(3, 'C'), finished(4, 'D'), downloading(5, 'P')]
    await mount()

    expect(rowFor('A').querySelector('[title="Drag to reorder"]').getAttribute('draggable')).toBe('true')
    expect(rowFor('A').getAttribute('data-download-row')).toBe('1')
    expect(rowFor('D').querySelector('[draggable]')).toBeNull()
    expect(rowFor('P').querySelector('[draggable]')).toBeNull()
    expect(rowFor('D').getAttribute('data-download-row')).toBeNull()
    expect(rowFor('P').getAttribute('data-download-row')).toBeNull()

    const dataTransfer = transfer()
    dataTransfer.setData('text/plain', '1')
    await act(async () => {
      fireEvent.drop(rowFor('D'), { dataTransfer })
      fireEvent.drop(rowFor('P'), { dataTransfer })
    })
    expect(window.electronAPI.downloadsReorder).not.toHaveBeenCalled()
  })

  it('moves a row before its target on an upward drag', async () => {
    items = [queued(1, 'A'), queued(2, 'B'), queued(3, 'C'), finished(4, 'X')]
    await mount()
    const dataTransfer = transfer()
    await drag('C', 'A', dataTransfer)
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', '3')
    expect(window.electronAPI.downloadsReorder).toHaveBeenCalledWith({ ids: [3, 1, 2] })
    expect(screen.queryByTitle('Move up')).toBeNull()
    expect(screen.queryByTitle('Move down')).toBeNull()
  })

  it('lands after its target on a downward drag, using the post-removal index', async () => {
    items = [queued(1, 'A'), queued(2, 'B'), queued(3, 'C'), queued(4, 'D')]
    await mount()
    await drag('A', 'C', transfer())
    expect(window.electronAPI.downloadsReorder).toHaveBeenCalledWith({ ids: [2, 3, 1, 4] })
  })

  it('drops using the order shown after Reverse', async () => {
    items = [queued(1, 'A'), queued(2, 'B'), queued(3, 'C')]
    await mount()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /reverse up next/i })) })
    stubGeometry()
    await drag('A', 'C', transfer())
    expect(window.electronAPI.downloadsReorder).toHaveBeenLastCalledWith({ ids: [1, 3, 2] })
  })

  it('ignores self drops, non-numeric ids and stale ids', async () => {
    items = [queued(1, 'A'), queued(2, 'B'), queued(3, 'C'), finished(4, 'X')]
    await mount()
    await drag('A', 'A', transfer())
    const bad = transfer()
    bad.setData('text/plain', 'not-an-id')
    await dropAt(clientYFor('A'), bad)
    const stale = transfer()
    stale.setData('text/plain', '99')
    await dropAt(clientYFor('A'), stale)
    const finishedId = transfer()
    finishedId.setData('text/plain', '4')
    await dropAt(clientYFor('A'), finishedId)
    expect(window.electronAPI.downloadsReorder).not.toHaveBeenCalled()
  })

  it('uses the grabbed row as the drag image at the pointer offset', async () => {
    items = [queued(1, 'A'), queued(2, 'B'), queued(3, 'C')]
    await mount()
    const dataTransfer = transfer()
    const handle = rowFor('C').querySelector('[title="Drag to reorder"]')
    const event = createEvent.dragStart(handle, { dataTransfer })
    Object.defineProperty(event, 'clientX', { value: 30 })
    Object.defineProperty(event, 'clientY', { value: SLOT_PITCH * 2 + 25 })
    await act(async () => { fireEvent(handle, event) })
    expect(dataTransfer.setDragImage).toHaveBeenCalledWith(rowFor('C'), 30, 25)
  })
})

describe('drag preview and landing', () => {
  const seed = () => {
    items = [queued(1, 'A'), queued(2, 'B'), queued(3, 'C'), finished(4, 'X')]
  }
  const seedFour = () => {
    items = [queued(1, 'A'), queued(2, 'B'), queued(3, 'C'), queued(4, 'D')]
  }

  it('keeps committed DOM order and shifts rows visually while previewing', async () => {
    seed()
    await mount()
    const dataTransfer = transfer()
    await startDrag('C', dataTransfer)
    await dragOver(clientYFor('A'), dataTransfer)
    // A dragover fired from a row bubbles to the wrapper handler.
    await dragOver(clientYFor('A'), dataTransfer, rowFor('A'))
    await dragOver(clientYFor('A'), dataTransfer)
    expect(rowTitles()).toEqual(['A', 'B', 'C', 'X'])
    expect(transformOf('C')).toBe('translateY(-216px)')
    expect(transformOf('A')).toBe('translateY(108px)')
    expect(transformOf('B')).toBe('translateY(108px)')
    expect(highlightedTitles()).toEqual(['C'])
    expect(window.electronAPI.downloadsReorder).not.toHaveBeenCalled()
  })

  it('corrects the target for scroll during the drag', async () => {
    seed()
    await mount()
    const dataTransfer = transfer()
    await startDrag('C', dataTransfer)
    scroller().scrollTop = 100
    await dragOver(clientYFor('A'), dataTransfer)
    expect(transformOf('C')).toBe('translateY(-108px)')
    expect(transformOf('A')).toBe('translateY(0px)')
    expect(transformOf('B')).toBe('translateY(108px)')
  })

  it('commits the previewed order and clears the preview on drop', async () => {
    seed()
    await mount()
    const dataTransfer = transfer()
    await startDrag('C', dataTransfer)
    await dragOver(clientYFor('A'), dataTransfer)
    await dropAt(clientYFor('A'), dataTransfer)
    expect(window.electronAPI.downloadsReorder).toHaveBeenCalledWith({ ids: [3, 1, 2] })
    expect(rowTitles()).toEqual(['C', 'A', 'B', 'X'])
    expect(['A', 'B', 'C'].map(transformOf)).toEqual([
      'translateY(0px)', 'translateY(0px)', 'translateY(0px)',
    ])
    expect(highlightedTitles()).toEqual(['C'])
    expect(['A', 'B', 'C'].map((title) => rowFor(title).style.transition)).toEqual([
      'none', 'none', 'none',
    ])
    await runFrames()
    expect(['A', 'B', 'C'].map((title) => rowFor(title).style.transition)).toEqual([
      'transform 180ms ease', 'transform 180ms ease', 'transform 180ms ease',
    ])
  })

  it('clears the preview on dragEnd without reordering', async () => {
    seed()
    await mount()
    const dataTransfer = transfer()
    await startDrag('C', dataTransfer)
    await dragOver(clientYFor('A'), dataTransfer)
    expect(transformOf('C')).toBe('translateY(-216px)')
    await dragEnd('C')
    expect(rowTitles()).toEqual(['A', 'B', 'C', 'X'])
    expect(['A', 'B', 'C'].map(transformOf)).toEqual([
      'translateY(0px)', 'translateY(0px)', 'translateY(0px)',
    ])
    expect(window.electronAPI.downloadsReorder).not.toHaveBeenCalled()
    expect(upNextWrapper().classList.contains('downloads-dragging')).toBe(false)
  })

  it('keeps the slot highlight through the drop until a mouse move after the guard', async () => {
    seed()
    stubClock()
    await mount()
    expect(upNextWrapper().classList.contains('downloads-dragging')).toBe(false)

    const dataTransfer = transfer()
    await startDrag('C', dataTransfer)
    expect(upNextWrapper().classList.contains('downloads-dragging')).toBe(true)
    await dragOver(clientYFor('A'), dataTransfer)
    await dropAt(clientYFor('A'), dataTransfer)
    expect(upNextWrapper().classList.contains('downloads-dragging')).toBe(true)
    expect(highlightedTitles()).toEqual(['C'])

    await mouseMove()
    expect(highlightedTitles()).toEqual(['C'])
    nowMs += 300
    await mouseMove()
    expect(highlightedTitles()).toEqual([])
    expect(upNextWrapper().classList.contains('downloads-dragging')).toBe(false)
  })

  it('previews and lands in the slot under the pointer on a downward drag', async () => {
    seed()
    await mount()
    const dataTransfer = transfer()
    await startDrag('A', dataTransfer)
    await dragOver(clientYFor('C'), dataTransfer)

    expect(rowTitles()).toEqual(['A', 'B', 'C', 'X'])
    expect(['A', 'B', 'C'].map(transformOf)).toEqual([
      'translateY(216px)', 'translateY(-108px)', 'translateY(-108px)',
    ])
    expect(highlightedTitles()).toEqual(['A'])
    expect(window.electronAPI.downloadsReorder).not.toHaveBeenCalled()

    await dropAt(clientYFor('C'), dataTransfer)
    expect(window.electronAPI.downloadsReorder).toHaveBeenCalledWith({ ids: [2, 3, 1] })
    expect(rowTitles()).toEqual(['B', 'C', 'A', 'X'])
    expect(highlightedTitles()).toEqual(['A'])
  })

  it('targets the last slot when the pointer is past the final row', async () => {
    seedFour()
    await mount()
    const dataTransfer = transfer()
    const pastLast = clientYFor('D', SLOT_PITCH)
    await startDrag('A', dataTransfer)
    await dragOver(pastLast, dataTransfer)

    expect(highlightedTitles()).toEqual(['A'])
    expect(transformOf('A')).toBe('translateY(324px)')
    expect(['B', 'C', 'D'].map(transformOf)).toEqual([
      'translateY(-108px)', 'translateY(-108px)', 'translateY(-108px)',
    ])

    await dropAt(pastLast, dataTransfer)
    expect(window.electronAPI.downloadsReorder).toHaveBeenCalledWith({ ids: [2, 3, 4, 1] })
    expect(rowTitles()).toEqual(['B', 'C', 'D', 'A'])
    expect(highlightedTitles()).toEqual(['A'])
  })

  it('treats the gap below a row as part of that slot', async () => {
    seedFour()
    await mount()
    const dataTransfer = transfer()
    await startDrag('A', dataTransfer)

    await dragOver(clientYFor('B', 0), dataTransfer)
    const preview = ['A', 'B', 'C', 'D'].map(transformOf)
    expect(preview).toEqual([
      'translateY(108px)', 'translateY(-108px)', 'translateY(0px)', 'translateY(0px)',
    ])
    expect(highlightedTitles()).toEqual(['A'])

    // The row's margin belongs to its slot; the next slot starts at the next top.
    await dragOver(clientYFor('B', ROW_HEIGHT), dataTransfer)
    expect(['A', 'B', 'C', 'D'].map(transformOf)).toEqual(preview)
    expect(highlightedTitles()).toEqual(['A'])

    await dragOver(clientYFor('B', SLOT_PITCH), dataTransfer)
    expect(transformOf('A')).toBe('translateY(216px)')
    expect(highlightedTitles()).toEqual(['A'])
  })

  it('treats a pointer above the first row as the first slot', async () => {
    seedFour()
    await mount()
    const dataTransfer = transfer()
    await startDrag('D', dataTransfer)

    await dragOver(-20, dataTransfer)
    expect(transformOf('D')).toBe('translateY(-324px)')
    expect(highlightedTitles()).toEqual(['D'])
    const preview = ['A', 'B', 'C', 'D'].map(transformOf)

    await dragOver(0, dataTransfer)
    expect(['A', 'B', 'C', 'D'].map(transformOf)).toEqual(preview)
    expect(highlightedTitles()).toEqual(['D'])

    await dragOver(SLOT_PITCH, dataTransfer)
    expect(transformOf('D')).toBe('translateY(-216px)')
    expect(highlightedTitles()).toEqual(['D'])
  })

  it('leaves the preview unchanged on repeated dragover events at one position', async () => {
    seed()
    await mount()
    const dataTransfer = transfer()
    await startDrag('C', dataTransfer)
    await dragOver(clientYFor('A'), dataTransfer)
    const preview = ['A', 'B', 'C'].map(transformOf)
    expect(preview).toEqual(['translateY(108px)', 'translateY(108px)', 'translateY(-216px)'])

    await dragOver(clientYFor('A'), dataTransfer, rowFor('A'))
    await dragOver(clientYFor('A'), dataTransfer)
    expect(rowTitles()).toEqual(['A', 'B', 'C', 'X'])
    expect(['A', 'B', 'C'].map(transformOf)).toEqual(preview)
    expect(highlightedTitles()).toEqual(['C'])
    expect(window.electronAPI.downloadsReorder).not.toHaveBeenCalled()
  })

  it.each([
    ['mouse move', mouseMove],
    ['mouse leave', mouseLeave],
  ])('clears the landing highlight on %s only after the suppression window', async (_label, clear) => {
    seed()
    stubClock()
    await mount()
    const dataTransfer = transfer()
    await startDrag('C', dataTransfer)
    await dragOver(clientYFor('A'), dataTransfer)
    await dropAt(clientYFor('A'), dataTransfer)
    expect(highlightedTitles()).toEqual(['C'])

    await clear()
    expect(highlightedTitles()).toEqual(['C'])
    nowMs += 299
    await clear()
    expect(highlightedTitles()).toEqual(['C'])
    expect(upNextWrapper().classList.contains('downloads-dragging')).toBe(true)

    nowMs += 1
    await clear()
    expect(highlightedTitles()).toEqual([])
    expect(upNextWrapper().classList.contains('downloads-dragging')).toBe(false)
  })

  it('keeps the landing highlight through dragEnd until the guard expires', async () => {
    seed()
    stubClock()
    await mount()
    const dataTransfer = transfer()
    await startDrag('C', dataTransfer)
    await dragOver(clientYFor('A'), dataTransfer)
    await dropAt(clientYFor('A'), dataTransfer)
    expect(highlightedTitles()).toEqual(['C'])

    await dragEnd('C')
    expect(window.electronAPI.downloadsReorder).toHaveBeenCalledTimes(1)
    expect(rowTitles()).toEqual(['C', 'A', 'B', 'X'])
    expect(highlightedTitles()).toEqual(['C'])
    expect(upNextWrapper().classList.contains('downloads-dragging')).toBe(true)

    await mouseMove()
    expect(highlightedTitles()).toEqual(['C'])

    nowMs += 300
    await dragEnd('C')
    expect(highlightedTitles()).toEqual([])
    expect(upNextWrapper().classList.contains('downloads-dragging')).toBe(false)
  })

  it('keeps the persisted order untouched until the drop commits it once', async () => {
    seedFour()
    await mount()
    const dataTransfer = transfer()
    await startDrag('D', dataTransfer)
    await dragOver(clientYFor('A'), dataTransfer)
    await dragOver(clientYFor('B'), dataTransfer)
    await dragOver(clientYFor('C'), dataTransfer)
    await dragOver(clientYFor('A'), dataTransfer)

    expect(rowTitles()).toEqual(['A', 'B', 'C', 'D'])
    expect(transformOf('D')).toBe('translateY(-324px)')
    expect(window.electronAPI.downloadsReorder).not.toHaveBeenCalled()

    await dropAt(clientYFor('A'), dataTransfer)
    expect(window.electronAPI.downloadsReorder).toHaveBeenCalledTimes(1)
    expect(window.electronAPI.downloadsReorder).toHaveBeenCalledWith({ ids: [4, 1, 2, 3] })
    expect(rowTitles()).toEqual(['D', 'A', 'B', 'C'])
  })
})