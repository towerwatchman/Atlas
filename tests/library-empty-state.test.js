import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8')

// libraryLoadMismatch and hasActiveLibraryFilters are local consts inside App,
// not exported, and no test renders <App />, so a text guard is the available
// check. A Last Seen mode narrows the returned list but not the raw library
// count, so an empty list over a non-zero count is expected there, not a
// failed load, and the empty state must read "match these filters" rather than
// "no games available".

// The mismatch guard must stand down while a Last Seen mode is on, or the
// "did not load" panel shows over a full library and its Reload cannot clear.
test('the load-mismatch guard ignores a Last Seen mode', () => {
  const start = app.indexOf('const libraryLoadMismatch =')
  expect(start).toBeGreaterThan(-1)
  const end = app.indexOf('const hasActiveLibraryFilters')
  expect(end).toBeGreaterThan(-1)
  const body = app.slice(start, end)
  expect(body).toContain('expectedLibraryCount > 0 && !activeFilters?.lastSeen')
  expect(app).toContain('libraryLoadMismatch ?')
})

// Last Seen must count as an active filter, or an empty result under it reads
// as an empty library instead of an empty match.
test('Last Seen counts as an active filter', () => {
  const start = app.indexOf('const hasActiveLibraryFilters =')
  expect(start).toBeGreaterThan(-1)
  const end = app.indexOf('const ', start + 'const hasActiveLibraryFilters ='.length)
  expect(end).toBeGreaterThan(-1)
  const body = app.slice(start, end)
  expect(body).toContain('activeFilters?.lastSeen,')
  expect(app).toContain(': hasActiveLibraryFilters')
})
