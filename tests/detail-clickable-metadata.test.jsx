// @vitest-environment jsdom
import { test, expect, beforeEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import fs from 'fs'
import path from 'path'
import {
  resolveMetadataSearch, isSearchableDetailField, detailFieldForLabel, splitDetailValue, searchTooltip,
} from '../src/utils/metadataSearch.js'
import SearchableDetailValue from '../src/components/detail/page/SearchableDetailValue.jsx'

// Only rows with index coverage become search links: plain text would silently
// match nothing for opt-in fields under the default title/creator/id set, and
// Publisher/Genre/etc. have no field or filter at all.
test('only index-covered rows are searchable', () => {
  for (const label of ['Developer', 'Status', 'Engine', 'Language', 'Category']) {
    expect(isSearchableDetailField(label)).toBe(true)
  }
  for (const label of [
    'Total Playtime', 'Release Date', 'Rating', 'Likes', 'Views',
    'Publisher', 'Genre', 'Translations', 'Voice', 'OS', 'Censored',
  ]) {
    expect(isSearchableDetailField(label)).toBe(false)
  }
})

test('labels map to the filter the sidebar uses', () => {
  expect(detailFieldForLabel('Developer')).toBe('developer')
  expect(detailFieldForLabel('Category')).toBe('category')
  expect(detailFieldForLabel('Engine')).toBe('engine')
  expect(detailFieldForLabel('Status')).toBe('status')
  expect(detailFieldForLabel('Language')).toBe('language')
})

test('covered fields map to filter deltas, developer maps to text', () => {
  expect(resolveMetadataSearch('tag', 'Action')).toEqual({ text: '', filters: { tags: ['Action'] } })
  expect(resolveMetadataSearch('category', 'RPG')).toEqual({ text: '', filters: { category: ['RPG'] } })
  expect(resolveMetadataSearch('engine', 'Unreal')).toEqual({ text: '', filters: { engine: ['Unreal'] } })
  expect(resolveMetadataSearch('status', 'Completed')).toEqual({ text: '', filters: { status: ['Completed'] } })
  // Language has no sidebar section, so it travels as prefixed text the box
  // shows, scoped to the language field in both modes regardless of config.
  expect(resolveMetadataSearch('language', 'English')).toEqual({ text: 'language:English', filters: {} })
  expect(resolveMetadataSearch('developer', 'Foo Games')).toEqual({ text: 'Foo Games', filters: {} })
  expect(resolveMetadataSearch('tag', '   ')).toEqual({ text: '', filters: {} })
})

// "English, Japanese" searched literally would match nothing, so multi-value
// rows split into one button per token — the same values the sidebar holds.
test('tooltips name both concrete modes', () => {
  expect(searchTooltip('tag', 'Action', 'browse'))
    .toBe('Browse catalog for "Action"\nShift-click to search Library')
  expect(searchTooltip('developer', 'Foo', 'library'))
    .toBe('Search Library for "Foo"\nShift-click to browse catalog')
})

test('long values name the type instead', () => {
  expect(searchTooltip('developer', 'A Studio Name That Goes On And On Forever Ltd', 'browse'))
    .toBe('Browse catalog for this developer\nShift-click to search Library')
})

test('multi-value rows split into one token per button', () => {
  expect(splitDetailValue('Language', 'English, Japanese')).toEqual(['English', 'Japanese'])
  expect(splitDetailValue('Category', 'Action, RPG')).toEqual(['Action', 'RPG'])
  expect(splitDetailValue('Developer', 'Foo Games')).toEqual(['Foo Games'])
})

beforeEach(() => { cleanup() })

test('uncovered rows render plain text with no button', async () => {
  let result
  await act(async () => {
    result = render(<SearchableDetailValue label="Publisher" value="Foo" onSearch={() => { throw new Error('must not search') }} />)
  })
  expect(screen.getByText('Foo').tagName).toBe('SPAN')
  expect(screen.queryByRole('button')).toBeNull()
  result.unmount()
})

test('repeated tokens render without duplicate-key warnings', async () => {
  const errors = []
  const original = console.error
  console.error = (...args) => { errors.push(args.join(' ')) }
  let result
  try {
    await act(async () => {
      result = render(<SearchableDetailValue label="Language" value="English, English" onSearch={() => {}} />)
    })
    expect(screen.getAllByText('English').length).toBe(2)
    expect(errors.some((message) => message.includes('same key'))).toBe(false)
  } finally {
    console.error = original
  }
  result.unmount()
})

test('covered rows render one button per token and report the click', async () => {
  const calls = []
  let result
  await act(async () => {
    result = render(
      <SearchableDetailValue label="Language" value="English, Japanese" onSearch={(...args) => { calls.push(args) }} />,
    )
  })
  await act(async () => { fireEvent.click(screen.getByText('Japanese')) })
  expect(calls.length).toBe(1)
  expect(calls[0][0]).toBe('Language')
  expect(calls[0][1]).toBe('Japanese')
  result.unmount()
})

// formatLanguages collapses long Steam language lists into a
// "Multiple languages (N)" summary. That summary is display-only: searching
// it literally matches nothing, so it must stay plain text, not a button.
test('a summarized language list renders plain text, not a dead search button', async () => {
  let result
  await act(async () => {
    result = render(<SearchableDetailValue label="Language" value="Multiple languages (12)" onSearch={() => { throw new Error('must not search') }} />)
  })
  expect(screen.getByText('Multiple languages (12)').tagName).toBe('SPAN')
  expect(screen.queryByRole('button')).toBeNull()
  result.unmount()
})

const detailPage = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'components', 'detail', 'GameDetailPage.jsx'), 'utf8')

test('the details panel renders searchable values and forwards clicks', () => {
  expect(detailPage).toContain('<SearchableDetailValue')
  expect(detailPage).toContain('onSearchDetail')
})
