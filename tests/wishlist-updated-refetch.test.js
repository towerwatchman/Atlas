// When a wishlist-updated broadcast arrives, App.jsx has to decide whether to
// refetch the Browse catalog. The decision has two independent reasons, and a
// test that only greps App.jsx for the source check would miss the second one:
//
//   1. source === 'extension' -- the extension has no optimistic UI, so the
//      renderer never flipped anything and needs the server's answer.
//   2. the active Browse filter is wishlistOnly -- the row SET is decided
//      server-side, so flipping an identity key clears the badge but leaves
//      the row on screen. This one bit the context-menu path: skipping the
//      refetch on a wishlistOnly view left un-wishlisted rows in the grid.
//
// The predicate lives in src/utils/wishlistRefresh.js and App.jsx calls it, so
// these assertions exercise the same code the app runs rather than a copy.

import { describe, test, expect } from 'vitest'
import { shouldRefetchCatalog } from '../src/utils/wishlistRefresh.js'

describe('wishlist-updated catalog refetch rule', () => {
  test('context-menu toggle on a normal Browse view skips the refetch', () => {
    // The optimistic identity-key flip already updated the badge in place, so
    // refetching would only flash the virtualized grid.
    expect(shouldRefetchCatalog({ source: 'context-menu' }, { wishlistOnly: false }, true)).toBe(false)
  })

  test('context-menu toggle under a wishlistOnly filter DOES refetch', () => {
    // Regression: the row set comes from the server. Without this the row stays
    // visible in a wishlist-only view after being un-wishlisted.
    expect(shouldRefetchCatalog({ source: 'context-menu' }, { wishlistOnly: true }, true)).toBe(true)
  })

  test('extension writes always refetch', () => {
    expect(shouldRefetchCatalog({ source: 'extension' }, { wishlistOnly: false }, true)).toBe(true)
  })

  test('an untagged broadcast is treated as non-optimistic only when the filter needs it', () => {
    expect(shouldRefetchCatalog(undefined, { wishlistOnly: false }, true)).toBe(false)
    expect(shouldRefetchCatalog(undefined, { wishlistOnly: true }, true)).toBe(true)
  })

  test('nothing refetches when Browse is unavailable', () => {
    expect(shouldRefetchCatalog({ source: 'extension' }, { wishlistOnly: true }, false)).toBe(false)
  })
})
