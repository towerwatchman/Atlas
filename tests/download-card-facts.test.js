import { describe, it, expect } from 'vitest'
import { keepsBothVersions, downloadBannerTarget, downloadCatalogRef } from '../src/components/downloads/cardFacts.js'

// ── Two bugs, one root cause ─────────────────────────────────────────────────
//
// A download with no library record gets onComplete forced to "add" by
// ipc/downloads.js ("Nothing to replace without a library record, whatever the
// caller asked for"). That is correct for the INSTALL logic and wrong to show to
// a user: "keeps both versions" describes a choice nobody made, about a version
// that does not exist.
//
// The same missing record makes gamesByRecordId.get() return null, which left the
// banner inert. Both reports were the same row shape -- and it is the normal
// shape for downloading a game you do not own yet, not an edge case.

describe('keepsBothVersions', () => {
  it('is false when the row has no library record', () => {
    // The forced-"add" case. There is nothing to keep both OF.
    expect(keepsBothVersions({ onComplete: 'add', recordId: null }, null)).toBe(false)
  })

  it('is false for a tracked game with nothing installed yet', () => {
    expect(keepsBothVersions({ onComplete: 'add', recordId: 12 },
      { hasInstalledVersion: false })).toBe(false)
  })

  it('is true when there is genuinely another version to keep', () => {
    expect(keepsBothVersions({ onComplete: 'add', recordId: 12 },
      { hasInstalledVersion: true })).toBe(true)
  })

  it('trusts the row when the game is not loaded', () => {
    // gamesByRecordId is filtered, so a real record can resolve to null. A
    // record id means the mode was a genuine choice; showing it is right.
    expect(keepsBothVersions({ onComplete: 'add', recordId: 12 }, null)).toBe(true)
  })

  it('is false for replace mode regardless', () => {
    expect(keepsBothVersions({ onComplete: 'replace', recordId: 12 },
      { hasInstalledVersion: true })).toBe(false)
  })
})

describe('downloadBannerTarget', () => {
  const game = { hasInstalledVersion: false }
  const installedGame = { hasInstalledVersion: true }

  it('opens the library entry once installed', () => {
    expect(downloadBannerTarget({ game: installedGame, catalogRef: 'catalog:1' })).toBe('game')
  })

  it('opens Browse when the entry is known', () => {
    expect(downloadBannerTarget({ game, catalogRef: 'catalog:1' })).toBe('catalog')
    expect(downloadBannerTarget({ game: null, catalogRef: 'catalog:steam:480' })).toBe('catalog')
  })

  it('falls back to the library row when there is one', () => {
    // Local titles have no Browse entry.
    expect(downloadBannerTarget({ game, catalogRef: null })).toBe('game')
  })

  it('is inert only when there is nowhere to go', () => {
    expect(downloadBannerTarget({ game: null, catalogRef: null })).toBeNull()
  })
})

describe('downloadCatalogRef', () => {
  it('passes the stored ref through', () => {
    expect(downloadCatalogRef({ catalogRef: 'catalog:steam:480' }, null))
      .toBe('catalog:steam:480')
  })

  it('falls back to the atlas id', () => {
    expect(downloadCatalogRef({}, { atlas_id: 30956 })).toBe('catalog:30956')
    expect(downloadCatalogRef({}, { atlasId: 30956 })).toBe('catalog:30956')
  })

  it('returns null when there is nothing to open', () => {
    expect(downloadCatalogRef({}, null)).toBeNull()
    expect(downloadCatalogRef({}, {})).toBeNull()
  })
})
