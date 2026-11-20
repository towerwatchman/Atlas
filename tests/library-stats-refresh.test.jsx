// @vitest-environment jsdom
import { test, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

import { useGames } from '../src/hooks/useGames.js'

// ── The library count has to be re-read, not read once ───────────────────────
//
// getLibraryStats() is a COUNT(*) probe that exists so the grid can tell "still
// loading" apart from "genuinely empty". It was fetched in a mount effect with
// an empty dependency array and never again.
//
// Deleting a game does not re-fetch the library — handleGameDeleted calls
// removeGameFromState, which splices the row out of local state. So after
// deleting the only game, games.length was 0 while the cached count still said
// 1, and App's libraryLoadMismatch guard (games.length === 0 && count > 0) read
// that disagreement as a failed load: "The database reports 1 game and 1
// version, but none were returned."
//
// Reloading could not clear it either — the reload button calls fetchGames, and
// nothing re-counted.

let statsFromDb
let statsCalls
let gamesFromDb
let getGamesCalls
let progressListener

beforeEach(() => {
  statsFromDb = { games: 1, versions: 1, pathVersions: 1, ok: true }
  statsCalls = 0
  gamesFromDb = []
  getGamesCalls = []
  progressListener = null
  vi.stubGlobal('window', Object.assign(globalThis.window, {
    electronAPI: {
      getLibraryStats: async () => { statsCalls += 1; return statsFromDb },
      getGames: async (args) => { getGamesCalls.push(args); return gamesFromDb },
      getCatalogIndexStatus: async () => ({ ready: true }),
      onCatalogIndexProgress: (cb) => { progressListener = cb; return () => { progressListener = null } },
    },
  }))
})

const mounted = async () => {
  const view = renderHook(() => useGames())
  await waitFor(() => expect(view.result.current.libraryStats).toBeTruthy())
  return view
}

test('deleting the last game re-reads the library count', async () => {
  const { result } = await mounted()
  expect(result.current.libraryStats.games).toBe(1)

  // The delete has committed in the main process; the renderer is told about it
  // and splices the row out without re-fetching.
  statsFromDb = { games: 0, versions: 0, pathVersions: 0, ok: true }
  await act(async () => { result.current.removeGameFromState(1) })

  await waitFor(() => expect(result.current.libraryStats.games).toBe(0))
  // Which is the whole point: an empty grid and a count of 0 agree, so the
  // "your library did not load" guard has nothing to fire on.
  expect(result.current.games).toHaveLength(0)
})

test('the count is marked stale until the re-read lands', async () => {
  const { result } = await mounted()
  expect(result.current.libraryStatsStale).toBe(false)

  statsFromDb = { games: 0, versions: 0, pathVersions: 0, ok: true }
  act(() => { result.current.removeGameFromState(1) })

  // Between the splice and the re-count, games.length and the cached count
  // disagree for real. Suppressing the guard for that window is what keeps the
  // warning panel from flashing on the way to the correct empty state.
  expect(result.current.libraryStatsStale).toBe(true)
  await waitFor(() => expect(result.current.libraryStatsStale).toBe(false))
})

test('importing a game re-reads the count too', async () => {
  statsFromDb = { games: 0, versions: 0, pathVersions: 0, ok: true }
  const { result } = await mounted()
  expect(result.current.libraryStats.games).toBe(0)

  statsFromDb = { games: 1, versions: 1, pathVersions: 1, ok: true }
  await act(async () => {
    result.current.replaceGameInState({ record_id: 7, title: 'New', versionCount: 1 })
  })

  await waitFor(() => expect(result.current.libraryStats.games).toBe(1))
})

test('updating a game already on screen does not re-count', async () => {
  const { result } = await mounted()
  await act(async () => {
    result.current.replaceGameInState({ record_id: 7, title: 'New', versionCount: 1 })
  })
  await waitFor(() => expect(result.current.libraryStatsStale).toBe(false))
  const afterInsert = statsCalls

  // An update is not a membership change, so re-counting on every metadata
  // refresh would be three COUNT(*)s per scanned title during an import.
  await act(async () => {
    result.current.replaceGameInState({ record_id: 7, title: 'Renamed', versionCount: 1 })
  })
  await new Promise((resolve) => setTimeout(resolve, 400))
  expect(statsCalls).toBe(afterInsert)
})

test('reloading the library re-reads the count', async () => {
  const { result } = await mounted()
  const before = statsCalls

  // The "Reload library" button on the warning panel. Re-fetching games while
  // reusing a cached count is what made the panel unclearable.
  statsFromDb = { games: 0, versions: 0, pathVersions: 0, ok: true }
  await act(async () => { await result.current.fetchGames(false) })

  expect(statsCalls).toBeGreaterThan(before)
  await waitFor(() => expect(result.current.libraryStats.games).toBe(0))
})

// ── Last-seen mode reaches the payload ────────────────────────────────────────
//
// fetchGames reads the active mode from lastSeenRef and hands it to main via
// options.lastSeen, so the Library Last Seen picker works. Nothing tested this
// through the renderer; the main-side filter was tested through getGames
// directly. Deleting the mode from the payload would have left the suite green.

test('fetchGames sends lastSeenRef through to getGames', async () => {
  const { result } = await mounted()

  act(() => { result.current.lastSeenRef.current = 'tracked' })
  await act(async () => { await result.current.fetchGames(true) })

  const lastCall = getGamesCalls.at(-1)
  expect(lastCall.options.lastSeen).toBe('tracked')
})

test('fetchGames sends null when the mode is cleared', async () => {
  const { result } = await mounted()

  act(() => { result.current.lastSeenRef.current = 'tracked' })
  await act(async () => { await result.current.fetchGames(true) })
  expect(getGamesCalls.at(-1).options.lastSeen).toBe('tracked')

  // The hook exposes lastSeenRef, so App clears the mode by setting it to null.
  act(() => { result.current.lastSeenRef.current = null })
  await act(async () => { await result.current.fetchGames(true) })
  expect(getGamesCalls.at(-1).options.lastSeen).toBeNull()
})

// ── A failed rebuild leaves the hook ready, not building ──────────────────────
//
// Finding 9: the grid gates on catalogIndexState to choose between the slow scan
// and "building". A build that errors must clear building and report ready, or
// Browse would sit on "building" forever after a crash.
test('an error event clears building and marks the index ready', async () => {
  const { result } = await mounted()

  act(() => { progressListener({ phase: 'start', processed: 0, total: 100, message: 'Indexing…' }) })
  expect(result.current.catalogIndexState.building).toBe(true)

  act(() => { progressListener({ phase: 'error', message: 'Disk full' }) })
  expect(result.current.catalogIndexState.building).toBe(false)
  expect(result.current.catalogIndexState.ready).toBe(true)
})
