import { describe, it, expect } from 'vitest'
import { keepsBothVersions, bannerTargetFor } from '../src/components/downloads/cardFacts.js'

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

describe('bannerTargetFor', () => {
  const game = { hasInstalledVersion: false }
  const installedGame = { hasInstalledVersion: true }

  it('opens the game in Atlas once installed', () => {
    expect(bannerTargetFor({ game: installedGame, threadUrl: 'https://t/', hostUrl: 'https://h/' }))
      .toBe('game')
  })

  it('opens the thread while it is not installed', () => {
    expect(bannerTargetFor({ game, threadUrl: 'https://t/', hostUrl: 'https://h/' })).toBe('thread')
  })

  it('still opens the game page when a library game has no thread', () => {
    // Regression guard. Before the click targets landed, ANY row with a game
    // record opened the game page; requiring a thread url made Steam imports and
    // local titles -- which have no forum link -- silently dead.
    expect(bannerTargetFor({ game, threadUrl: '', hostUrl: '' })).toBe('game')
  })

  it('falls back to the host page when there is no library record', () => {
    expect(bannerTargetFor({ game: null, threadUrl: '', hostUrl: 'https://h/' })).toBe('host')
  })

  it('is inert only when there is genuinely nowhere to go', () => {
    expect(bannerTargetFor({ game: null, threadUrl: '', hostUrl: '' })).toBeNull()
  })
})
