import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Background index rebuild after a FULL snapshot (electron/db/updates.js).
//
// A snapshot prune can drop arbitrary catalog rows, so the browse index is fully
// stale the moment one lands. checkDbUpdates used to only flag it and wait for the
// next launch; now it also kicks off runBackgroundCatalogIndexRebuild() right there
// so the library refreshes without a restart. The function is one large body that
// needs a live db, a renderer, and network fetches to reach this tail, so the
// contract is pinned the way search-fields.test.js pins its non-exported union path:
// a source-text guard over the snapshot branch.

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')

test('updates.js pulls the rebuild from catalogIndexBackground', () => {
  const source = read('electron', 'db', 'updates.js')
  expect(source).toMatch(/require\(['"]\.\/catalogIndexBackground(?:\.js)?['"]\)/)
  expect(source).toContain('runBackgroundCatalogIndexRebuild')
})

test('the full-snapshot branch fires the rebuild, not awaited', () => {
  const source = read('electron', 'db', 'updates.js')
  const snapAt = source.indexOf('if (snapshotApplied)')
  const deltaAt = source.indexOf('else if (touchedAtlasIds', snapAt)
  expect(snapAt).toBeGreaterThan(-1)
  expect(deltaAt).toBeGreaterThan(snapAt)

  const snapshotBranch = source.slice(snapAt, deltaAt)
  expect(snapshotBranch).toContain('runBackgroundCatalogIndexRebuild()')
  expect(snapshotBranch).toContain('.catch(')
  expect(snapshotBranch).not.toMatch(/await\s+runBackgroundCatalogIndexRebuild/)
})

test('the delta branch does not fire the full rebuild', () => {
  const source = read('electron', 'db', 'updates.js')
  const deltaAt = source.indexOf('else if (touchedAtlasIds')
  const catchAt = source.indexOf('} catch (indexErr)', deltaAt)
  expect(deltaAt).toBeGreaterThan(-1)
  expect(catchAt).toBeGreaterThan(deltaAt)

  const deltaBranch = source.slice(deltaAt, catchAt)
  expect(deltaBranch).not.toContain('runBackgroundCatalogIndexRebuild')
})
