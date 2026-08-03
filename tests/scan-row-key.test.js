import { describe, it, expect } from 'vitest'
import { getScanGameKey, hasStableScanKey } from '../src/components/importer/scanRowKey.js'

// The contract that matters: a row's key must not change when match resolution
// rewrites the row. resolvePendingMatches builds a Map keyed by this function
// from the RESOLVED rows, then looks each row up by computing the key on the
// ORIGINAL row. If the two differ, the lookup misses, the `|| game` fallback
// keeps the unresolved row, and it sits in pendingMatch forever with no error.
//
// Resolution overwrites title, creator and atlasId with the catalog's values,
// which is precisely what the old composite key was built from.

// What resolve-import-matches does to a row it matched.
const resolve = (row) => ({
  ...row,
  atlasId: '90210',
  // The catalog's spelling wins over the source tool's.
  title: row.title.toUpperCase(),
  creator: `${row.creator} Studios`,
  engine: "Ren'Py",
  latestVersion: 'v9.9',
  results: [{ key: 'match', value: 'Match Found' }],
  resultSelectedValue: 'match',
  scanStatus: 'new',
  scanMessage: 'Ready to import',
})

describe('getScanGameKey', () => {
  it('survives match resolution for an external library row with nothing installed', () => {
    // The regression. 2,098 of 2,348 rows in a real XLibrary export have no
    // launch configuration, so no folder — exactly this shape.
    const row = {
      sourceType: 'xlibrary',
      externalSource: 'xlibrary',
      externalId: 'bafc18ca-522c-4f8e-8c2d-e11d2060912d',
      title: 'Heart Problems',
      creator: 'xenorav',
      version: 'Christmas Special',
      f95Id: '63437',
      folder: '',
      singleExecutable: '',
      atlasId: '',
    }
    expect(getScanGameKey(resolve(row))).toBe(getScanGameKey(row))
  })

  it('survives match resolution for an F95Checker row with nothing installed', () => {
    const row = {
      sourceType: 'f95checker',
      externalSource: 'f95checker',
      externalId: 12345,
      title: 'Tracked Game',
      creator: 'Dev One',
      f95Id: '12345',
      folder: '',
      singleExecutable: '',
      atlasId: '',
    }
    expect(getScanGameKey(resolve(row))).toBe(getScanGameKey(row))
  })

  it('survives resolution for an installed external row too', () => {
    const row = {
      sourceType: 'f95checker',
      externalSource: 'f95checker',
      externalId: 999,
      title: 'Installed Game',
      creator: 'Dev Two',
      folder: 'D:\\Games\\Installed',
      singleExecutable: 'Game.exe',
      atlasId: '',
    }
    expect(getScanGameKey(resolve(row))).toBe(getScanGameKey(row))
  })

  it('distinguishes every row in a batch that shares a folder value', () => {
    // All the not-installed rows have folder '' and singleExecutable '', so the
    // key has to come from somewhere else or they collapse into one another.
    const rows = Array.from({ length: 200 }, (_, index) => ({
      sourceType: 'xlibrary',
      externalSource: 'xlibrary',
      externalId: `uuid-${index}`,
      title: 'Same Title',
      creator: 'Same Dev',
      folder: '',
      singleExecutable: '',
    }))
    const keys = new Set(rows.map(getScanGameKey))
    expect(keys.size).toBe(rows.length)
  })

  it('keeps external identity ahead of folder, so one row has one key', () => {
    // Both branches would produce a stable key here; what matters is that the
    // same row always takes the same branch, because selection, removal and the
    // wishlist toggle all key off this function too.
    const row = {
      externalSource: 'xlibrary',
      externalId: 'uuid-1',
      folder: 'D:\\Games\\X',
      singleExecutable: 'X.exe',
    }
    expect(getScanGameKey(row)).toBe('external:xlibrary:uuid-1')
  })

  it('accepts an external id of 0 rather than falling through', () => {
    // A falsy-but-valid id. F95Checker's ids are positive, but a reader that
    // ever emits 0 must not silently land on the volatile branch.
    expect(getScanGameKey({ externalSource: 'x', externalId: 0 })).toBe('external:x:0')
  })

  it('still keys folder scans off their path', () => {
    expect(getScanGameKey({ folder: '/games/Thing', singleExecutable: 'run.sh' }))
      .toBe('folder-file:/games/Thing/run.sh')
    expect(getScanGameKey({ folder: '/games/Thing' })).toBe('folder:/games/Thing')
    expect(getScanGameKey({ sourceFile: '/dl/game.zip' })).toBe('source:/dl/game.zip')
    expect(getScanGameKey({ sourceType: 'renpySave', savePath: '/saves/x' }))
      .toBe('renpy:/saves/x')
  })

  it('does not confuse two providers that use the same id space', () => {
    const a = { externalSource: 'f95checker', externalId: 12345 }
    const b = { externalSource: 'xlibrary', externalId: 12345 }
    expect(getScanGameKey(a)).not.toBe(getScanGameKey(b))
  })
})

describe('hasStableScanKey', () => {
  it('flags the volatile branch, which is the one that cannot be written back', () => {
    // A manual row with no path and no external source: its key is built from
    // title/creator/atlasId, all of which resolution rewrites.
    expect(hasStableScanKey({ title: 'Manual', creator: 'Someone' })).toBe(false)
    const volatile = { title: 'Manual', creator: 'Someone', f95Id: '1' }
    expect(getScanGameKey(resolve(volatile))).not.toBe(getScanGameKey(volatile))
  })

  it('accepts every branch that resolution leaves alone', () => {
    expect(hasStableScanKey({ externalSource: 'xlibrary', externalId: 'u' })).toBe(true)
    expect(hasStableScanKey({ sourceType: 'renpySave', savePath: '/s' })).toBe(true)
    expect(hasStableScanKey({ sourceFile: '/a.zip' })).toBe(true)
    expect(hasStableScanKey({ folder: '/g' })).toBe(true)
  })
})
