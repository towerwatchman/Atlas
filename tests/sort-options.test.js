import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { defaultFilters, getDefaultSortDirectionForSort } from '../src/hooks/useFilters.js'

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
