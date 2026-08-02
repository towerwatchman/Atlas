// Contract between the two halves of the watchlist.
//
// A wishlist row is addressed by its `identity_key`, and that key is computed
// TWICE by separate code: electron/db/wishlist.js when the row is written, and
// src/utils/wishlistIdentity.js when the library UI decides whether to draw a
// game as wishlisted. If those two ever disagree, nothing throws — the entry is
// simply written and then never recognised again, which is the worst kind of
// bug to find by hand.
//
// The import path made that risk concrete: an external-library row can arrive
// with an F95 id, a LewdCorner id, both, or neither, so this pins the agreement
// across exactly those shapes.

import { describe, it, expect } from 'vitest'
import { getWishlistIdentityKey } from '../src/utils/wishlistIdentity.js'

const { normalizeWishlistEntry } = require('../electron/db/wishlist')

// The renderer reads camelCase/snake_case game objects; the main process reads
// the entry it was handed. Both must land on the same string.
const bothAgreeOn = (entry) => {
  const written = normalizeWishlistEntry(entry).identityKey
  const read = getWishlistIdentityKey(entry)
  expect(read).toBe(written)
  return written
}

describe('watchlist identity key agreement', () => {
  it('agrees for an F95-identified game', () => {
    expect(bothAgreeOn({ source: 'f95', f95_id: 37378, title: 'A', creator: 'B' }))
      .toBe('f95:37378')
  })

  it('agrees for a LewdCorner-identified game', () => {
    expect(bothAgreeOn({ source: 'lewdcorner', lc_id: 13917, title: 'A', creator: 'B' }))
      .toBe('lewdcorner:13917')
  })

  it('agrees when a LewdCorner row also carries an Atlas id', () => {
    // Both sides deliberately special-case this so the same game reached from
    // LewdCorner and from the catalog resolves to one entry, not two.
    expect(bothAgreeOn({ source: 'lewdcorner', lc_id: 13917, atlas_id: 900, title: 'A' }))
      .toBe('atlas:900')
  })

  it('prefers the F95 id when a row carries both', () => {
    expect(bothAgreeOn({ source: 'f95', f95_id: 37378, lc_id: 13917, title: 'A' }))
      .toBe('f95:37378')
  })

  it('agrees for a row with no source id at all', () => {
    // The 8 rows in a real F95Checker library that link to neither forum. The
    // import handler leaves `source` unset for these precisely so both sides
    // derive the same 'atlas' default.
    expect(bothAgreeOn({ title: 'Camp Arcadia', creator: 'Hael Games' }))
      .toBe('atlas:title:camp arcadia:hael games')
  })

  it('agrees on the title fallback regardless of spacing and case', () => {
    expect(bothAgreeOn({ title: '  Camp   Arcadia ', creator: 'HAEL games' }))
      .toBe('atlas:title:camp arcadia:hael games')
  })

  it('agrees when title or creator are missing entirely', () => {
    expect(bothAgreeOn({})).toBe('atlas:title:untitled:unknown')
  })
})

describe('watchlist identity: ids that must not be trusted', () => {
  // buildImportRow only ever emits positive ids, but the wishlist is also fed
  // by hand-edited rows and by the catalog, so a zero/negative/garbage id must
  // fall through to the title key rather than producing 'f95:-1'.
  it('ignores non-positive ids', () => {
    expect(bothAgreeOn({ f95_id: 0, title: 'A', creator: 'B' }))
      .toBe('atlas:title:a:b')
    expect(bothAgreeOn({ f95_id: -1, title: 'A', creator: 'B' }))
      .toBe('atlas:title:a:b')
  })

  it('ignores non-numeric ids', () => {
    expect(bothAgreeOn({ f95_id: 'not-an-id', title: 'A', creator: 'B' }))
      .toBe('atlas:title:a:b')
  })

  it('accepts a numeric string id, which is how the importer passes them', () => {
    // buildImportRow emits f95Id as a STRING; a mismatch here would give the
    // writer 'f95:37378' and the reader the title key.
    expect(bothAgreeOn({ source: 'f95', f95_id: '37378', title: 'A' }))
      .toBe('f95:37378')
  })
})
