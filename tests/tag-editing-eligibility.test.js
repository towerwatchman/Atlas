import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { canEditTags } from '../src/utils/tagEditing.js'

// The regression: Browse rows fell through to the tag EDITOR, which reads
// override state keyed on games.record_id. Catalog rows have no record_id, so
// the editor showed "No tags" on top of catalog tags the row already carried.
test('a Browse catalog row is not editable', () => {
  expect(canEditTags({ isCatalogEntry: true, record_id: null })).toBe(false)
  // Even when a catalog row happens to carry a record id, browsing is read-only.
  expect(canEditTags({ isCatalogEntry: true, record_id: 42 })).toBe(false)
})

test('a metadata-only row is not editable', () => {
  expect(canEditTags({ isMetadataOnly: true, record_id: 7 })).toBe(false)
})

test('a local library record is editable', () => {
  expect(canEditTags({ record_id: 7 })).toBe(true)
  expect(canEditTags({ record_id: 7, isCatalogEntry: false, isMetadataOnly: false })).toBe(true)
})

test('a record with no id is not editable', () => {
  expect(canEditTags({ record_id: null })).toBe(false)
  expect(canEditTags({ record_id: 0 })).toBe(false)
  expect(canEditTags({})).toBe(false)
})

test('a missing game is handled rather than thrown on', () => {
  expect(canEditTags(null)).toBe(false)
  expect(canEditTags(undefined)).toBe(false)
})

// Guard the wiring too: the helper existing is no use if the component stops
// consulting it, and the read-only branch has to stay reachable.
test('the detail page gates the editor on the helper and keeps a read-only branch', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'components', 'detail', 'GameDetailPage.jsx'),
    'utf8',
  )
  expect(src).toContain("from '../../utils/tagEditing.js'")
  expect(src).toContain('canEditTagsFor(game)')
  // Read-only chips come from detailTags, which is what Browse rows populate.
  expect(src).toMatch(/!tagsEditable \?[\s\S]{0,400}detailTags/)
  // The editor is only reached on the editable branch.
  const editorAt = src.indexOf('<TagEditor')
  const gateAt = src.lastIndexOf('tagsEditable', editorAt)
  expect(gateAt).toBeGreaterThan(-1)
})
