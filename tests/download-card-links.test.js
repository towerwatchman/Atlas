import { describe, it, expect } from 'vitest'
import { buildThreadUrl, threadUrlForGame, isInstalledGame } from '../src/components/downloads/threadUrl.js'

// ── Download card click targets ──────────────────────────────────────────────
//
// The banner opens the game's thread while it is not installed and Atlas's own
// game page once it is, so both halves depend on reading a game record correctly.
//
// ── WHY NOT getInstalledVersions(game.versions) ──────────────────────────────
//
// That is how GameDetailPage decides, and copying it here would be wrong. Detail
// gets a hydrated record; DownloadsPage gets rows out of the LIBRARY LIST, and a
// plain catalog row is built with `versions: []` (db/versions.js:2087) even when
// the title is installed. getInstalledVersions would return an empty array and
// report every such game as not installed, sending the banner to a forum thread
// for something already in the library.
//
// hasInstalledVersion is set on BOTH row shapes -- from installedVersions.length
// on the hydrated path and from row.is_installed on the catalog path -- so it is
// the only field that answers the question for every row the card can be handed.

describe('isInstalledGame', () => {
  it('reads hasInstalledVersion on a hydrated row', () => {
    expect(isInstalledGame({ hasInstalledVersion: true, versions: [{ isInstalled: true }] })).toBe(true)
    expect(isInstalledGame({ hasInstalledVersion: false, versions: [] })).toBe(false)
  })

  it('trusts hasInstalledVersion on a catalog row whose versions array is empty', () => {
    // The exact shape from db/versions.js:2087. Deriving from `versions` here
    // would say "not installed" for an installed game.
    expect(isInstalledGame({ hasInstalledVersion: true, versions: [] })).toBe(true)
  })

  it('is false for a missing game rather than throwing', () => {
    // gamesByRecordId is built from the FILTERED library list, so a game outside
    // the current filter resolves to null. That is "unknown", and unknown must
    // not read as installed.
    expect(isInstalledGame(null)).toBe(false)
    expect(isInstalledGame(undefined)).toBe(false)
    expect(isInstalledGame({})).toBe(false)
  })
})

describe('threadUrlForGame', () => {
  // The field-name variance was duplicated at the UpdateModal call site. One
  // copy is a helper; two copies are a future bug where a card and a modal
  // disagree about where the same game's thread is.
  it('accepts the snake_case shape', () => {
    expect(threadUrlForGame({ site_url: 'https://f95zone.to/threads/123/' }))
      .toBe('https://f95zone.to/threads/123/')
    expect(threadUrlForGame({ f95_id: 456 })).toBe('https://f95zone.to/threads/456/')
    expect(threadUrlForGame({ lc_id: 789 })).toBe('https://lewdcorner.com/threads/789/')
  })

  it('accepts the camelCase shape', () => {
    expect(threadUrlForGame({ siteUrl: 'https://f95zone.to/threads/1/' }))
      .toBe('https://f95zone.to/threads/1/')
    expect(threadUrlForGame({ f95Id: 2 })).toBe('https://f95zone.to/threads/2/')
    expect(threadUrlForGame({ lewdCornerId: 3 })).toBe('https://lewdcorner.com/threads/3/')
  })

  it('returns empty for a game with nothing to open', () => {
    // A Browse or wishlist download has no record at all. The caller renders an
    // inert banner rather than a link that goes nowhere.
    expect(threadUrlForGame(null)).toBe('')
    expect(threadUrlForGame({})).toBe('')
    expect(threadUrlForGame({ f95_id: 0 })).toBe('')
  })

  it('agrees with buildThreadUrl for the same inputs', () => {
    const game = { site_url: '', f95_id: 42, lc_id: 7 }
    expect(threadUrlForGame(game)).toBe(buildThreadUrl({ f95Id: 42, lcId: 7 }))
  })
})
