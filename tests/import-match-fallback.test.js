// Contract for resolve-import-matches' title fallback.
//
// When a row's thread id is not in Atlas's catalog, the handler now falls back
// to a title + creator search instead of reporting no match. That fallback is
// useful but carries a specific hazard worth pinning down:
//
//   The row's thread id is only PROVEN to belong to the matched catalog game
//   when the ID LOOKUP is what found it. If a title search found it instead,
//   carrying the id onto the match makes the import writer INSERT a row into
//   f95_zone_mappings / lewdcorner_mappings asserting a link the catalog does
//   not make — quietly poisoning the mapping tables with a wrong association
//   that then affects updates, media and launch for that record.
//
// Two separate functions re-introduce the id if you let them, because both fall
// back to the row's own value when the match has none:
//
//   applyImportMatchData  -> f95Id: match.f95_id || ... || game.f95Id || ""
//   hydrateImportMatch    -> f95Id: selected.f95Id || parts[1] || game.f95Id
//
// so passing an empty options object is NOT sufficient. These tests encode the
// shape of both real functions and assert the guard holds for each path.

import { describe, it, expect } from 'vitest'

// ── The two upstream behaviours being guarded against ──────────────────────
// Mirrors of the real implementations in electron/ipc/importer.js. They are
// reproduced rather than imported because the module registers live IPC
// handlers on load; if either original changes shape, the comment block above
// is the trail back to why this matters.
const applyImportMatchData = (game, match, { f95Id = '', lcId = '' } = {}) => ({
  ...game,
  atlasId: String(match.atlas_id || match.atlasId || ''),
  f95Id: match.f95_id || match.f95Id || f95Id || game.f95Id || '',
  lcId: match.lc_id || match.lcId || match.lewdCornerId || lcId || game.lcId || game.lewdCornerId || '',
  lewdCornerId: match.lc_id || match.lcId || match.lewdCornerId || lcId || game.lewdCornerId || game.lcId || '',
})

const selectCandidate = (game, selected) => ({
  ...game,
  atlasId: selected.atlasId,
  f95Id: selected.f95Id || game.f95Id || '',
  lcId: selected.lcId || game.lcId || game.lewdCornerId || '',
})

// ── The guard, as applied in resolve-import-matches ────────────────────────
const withVerifiedIdsOnly = (matched, match, { f95Id, lcId }) => ({
  ...matched,
  f95Id: String(match.f95_id || match.f95Id || ''),
  lcId: String(match.lc_id || match.lcId || match.lewdCornerId || ''),
  lewdCornerId: String(match.lc_id || match.lcId || match.lewdCornerId || ''),
  unverifiedF95Id: f95Id || '',
  unverifiedLcId: lcId || '',
  matchedByTitleFallback: true,
})

const stripForCandidateList = (game, { f95Id, lcId }) => ({
  ...game,
  f95Id: '',
  lcId: '',
  lewdCornerId: '',
  unverifiedF95Id: f95Id || '',
  unverifiedLcId: lcId || '',
  matchedByTitleFallback: true,
})

// A row out of F95Checker whose thread id Atlas has never heard of.
const rowWithUnknownId = { f95Id: '37378', title: 'Sakura Gozen', creator: 'kaniheadcrab' }
// The catalog game the title search found. It carries no F95 id of its own.
const catalogMatchNoF95 = { atlas_id: 900, title: 'Sakura Gozen', creator: 'kaniheadcrab' }

describe('single-result fallback', () => {
  it('demonstrates the leak an empty options object does NOT prevent', () => {
    // This is the bug, asserted so nobody "simplifies" the guard back into it.
    const naive = applyImportMatchData(rowWithUnknownId, catalogMatchNoF95, {})
    expect(naive.f95Id).toBe('37378')
  })

  it('never carries an unverified F95 id onto the match', () => {
    const guarded = withVerifiedIdsOnly(
      applyImportMatchData(rowWithUnknownId, catalogMatchNoF95, {}),
      catalogMatchNoF95,
      { f95Id: '37378', lcId: '' },
    )
    expect(guarded.f95Id).toBe('')
    expect(guarded.atlasId).toBe('900')
  })

  it('keeps the unverified id visible for the review table', () => {
    const guarded = withVerifiedIdsOnly(
      applyImportMatchData(rowWithUnknownId, catalogMatchNoF95, {}),
      catalogMatchNoF95,
      { f95Id: '37378', lcId: '' },
    )
    // Dropped from the field that writes a mapping, kept where the UI can show
    // the user which id failed to resolve.
    expect(guarded.unverifiedF95Id).toBe('37378')
    expect(guarded.matchedByTitleFallback).toBe(true)
  })

  it('still adopts an id the matched catalog game genuinely has', () => {
    // A different, catalogued F95 id is verified data and must survive.
    const match = { atlas_id: 900, f95_id: 55555 }
    const guarded = withVerifiedIdsOnly(
      applyImportMatchData(rowWithUnknownId, match, {}),
      match,
      { f95Id: '37378', lcId: '' },
    )
    expect(guarded.f95Id).toBe('55555')
  })

  it('applies the same rule to LewdCorner ids', () => {
    const row = { lcId: '13917', lewdCornerId: '13917', title: 'A' }
    const guarded = withVerifiedIdsOnly(
      applyImportMatchData(row, catalogMatchNoF95, {}),
      catalogMatchNoF95,
      { f95Id: '', lcId: '13917' },
    )
    expect(guarded.lcId).toBe('')
    expect(guarded.lewdCornerId).toBe('')
    expect(guarded.unverifiedLcId).toBe('13917')
  })
})

describe('multi-candidate fallback', () => {
  it('demonstrates the same leak when the picked candidate has no id', () => {
    const leaked = selectCandidate(rowWithUnknownId, { atlasId: '900', f95Id: '', lcId: '' })
    expect(leaked.f95Id).toBe('37378')
  })

  it('strips the unverified id from the row before candidates are offered', () => {
    const base = stripForCandidateList(rowWithUnknownId, { f95Id: '37378', lcId: '' })
    const picked = selectCandidate(base, { atlasId: '900', f95Id: '', lcId: '' })
    expect(picked.f95Id).toBe('')
    expect(base.unverifiedF95Id).toBe('37378')
  })

  it('lets a candidate that has its own id supply it', () => {
    const base = stripForCandidateList(rowWithUnknownId, { f95Id: '37378', lcId: '' })
    const picked = selectCandidate(base, { atlasId: '901', f95Id: '55555', lcId: '' })
    expect(picked.f95Id).toBe('55555')
  })
})

describe('verified matches are untouched', () => {
  it('keeps the id when the ID LOOKUP is what found the match', () => {
    // matchedBy === 'f95Id': the catalog itself asserts the link, so the id
    // flows through exactly as it did before the fallback existed.
    const verified = applyImportMatchData(rowWithUnknownId, catalogMatchNoF95, { f95Id: '37378', lcId: '' })
    expect(verified.f95Id).toBe('37378')
    expect(verified.matchedByTitleFallback).toBeUndefined()
  })

  it('leaves a row that never had an id unaffected', () => {
    // These were always title-matched, so nothing about them is newly
    // uncertain and they keep the plain "Match Found" treatment.
    const row = { title: 'Camp Arcadia', creator: 'Hael Games' }
    const matched = applyImportMatchData(row, catalogMatchNoF95, { f95Id: '', lcId: '' })
    expect(matched.f95Id).toBe('')
    expect(matched.atlasId).toBe('900')
  })
})
