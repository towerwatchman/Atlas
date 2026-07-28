import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')

const editor = read('src/components/tags/TagEditor.jsx')
const detailPage = read('src/components/detail/GameDetailPage.jsx')
const recordTab = read('src/components/detail/window/RecordTab.jsx')

// The three states have to be visually distinct, or there is no way to tell a
// scraped tag from one you added and Reset becomes a mystery button.
test('the editor distinguishes user-added tags from catalog tags', () => {
  expect(editor).toContain('isUserAdded')
  expect(editor).toMatch(/Added by you/)
  expect(editor).toMatch(/From the catalog/)
})

// Removed catalog tags are offered back, so the override is reversible per tag
// rather than only all-at-once through Reset.
test('removed catalog tags can be restored individually', () => {
  expect(editor).toContain('restoreTag')
  expect(editor).toMatch(/Restore \$\{tag\}/)
})

test('reset is only offered when an override exists', () => {
  expect(editor).toMatch(/overridden && onReset/)
})

test('the editor is present in both hosts', () => {
  expect(recordTab).toContain('<TagEditor')
  expect(detailPage).toContain('<TagEditor')
})

// The disabled "Coming soon" textarea it replaced.
test('the old disabled tags textarea is gone', () => {
  expect(recordTab).not.toContain('id="record-tags"')
  expect(recordTab).not.toMatch(/title="Coming soon"[\s\S]{0,80}Tags/)
})

test('both hosts drive the editor from useTagState', () => {
  expect(detailPage).toContain('useTagState(')
  expect(read('src/components/detail/GameDetailsWindow.jsx')).toContain('useTagState(')
})

// ── Bulk tagging entry point ────────────────────────────────────────────────

const app = read('src/App.jsx')
const bulkModal = read('src/components/collections/BulkTagModal.jsx')

test('the collection tile menu offers bulk tagging', () => {
  expect(app).toContain("label: 'Tag All Games…'")
  expect(app).toContain('collectionBulkTagRequested')
})

test('the bulk dialog is wired to the round-trip channel', () => {
  expect(app).toContain('onCollectionBulkTagRequested')
  expect(app).toContain('<BulkTagModal')
})

// Applying one shared tag list across a collection would wipe each game's own
// tags, so the dialog must send add/remove rather than a replacement list.
test('bulk tagging sends a diff, never a replacement list', () => {
  expect(bulkModal).toContain('bulkEditTags({ recordIds, add, remove })')
  expect(bulkModal).not.toMatch(/setTagOverride/)
})

// The remove field suggests from the collection, not the library: most
// library-wide tags are not present and so cannot be removed.
test('remove suggestions come from the collection, additions from the library', () => {
  expect(bulkModal).toContain('suggestionPool={knownTags}')
  expect(bulkModal).toContain('suggestionPool={presentTags}')
  expect(app).toContain('bulkTagPresentTags')
})

// Both entry points must autocomplete from the same pool or spellings drift.
test('editor and bulk dialog share one autocomplete source', () => {
  expect(editor).toContain("from '../../hooks/useKnownTags.js'")
  expect(read('src/components/tags/TagChipInput.jsx')).toContain("from '../../hooks/useKnownTags.js'")
})

// Hook deps arrays evaluate at render, so a memo referencing a const declared
// later is a temporal dead zone error. This bit main.js once already.
test('bulk tag memos are declared after what they depend on', () => {
  const gamesByRecordId = app.indexOf('const gamesByRecordId = useMemo(')
  const presentTags = app.indexOf('const bulkTagPresentTags = useMemo(')
  expect(gamesByRecordId).toBeGreaterThan(-1)
  expect(presentTags).toBeGreaterThan(gamesByRecordId)
})
