import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const recentlyDeleted = require('../electron/library/recentlyDeleted')

// ── Recently deleted game paths ──────────────────────────────────────────────
//
// The state that authorises deleting a game folder after its database rows are
// already gone. Two properties matter and neither was previously asserted:
//
//   1. It is reachable from MODULE scope. It used to be a Map in main.js handed
//      round through ctx, which module-level functions in ipc/importer.js could
//      not see -- `isAllowedDeletionPath()` referenced it from module scope and
//      threw `recentlyDeletedGamePaths is not defined` on every call, which is
//      why version replace had never once succeeded. This suite requires the
//      module directly, at module scope, which is the shape the bug ruled out.
//
//   2. Entries EXPIRE. A stale entry is a standing permission to delete a
//      directory, so the retention window is part of the contract, not an
//      implementation detail.

beforeEach(() => { recentlyDeleted._reset() })
afterEach(() => { recentlyDeleted._reset(); vi.useRealTimers() })

describe('recentlyDeleted', () => {
  it('remembers paths for a record', () => {
    recentlyDeleted.remember(44, ['E:\\Games\\Boon\\v0.2'])
    expect(recentlyDeleted.pathsFor(44)).toEqual(['E:\\Games\\Boon\\v0.2'])
  })

  it('returns an array for a record it has never seen', () => {
    // isAllowedDeletionPath spreads this straight into an array literal, so a
    // null or undefined here would throw at the call site rather than here.
    expect(recentlyDeleted.pathsFor(999)).toEqual([])
    expect(recentlyDeleted.pathsFor(null)).toEqual([])
    expect(recentlyDeleted.pathsFor(undefined)).toEqual([])
  })

  it('accepts a numeric string record id, as sqlite rows supply', () => {
    recentlyDeleted.remember('44', ['/games/a'])
    expect(recentlyDeleted.pathsFor(44)).toEqual(['/games/a'])
    expect(recentlyDeleted.pathsFor('44')).toEqual(['/games/a'])
  })

  it('ignores an unusable record id rather than keying on NaN', () => {
    recentlyDeleted.remember(0, ['/games/a'])
    recentlyDeleted.remember(-1, ['/games/b'])
    recentlyDeleted.remember('abc', ['/games/c'])
    expect(recentlyDeleted.pathsFor(0)).toEqual([])
    expect(recentlyDeleted.pathsFor(-1)).toEqual([])
    expect(recentlyDeleted.pathsFor('abc')).toEqual([])
  })

  it('drops blank and non-string entries', () => {
    recentlyDeleted.remember(1, ['/games/a', '', '   ', null, undefined, 5, '/games/b'])
    expect(recentlyDeleted.pathsFor(1)).toEqual(['/games/a', '/games/b'])
  })

  it('expires an entry after the retention window', () => {
    vi.useFakeTimers()
    recentlyDeleted.remember(7, ['/games/old'])
    vi.advanceTimersByTime(recentlyDeleted.RETENTION_MS - 1)
    expect(recentlyDeleted.pathsFor(7)).toEqual(['/games/old'])
    vi.advanceTimersByTime(2)
    // A stale entry is a standing permission to delete a directory.
    expect(recentlyDeleted.pathsFor(7)).toEqual([])
  })

  it('restarts the window when a record is remembered again', () => {
    // Otherwise the first timer expires the newer list early, and the paths
    // recorded by the second delete become undeletable partway through.
    vi.useFakeTimers()
    recentlyDeleted.remember(7, ['/games/first'])
    vi.advanceTimersByTime(recentlyDeleted.RETENTION_MS - 10)
    recentlyDeleted.remember(7, ['/games/second'])
    vi.advanceTimersByTime(20)
    expect(recentlyDeleted.pathsFor(7)).toEqual(['/games/second'])
  })

  it('forgets on request', () => {
    recentlyDeleted.remember(3, ['/games/a'])
    recentlyDeleted.forget(3)
    expect(recentlyDeleted.pathsFor(3)).toEqual([])
  })

  it('keeps records independent', () => {
    recentlyDeleted.remember(1, ['/games/one'])
    recentlyDeleted.remember(2, ['/games/two'])
    recentlyDeleted.forget(1)
    expect(recentlyDeleted.pathsFor(1)).toEqual([])
    expect(recentlyDeleted.pathsFor(2)).toEqual(['/games/two'])
  })

  it('is a single instance across requires', () => {
    // The guarantee that replaced "one Map passed through ctx". If two consumers
    // got different Maps, a path remembered by the delete handler would be
    // invisible to the deletion guard and the original bug would be back in a
    // new shape.
    const again = require('../electron/library/recentlyDeleted')
    recentlyDeleted.remember(11, ['/games/shared'])
    expect(again.pathsFor(11)).toEqual(['/games/shared'])
  })
})
