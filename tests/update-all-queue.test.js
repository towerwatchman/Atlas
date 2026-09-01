import { describe, it, expect } from 'vitest'
import {
  advanceQueue,
  buildUpdateQueue,
  createSession,
  prefetchTarget,
  queueProgress,
} from '../src/components/downloads/updateAllQueue.js'

// ── Update-all queue ─────────────────────────────────────────────────────────
//
// The counters in the modal header are the only thing telling a user how much of
// the run is left, and they are watching them precisely because they are
// deciding whether to stop. An off-by-one here is invisible to a render test and
// obvious to the person twenty games in.

const game = (id, extra = {}) => ({
  record_id: id,
  title: `Game ${id}`,
  isUpdateAvailable: true,
  ...extra,
})

describe('buildUpdateQueue', () => {
  it('takes only records the library says have an update', () => {
    const queue = buildUpdateQueue([
      game(1),
      { record_id: 2, title: 'No update', isUpdateAvailable: false },
      { record_id: 3, title: 'Unknown' },
    ])
    expect(queue.map((entry) => entry.record_id)).toEqual([1])
  })

  it('keeps a record with no F95 thread instead of filtering it out', () => {
    // The regression this guards: filtering on f95_id here would silently drop
    // LewdCorner titles from a count the user is watching, and the filter would
    // then have to be found and widened when LC downloads land. The modal has
    // its own empty state for a record with no thread, which is a better answer
    // than the game never appearing.
    const queue = buildUpdateQueue([game(1, { f95_id: null, lc_id: 99 })])
    expect(queue).toHaveLength(1)
  })

  it('de-duplicates on record id rather than on title', () => {
    // Two different games can legitimately share a name; the same record cannot
    // appear twice in one run.
    const queue = buildUpdateQueue([
      game(1, { title: 'Same Name' }),
      game(2, { title: 'Same Name' }),
      game(1, { title: 'Same Name' }),
    ])
    expect(queue).toHaveLength(2)
  })

  it('drops a row with no id at all rather than queueing something unidentifiable', () => {
    expect(buildUpdateQueue([{ title: 'Orphan', isUpdateAvailable: true }])).toHaveLength(0)
  })

  it('orders by title so a restarted run meets the same games first', () => {
    const queue = buildUpdateQueue([game(1, { title: 'Zebra' }), game(2, { title: 'apple' })])
    expect(queue.map((entry) => entry.title)).toEqual(['apple', 'Zebra'])
  })
})

describe('queueProgress', () => {
  it('counts the current game as remaining, not as done', () => {
    // "0 left" while a dialog is still asking for a mirror is the confusing
    // version of this.
    const progress = queueProgress({ queue: [game(1), game(2), game(3)], index: 0 })
    expect(progress).toMatchObject({ position: 1, total: 3, remaining: 3, done: 0 })
  })

  it('reports the last game as 3 of 3 with one left', () => {
    const progress = queueProgress({ queue: [game(1), game(2), game(3)], index: 2 })
    expect(progress).toMatchObject({ position: 3, total: 3, remaining: 1 })
  })

  it('does not print a position past the end of a finished run', () => {
    const progress = queueProgress({ queue: [game(1)], index: 1 })
    expect(progress).toMatchObject({ position: 1, remaining: 0 })
  })

  it('reports an empty run as zero rather than as game 1 of 0', () => {
    expect(queueProgress({ queue: [], index: 0 })).toMatchObject({ position: 0, total: 0, remaining: 0 })
  })
})

describe('advanceQueue', () => {
  it('tallies a queued download separately from a skip', () => {
    let state = createSession([game(1), game(2)])
    state = advanceQueue(state, 'queued')
    expect(state).toMatchObject({ index: 1, queued: 1, skipped: 0, finished: false })
    state = advanceQueue(state, 'skipped')
    expect(state).toMatchObject({ index: 2, queued: 1, skipped: 1, finished: true })
  })

  it('finishes exactly when the last game is dealt with, not one early', () => {
    let state = createSession([game(1)])
    expect(state.finished).toBe(false)
    state = advanceQueue(state, 'queued')
    expect(state.finished).toBe(true)
  })

  it('treats an outcome it does not recognise as a skip rather than a success', () => {
    const state = advanceQueue(createSession([game(1), game(2)]), 'exploded')
    expect(state).toMatchObject({ queued: 0, skipped: 1 })
  })
})

describe('prefetchTarget', () => {
  it('warms the next game, not the current one', () => {
    const state = createSession([game(1), game(2), game(3)])
    expect(prefetchTarget(state).record_id).toBe(1 + 1)
  })

  it('returns null at the end rather than wrapping to the start', () => {
    // Wrapping would spend an authenticated F95 request re-fetching a thread the
    // run has already finished with.
    const state = { ...createSession([game(1), game(2)]), index: 1 }
    expect(prefetchTarget(state)).toBeNull()
  })
})

describe('createSession', () => {
  it('starts an empty library already finished so the run does not hang on nothing', () => {
    expect(createSession([]).finished).toBe(true)
    expect(createSession([game(1)]).finished).toBe(false)
  })
})
