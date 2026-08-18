'use strict'

// Saved Browse filters are normalized on BOTH sides of the IPC boundary: the
// renderer normalizes on load (src/hooks/useFilters.js) and the main process
// normalizes again on save (electron/ipc/settings.js). Main's whitelist had
// been left at the four legacy values, so twelve of the sixteen sorts -- the
// default among them -- were rewritten to nameAsc on save and came back as
// title A-Z. The vocabulary now lives in one place per process, and these
// tests exist to fail if those two places stop agreeing.
//
// The copies cannot be collapsed into one module: main is CommonJS and the
// renderer is an ESM bundle. Same constraint as ratingCategories.js, resolved
// the same way -- duplicate the data, then assert the duplicates are equal.
//
// `test`/`expect` are globals (vitest.config.js sets globals: true) rather
// than imports, because an `import` would make this file ESM and break the
// `require` of the CommonJS module under test.

const fs = require('node:fs')
const path = require('node:path')
const {
  DEFAULT_SAVED_BROWSE_SORT,
  normalizeSavedBrowseSort,
} = require('../electron/utils/savedFilterSort')

// Anchor reads to the repository rather than the caller's working directory.
const projectFile = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8')

// The renderer half is ESM, so it is loaded dynamically rather than required.
// Awaited once and shared, because importing useFilters.js pulls in the whole
// filter hook and there is no reason to pay for it per assertion.
const rendererVocabulary = () => import('../src/hooks/useFilters.js')

// ── The two copies must agree ───────────────────────────────────────────────

test('the main process accepts exactly the sorts the renderer emits', async () => {
  const { BROWSE_SORT_VALUES } = await rendererVocabulary()
  // Every renderer value must survive a save untouched. This is the direction
  // the bug ran: a value main did not recognise was silently replaced.
  for (const value of BROWSE_SORT_VALUES) {
    expect(normalizeSavedBrowseSort(value)).toBe(value)
  }
  // And the other direction -- main must not accept a sort the renderer would
  // then reject, which would round-trip a saved filter into the default.
  const source = projectFile('electron', 'utils', 'savedFilterSort.js')
  const mainValues = [...source.matchAll(/^\s{2}'([^']+)',$/gm)].map((match) => match[1])
  expect(mainValues.length).toBe(BROWSE_SORT_VALUES.length)
  expect([...mainValues].sort()).toEqual([...BROWSE_SORT_VALUES].sort())
})

test('the alias maps are identical', async () => {
  const { BROWSE_SORT_ALIASES } = await rendererVocabulary()
  // Compared by BEHAVIOUR rather than by reading main's object: an alias that
  // resolves differently on the two sides is the failure worth catching, and
  // that is what normalizeSavedBrowseSort actually does with it.
  for (const [legacy, current] of Object.entries(BROWSE_SORT_ALIASES)) {
    expect(normalizeSavedBrowseSort(legacy)).toBe(current)
  }
  // Guards the reverse: main must not carry an alias the renderer dropped.
  const source = projectFile('electron', 'utils', 'savedFilterSort.js')
  const start = source.indexOf('const browseSortAliases = {')
  const end = source.indexOf('}', start)
  expect(start).not.toBe(-1)
  const mainAliasKeys = [...source.slice(start, end).matchAll(/^\s{2}(\w+):/gm)]
    .map((match) => match[1])
  expect(mainAliasKeys.sort()).toEqual(Object.keys(BROWSE_SORT_ALIASES).sort())
})

test('the two defaults are the same value', async () => {
  const { DEFAULT_BROWSE_SORT } = await rendererVocabulary()
  expect(DEFAULT_SAVED_BROWSE_SORT).toBe(DEFAULT_BROWSE_SORT)
  // The default must itself be a legal sort. It was not reachable through the
  // old main-process whitelist, which is why even an untouched filter came
  // back sorted by title.
  expect(normalizeSavedBrowseSort(DEFAULT_SAVED_BROWSE_SORT)).toBe(DEFAULT_SAVED_BROWSE_SORT)
})

// ── The normalizer's own behaviour ──────────────────────────────────────────

test('legacy browse sort values remain compatible', () => {
  expect(normalizeSavedBrowseSort('name')).toBe('titleAsc')
  expect(normalizeSavedBrowseSort('nameAsc')).toBe('titleAsc')
  expect(normalizeSavedBrowseSort('nameDesc')).toBe('titleDesc')
  expect(normalizeSavedBrowseSort('newest')).toBe('threadUpdatedDesc')
  expect(normalizeSavedBrowseSort('oldest')).toBe('threadUpdatedAsc')
})

test('unknown browse sort values fall back to the browse default', () => {
  expect(normalizeSavedBrowseSort('not-a-sort')).toBe(DEFAULT_SAVED_BROWSE_SORT)
  expect(normalizeSavedBrowseSort(undefined)).toBe(DEFAULT_SAVED_BROWSE_SORT)
  expect(normalizeSavedBrowseSort('')).toBe(DEFAULT_SAVED_BROWSE_SORT)
})

// ── Wiring ──────────────────────────────────────────────────────────────────

// Everything above passes against a savedFilterSort.js that nothing calls, so
// on its own it proves the module is correct and not that the bug is fixed.
// normalizeSavedFilterState is not exported -- settings.js exports only
// registerSettingsHandlers -- so this reads it as text, the same shape as the
// main.js wiring guard added alongside the open-folder fix.
test('settings.js normalizes saved browse sorts through the shared module', () => {
  const settings = projectFile('electron', 'ipc', 'settings.js')
  expect(settings).toContain("require('../utils/savedFilterSort')")
  expect(settings).toContain('normalizeSavedBrowseSort(merged.browseSort)')
  expect(settings).toContain('browseSort: DEFAULT_SAVED_BROWSE_SORT')
  // The four-value whitelist that caused this must be gone, not merely
  // bypassed -- a leftover copy is the thing that would drift back.
  expect(settings).not.toMatch(/'nameAsc', 'nameDesc'/)
  expect(settings).not.toMatch(/merged\.browseSort === 'name'/)
})
