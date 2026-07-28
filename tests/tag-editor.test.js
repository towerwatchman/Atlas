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
