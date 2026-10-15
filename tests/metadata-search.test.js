import { test, expect } from 'vitest'
import { resolveMetadataSearch, isSecondaryModeClick } from '../src/utils/metadataSearch.js'

// Clicking a tag produces a structured tags-filter payload rather than free
// text, so multi-word tags survive without delimiter guessing.
test('a tag click maps to a tags filter payload', () => {
  expect(resolveMetadataSearch('tag', 'Action')).toEqual({ text: '', filters: { tags: ['Action'] } })
})

// Creator/developer names are covered by the default search fields (title,
// creator, id), so they travel as plain text the grid already understands.
test('a developer click maps to a text payload', () => {
  expect(resolveMetadataSearch('developer', 'Foo Games')).toEqual({ text: 'Foo Games', filters: {} })
})

test('blank values map to an empty payload', () => {
  expect(resolveMetadataSearch('tag', '   ')).toEqual({ text: '', filters: {} })
})

test('shift-click means the secondary mode', () => {
  expect(isSecondaryModeClick({ shiftKey: true })).toBe(true)
  expect(isSecondaryModeClick({ shiftKey: false })).toBe(false)
  expect(isSecondaryModeClick(null)).toBe(false)
})
