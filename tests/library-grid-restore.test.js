import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8')

// Coming back from Browse left the top rows blank while lower rows still
// painted, because react-virtualized kept the cell range it rendered for the
// previous dataset. scrollToPosition does not invalidate that range.
test('the scroll restore forces a re-render, not just a scroll', () => {
  const start = app.indexOf('const restoreLibraryScrollIfNeeded')
  expect(start).toBeGreaterThan(-1)
  const body = app.slice(start, start + 1400)
  expect(body).toContain('recomputeGridSize')
  expect(body).toContain('scrollToPosition')
  expect(body).toContain('forceUpdate')
  // scrollToPosition must come before forceUpdate, or the forced render uses
  // the old offset.
  expect(body.indexOf('scrollToPosition')).toBeLessThan(body.indexOf('forceUpdate'))
})

// Retaining Browse art would be hundreds of MB, since scrolling the catalog
// walks every title.
test('image retention is scoped to the local library', () => {
  expect(app).toContain('retainImage(toMediaSrc(game.banner_url))')
  const call = app.indexOf('retainImage(toMediaSrc')
  const guard = app.lastIndexOf("libraryMode === 'local'", call)
  expect(guard).toBeGreaterThan(-1)
  expect(call - guard).toBeLessThan(400)
})

test('toMediaSrc and retainImage are both imported', () => {
  expect(app).toMatch(/import \{ retainImage \} from '\.\/utils\/imageRetention\.js'/)
  expect(app).toMatch(/import \{ toMediaSrc \} from '\.\/utils\/mediaSrc\.js'/)
})
