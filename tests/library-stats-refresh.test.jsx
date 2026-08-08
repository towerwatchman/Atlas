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

beforeEach(() => {
  statsFromDb = { games: 1, versions: 1, pathVersions: 1, ok: true }
  statsCalls = 0
  gamesFromDb = []
  vi.stubGlobal('window', Object.assign(globalThis.window, {
    electronAPI: {
      getLibraryStats: async () => { statsCalls += 1; return statsFromDb },
      getGames: async () => gamesFromDb,
      getCatalogIndexStatus: async () => ({ ready: true }),
      onCatalogIndexProgress: () => () => {},
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
