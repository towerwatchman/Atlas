import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  HISTORY_LIMIT,
  VIEWS,
  createHistory,
  currentSnapshot,
  isSamePage,
  pushSnapshot,
  goBack,
  goForward,
  saveHistory,
  loadHistory,
  clearHistory,
} from '../src/lib/navigationHistory.js'

const STORAGE_KEY = 'atlas:view-history-v2'

const browse = (savedFilterId = null, collectionId = null) => ({
  view: 'browse', game: null, savedFilterId, collectionId,
})
const detail = (game) => ({ view: 'detail', game, savedFilterId: null, collectionId: null })
const page = (view, savedFilterId = null, collectionId = null) => ({
  view, game: null, savedFilterId, collectionId,
})

let store

beforeEach(() => {
  store = new Map()
  vi.stubGlobal('sessionStorage', {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('navigationHistory', () => {
  it('push, back and forward move the index and return the same snapshot', () => {
    const a = browse()
    const b = detail({ record_id: 7, title: 'Example' })

    let history = pushSnapshot(createHistory(), a)
    history = pushSnapshot(history, b)
    expect(history.index).toBe(1)
    expect(currentSnapshot(history)).toEqual(b)

    const back = goBack(history)
    expect(back.snapshot).toEqual(a)
    expect(back.history.index).toBe(0)

    const forward = goForward(back.history)
    expect(forward.snapshot).toEqual(b)
    expect(forward.history.index).toBe(1)
  })

  it('restores each snapshot across several steps in either direction', () => {
    const a = browse()
    const b = detail({ record_id: 1 })
    const c = page('library')

    let history = pushSnapshot(createHistory(), a)
    history = pushSnapshot(history, b)
    history = pushSnapshot(history, c)
    expect(history.index).toBe(2)

    const back1 = goBack(history)
    expect(back1.snapshot).toEqual(b)
    expect(back1.history.index).toBe(1)
    const back2 = goBack(back1.history)
    expect(back2.snapshot).toEqual(a)
    expect(back2.history.index).toBe(0)

    const forward1 = goForward(back2.history)
    expect(forward1.snapshot).toEqual(b)
    expect(forward1.history.index).toBe(1)
    const forward2 = goForward(forward1.history)
    expect(forward2.snapshot).toEqual(c)
    expect(forward2.history.index).toBe(2)
  })

  it('drops the forward tail when pushing after going back', () => {
    const a = browse()
    const b = detail({ record_id: 1 })
    const c = { view: 'library', game: null }
    const d = page('downloads')

    let history = pushSnapshot(createHistory(), a)
    history = pushSnapshot(history, b)
    history = pushSnapshot(history, c)

    const back = goBack(history)
    expect(back.history.index).toBe(1)

    const pushed = pushSnapshot(back.history, d)
    expect(pushed.entries).toHaveLength(3)
    expect(pushed.index).toBe(2)
    expect(currentSnapshot(pushed)).toEqual(d)
    expect(pushed.entries[2]).toEqual(d)
    expect(goForward(pushed)).toBeNull()
  })

  it('replaces the current entry when pushing the same page again', () => {
    const a = browse()
    const b = detail({ record_id: 1, title: 'Old' })

    let history = pushSnapshot(createHistory(), a)
    history = pushSnapshot(history, b)

    const updated = detail({ record_id: 1, title: 'New' })
    history = pushSnapshot(history, updated)
    expect(history.entries).toHaveLength(2)
    expect(history.index).toBe(1)
    expect(currentSnapshot(history)).toEqual(updated)

    const back = goBack(history)
    expect(back.snapshot).toEqual(a)
    expect(back.history.index).toBe(0)

    const again = pushSnapshot(history, { ...updated })
    expect(again.entries).toHaveLength(2)
  })

  it('never exceeds HISTORY_LIMIT and drops the oldest entries first', () => {
    let history = createHistory()
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      history = pushSnapshot(history, detail({ record_id: i }))
    }

    expect(history.entries).toHaveLength(HISTORY_LIMIT)
    expect(history.index).toBe(HISTORY_LIMIT - 1)
    expect(history.entries[0]).toEqual(detail({ record_id: 5 }))
    expect(currentSnapshot(history)).toEqual(detail({ record_id: HISTORY_LIMIT + 4 }))
  })

  it('returns null at the start and at the end', () => {
    expect(goBack(createHistory())).toBeNull()
    expect(goForward(createHistory())).toBeNull()

    const history = pushSnapshot(createHistory(), browse())
    expect(goBack(history)).toBeNull()
    expect(goForward(history)).toBeNull()
  })

  it('isSamePage compares view and detail game identity, ignoring game elsewhere', () => {
    expect(isSamePage(detail({ record_id: 1, title: 'A' }), detail({ record_id: 1, title: 'B' }))).toBe(true)
    expect(isSamePage(detail({ id: 'stable' }), detail({ id: 'stable' }))).toBe(true)
    expect(isSamePage(detail({ record_id: 1 }), detail({ record_id: 2 }))).toBe(false)
    expect(isSamePage({ ...browse(), game: { record_id: 1 } }, browse())).toBe(true)
    expect(isSamePage(browse(), page('library'))).toBe(false)
    expect(isSamePage(null, browse())).toBe(false)
  })

  it('isSamePage compares saved filter and collection identity outside detail pages', () => {
    expect(isSamePage(browse(), browse('builtin-favorites'))).toBe(false)
    expect(isSamePage(browse(), browse(null, '12'))).toBe(false)
    expect(isSamePage(browse('saved-1', '12'), browse('saved-1', '12'))).toBe(true)
    expect(isSamePage(
      { ...detail({ record_id: 1 }), savedFilterId: 'saved-1', collectionId: '12' },
      detail({ record_id: 1 }),
    )).toBe(true)
  })

  it('never mutates its inputs', () => {
    const a = browse()
    const b = detail({ record_id: 1 })

    const empty = createHistory()
    const pushed = pushSnapshot(empty, a)
    expect(empty).toEqual({ entries: [], index: -1 })
    expect(pushed).not.toBe(empty)
    expect(pushed.entries).not.toBe(empty.entries)

    const withTwo = pushSnapshot(pushed, b)
    expect(a).toEqual(browse())
    const snapshotOfTwo = JSON.stringify(withTwo)

    const back = goBack(withTwo)
    expect(JSON.stringify(withTwo)).toBe(snapshotOfTwo)
    expect(back.history).not.toBe(withTwo)

    const snapshotOfBack = JSON.stringify(back.history)
    const forward = goForward(back.history)
    expect(JSON.stringify(back.history)).toBe(snapshotOfBack)
    expect(forward.history).not.toBe(back.history)
  })

  it('saveHistory and loadHistory round trip', () => {
    let history = pushSnapshot(createHistory(), browse('builtin-favorites'))
    history = pushSnapshot(history, page('library', '', '12'))
    history = pushSnapshot(history, detail({ record_id: 3 }))
    saveHistory(history)

    expect(loadHistory()).toEqual(history)
  })

  it('stores history under the v2 key and ignores v1 entries', () => {
    saveHistory(pushSnapshot(createHistory(), browse()))
    expect(store.has('atlas:view-history-v2')).toBe(true)
    store.set('atlas:view-history-v1', JSON.stringify({ entries: [browse()], index: 0 }))
    store.delete('atlas:view-history-v2')
    expect(loadHistory()).toBeNull()
  })

  it('loadHistory returns null when nothing was saved', () => {
    expect(loadHistory()).toBeNull()
  })

  it('loadHistory rejects malformed JSON', () => {
    store.set(STORAGE_KEY, '{bad json')
    expect(loadHistory()).toBeNull()
  })

  it('loadHistory rejects an out-of-range index', () => {
    store.set(STORAGE_KEY, JSON.stringify({ entries: [browse()], index: 4 }))
    expect(loadHistory()).toBeNull()
    store.set(STORAGE_KEY, JSON.stringify({ entries: [], index: 0 }))
    expect(loadHistory()).toBeNull()
    store.set(STORAGE_KEY, JSON.stringify({ entries: [browse()], index: -1 }))
    expect(loadHistory()).toBeNull()
  })

  it('loadHistory rejects unknown views and detail entries without a game object', () => {
    store.set(STORAGE_KEY, JSON.stringify({ entries: [{ ...page('settings'), view: 'settings' }], index: 0 }))
    expect(loadHistory()).toBeNull()
    store.set(STORAGE_KEY, JSON.stringify({ entries: [{ ...detail(null) }], index: 0 }))
    expect(loadHistory()).toBeNull()
  })

  it('loadHistory rejects filter identity fields that are not strings or null', () => {
    store.set(STORAGE_KEY, JSON.stringify({ entries: [{ ...browse(), savedFilterId: 7 }], index: 0 }))
    expect(loadHistory()).toBeNull()
    store.set(STORAGE_KEY, JSON.stringify({ entries: [{ ...browse(), collectionId: {} }], index: 0 }))
    expect(loadHistory()).toBeNull()
    store.set(STORAGE_KEY, JSON.stringify({ entries: [{ ...browse(), savedFilterId: undefined }], index: 0 }))
    expect(loadHistory()).toBeNull()
    store.set(STORAGE_KEY, JSON.stringify({ entries: [browse('saved-1', '12')], index: 0 }))
    expect(loadHistory()).toEqual({ entries: [browse('saved-1', '12')], index: 0 })
  })

  it('loadHistory accepts a wishlist entry', () => {
    expect(VIEWS).toContain('wishlist')
    store.set(STORAGE_KEY, JSON.stringify({ entries: [page('wishlist')], index: 0 }))
    expect(loadHistory()).toEqual({ entries: [page('wishlist')], index: 0 })
  })

  it('blocked storage does not throw', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    })

    expect(() => loadHistory()).not.toThrow()
    expect(loadHistory()).toBeNull()
    expect(() => saveHistory(createHistory())).not.toThrow()
    expect(() => clearHistory()).not.toThrow()
  })

  it('clearHistory removes the stored key', () => {
    saveHistory(pushSnapshot(createHistory(), browse()))
    expect(store.has(STORAGE_KEY)).toBe(true)
    clearHistory()
    expect(store.has(STORAGE_KEY)).toBe(false)
    expect(loadHistory()).toBeNull()
  })
})
