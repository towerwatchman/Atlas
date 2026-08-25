// Whether a wishlist-updated broadcast should trigger a Browse catalog refetch.
//
// Two independent reasons, and both matter:
//
//   1. source === 'extension' -- the extension has no optimistic UI, so the
//      renderer never flipped anything locally and needs the server's answer.
//   2. the active Browse filter is wishlistOnly -- the row SET is decided
//      server-side by the wishlist EXISTS clauses, so flipping an identity key
//      updates the badge on a row but cannot remove the row. Without this the
//      grid keeps showing titles that are no longer wishlisted.
//
// A context-menu toggle on any other view needs no refetch: the optimistic flip
// of wishlistIdentityKeys already re-derived the badge through
// catalogWithWishlist, and refetching would replace the array and flash the
// virtualized grid for no visible gain.
export const shouldRefetchCatalog = (payload, filters, browseAvailable) => {
  if (!browseAvailable) return false
  return payload?.source === 'extension' || filters?.wishlistOnly === true
}
