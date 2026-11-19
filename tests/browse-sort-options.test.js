import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { builtInSavedFilters } from '../src/hooks/useFilters.js'

// CATALOG_SORT_OPTIONS is a module-local const in a .jsx file and is not
// exported, so these assertions read the source text, like the other
// source-reading tests (search-fields.test.js, lewdcorner-tier.test.js).
const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'components', 'search', 'SearchSidebar.jsx'),
  'utf8')

// Slice just the array so unrelated releaseDate mentions elsewhere in the
// file (date-field defaults, filter labels) can't satisfy or break assertions.
const decl = source.indexOf('const CATALOG_SORT_OPTIONS = [')
const arraySource = source.slice(decl, source.indexOf('\n]', decl))

test('the Browse sidebar offers New Releases with the newRelease key and its asc/desc sort values', () => {
  const entry = arraySource.split('\n').find((line) => line.includes("label: 'New Releases'"))
  expect(entry).toBeDefined()
  expect(entry).toContain("key: 'newRelease'")
  expect(entry).toContain('newReleaseAsc')
  expect(entry).toContain('newReleaseDesc')
})

test('the Browse sidebar no longer offers the removed releaseDate sort', () => {
  expect(arraySource).not.toContain('releaseDateAsc')
  expect(arraySource).not.toContain('releaseDateDesc')
})

test('CATALOG_SORT_OPTIONS still has six entries', () => {
  expect(arraySource.match(/\{ key: '/g)).toHaveLength(6)
})

// The tooltip used to repeat the current direction and a click hint. Both
// sort lists already render that as a badge, so the hover text is just the
// label. Pinned so the direction word cannot creep back in.
test('the sort tooltip is exactly the option label, with no direction word', () => {
  expect(source).not.toMatch(/title=\{[^\n]*(Ascending|Descending)/i)
  expect(source).not.toMatch(/click to flip/i)
})

// Browse reads browseSort and the Library reads sort; normalizeFilterState
// never derives one from the other, so the New Releases built-in has to carry
// both or Browse silently falls back to the default thread-updated sort.
test('the New Releases built-in resolves to the New Releases sort in both views', () => {
  const recent = builtInSavedFilters.find((filter) => filter.id === 'builtin-recent')
  expect(recent.filters.sort).toBe('newRelease')
  expect(recent.filters.browseSort).toBe('newReleaseDesc')
})
