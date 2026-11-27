import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { builtInSavedFilters, defaultFilters, getDefaultSortDirectionForSort, filterGamesWithState } from '../src/hooks/useFilters.js'

const sidebar = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'components', 'search', 'SearchSidebar.jsx'),
  'utf8',
)
const filters = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'hooks', 'useFilters.js'),
  'utf8',
)

const sortOptionValues = () => {
  const start = sidebar.indexOf('const SORT_OPTIONS = [')
  const block = sidebar.slice(start, sidebar.indexOf(']', start))
  return [...block.matchAll(/value:\s*'([^']+)'/g)].map((m) => m[1])
}

// personalRating was already in sortTypes with a working comparator in
// useFilters — it was simply never listed in SORT_OPTIONS, so the dropdown never
// offered it and the sort was unreachable.
test('personal rating is offered in the sort dropdown', () => {
  expect(sortOptionValues()).toContain('personalRating')
})

test('every sort option the UI offers is a recognised sort type', () => {
  const start = filters.indexOf('const sortTypes = [')
  const block = filters.slice(start, filters.indexOf(']', start))
  const known = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1])
  for (const value of sortOptionValues()) {
    expect(known, `${value} is offered in the UI but not in sortTypes`).toContain(value)
  }
})

// A rating sorts high-to-low by default; ascending would put unrated titles first.
test('personal rating defaults to descending', () => {
  expect(getDefaultSortDirectionForSort('personalRating')).toBe('desc')
})

test('the comparator handles personalRating', () => {
  expect(filters).toMatch(/activeFilters\.sort === 'personalRating'/)
})

// Two distinct ratings now exist, so the community one needs distinguishing.
test('the community sort is labelled to distinguish it from the personal one', () => {
  const start = sidebar.indexOf('const SORT_OPTIONS = [')
  const block = sidebar.slice(start, sidebar.indexOf(']', start))
  expect(block).toMatch(/value: 'rating', label: 'Online Rating'/)
  expect(block).toMatch(/value: 'personalRating', label: '[^']+'/)
})

test('the default sort state is unchanged', () => {
  expect(defaultFilters.sort).toBeDefined()
  expect(defaultFilters.sort).not.toBe('personalRating')
})

test('dateAdded is offered in the sort grid with a calendar icon', () => {
  expect(sortOptionValues()).toContain('dateAdded')
  const start = sidebar.indexOf('const SORT_OPTIONS = [')
  const block = sidebar.slice(start, sidebar.indexOf(']', start))
  expect(block).toMatch(/value:\s*'dateAdded',\s*label:\s*'Date Added',\s*icon:\s*'fa-calendar-plus'/)
})

test('dateAdded defaults to descending (newest additions first)', () => {
  expect(getDefaultSortDirectionForSort('dateAdded')).toBe('desc')
})

test('the comparator handles dateAdded', () => {
  expect(filters).toMatch(/activeFilters\.sort === 'dateAdded'/)
})

test('newRelease is offered in the sort grid', () => {
  expect(sortOptionValues()).toContain('newRelease')
})

test('newRelease is a recognised sort type', () => {
  const start = filters.indexOf('const sortTypes = [')
  const block = filters.slice(start, filters.indexOf(']', start))
  expect(block).toContain('newRelease')
})

test('the comparator handles newRelease reading atlas_id', () => {
  expect(filters).toMatch(/activeFilters\.sort === 'newRelease'/)
  // atlas_id arrives as strings from some sources; without the coercion
  // compareMaybeNumber reads both as missing, so the title tiebreak decides and
  // 'Alpha' (atlas_id '2') would sort above 'Zulu' (atlas_id '10').
  const games = [
    { record_id: 1, title: 'Zulu', atlas_id: '10' },
    { record_id: 2, title: 'Alpha', atlas_id: '2' },
  ]
  const sorted = filterGamesWithState(games, { sort: 'newRelease', sortDirection: 'desc' })
  expect(sorted[0].atlas_id).toBe('10')
})

// Renamed from Newly Added, so the label and icon are the point of the row. The
// icon has to stay unique to it inside the block; Date Added owns the other one.
test('the New Releases row carries its label and a distinct calendar icon', () => {
  const start = sidebar.indexOf('const SORT_OPTIONS = [')
  const block = sidebar.slice(start, sidebar.indexOf(']', start))
  expect(block).toContain("label: 'New Releases'")
  expect(block.match(/fa-calendar-day/g)).toHaveLength(1)
  expect(block).not.toContain("'newlyAdded'")
})

test('releaseDate is not in dateFields', () => {
  const start = filters.indexOf('const dateFields = [')
  const block = filters.slice(start, filters.indexOf(']', start))
  expect(block).not.toContain('releaseDate')
})

test('releaseDate is absent from the Browse date filter options', () => {
  const start = sidebar.indexOf('const dateFieldOptions')
  const block = sidebar.slice(start, sidebar.indexOf('];', start))
  const browseEnd = block.indexOf(': [')
  expect(browseEnd).not.toBe(-1)
  expect(block.slice(0, browseEnd)).not.toContain('releaseDate')
})

test('releaseDate is absent from the Library date filter options', () => {
  const start = sidebar.indexOf('const dateFieldOptions')
  const block = sidebar.slice(start, sidebar.indexOf('];', start))
  const libStart = block.indexOf(': [')
  expect(libStart).not.toBe(-1)
  expect(block.slice(libStart)).not.toContain('releaseDate')
})

// The built-in filtered on releaseDate, which is no longer a date field, so
// normalisation dropped the constraint and it matched every title while its
// label promised the last 90 days. Pinned on the shape, not the strip, so a
// retired date field cannot come back unnoticed.
test('the New Releases built-in filter sets no date constraint and sorts newest first', () => {
  const recent = builtInSavedFilters.find((filter) => filter.id === 'builtin-recent')
  expect(recent.name).toBe('New Releases')
  expect(recent.filters.dateField).toBe('none')
  expect(recent.filters.dateRange).toBe('any')
  expect(recent.filters.sort).toBe('newRelease')
  expect(recent.filters.sortDirection).toBe('desc')
})
