// Contract for wishlist identity/state derivation. isWishlisted is the ONLY
// renderer source of truth for "is this game in the wishlist". The old
// isWishlistEntry boolean flag also had to be true for it to render, but the
// flag could not be cleared once set, which made an installed wishlist game look
// permanently wishlisted (both the detail panel and banner). These tests pin the
// fix down: the identity-key set alone decides, and a stale isWishlistEntry flag
// still sitting on a row is ignored.

import { describe, it, expect } from 'vitest'
import { getWishlistIdentityKey, withWishlistState, withWishlistStates } from '../src/utils/wishlistIdentity.js'

describe('wishlist identity + state', () => {
  it('builds a stable identity key from provider ids', () => {
    expect(getWishlistIdentityKey({ f95_id: 44821 })).toBe('f95:44821')
    expect(getWishlistIdentityKey({ steam_id: '480' })).toBe('steam:480')
    expect(getWishlistIdentityKey({ source: 'atlas', atlas_id: 30956 })).toBe('atlas:30956')
  })

  it('marks a game wishlisted only when its identity is in the set', () => {
    const game = withWishlistState({ title: 'Foo', creator: 'Bar' }, new Set(['atlas:title:foo:bar']))
    expect(game.isWishlisted).toBe(true)
  })

  it('ignores a stale isWishlistEntry flag when the identity is not in the set', () => {
    // Regression: a row that once carried the (unclearable) isWishlistEntry flag
    // but is no longer in the wishlist must report isWishlisted === false.
    const game = withWishlistState({ title: 'Foo', creator: 'Bar', isWishlistEntry: true }, new Set())
    expect(game.isWishlisted).toBe(false)
  })

  it('maps an array through withWishlistStates, preserving nulls', () => {
    const out = withWishlistStates([
      { title: 'A', creator: 'X' },
      null,
    ], new Set(['atlas:title:a:x']))
    expect(out[0].isWishlisted).toBe(true)
    expect(out[1]).toBeNull()
  })
})
