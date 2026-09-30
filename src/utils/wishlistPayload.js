// The field contract for a wishlist toggle sent across IPC.
//
// The context menu used to spread the whole game object into the action
// payload, which pushed overview text, preview url lists and the entire
// versions array through structured clone on every toggle. Only the keys that
// normalizeWishlistEntry / normalizeSource / getWishlistEntry actually read in
// electron/db/wishlist.js matter, so those are picked explicitly.
//
// Every alias the main process accepts is listed. Nothing is renamed here on
// purpose: normalization stays in one place (the main process), so this list is
// the only thing to update if the accepted aliases ever change.
const WISHLIST_PAYLOAD_FIELDS = [
  // identity / source resolution
  'source',
  'identity_key',
  'atlas_id', 'atlasId',
  'f95_id', 'f95Id',
  'lc_id', 'lcId', 'lewdCornerId', 'lewdcornerId',
  'steam_id', 'steamId', 'steam_appid',
  // display identity
  'title', 'name', 'short_name',
  'creator', 'developer',
  // metadata persisted on the wishlist row
  'engine',
  'status',
  'latestVersion', 'latest_version', 'version',
  'category',
  'genre',
  'rating',
  'tags', 'f95_tags', 'lewdcornerTags',
  'overview', 'description',
  'external_ids',
  'steamUrl', 'steam_url', 'storeUrl',
  'preview_urls', 'previewUrls',
  'siteUrl', 'site_url', 'lewdCornerSiteUrl', 'lewdcornerSiteUrl',
  'bannerUrl', 'banner_url', 'lewdCornerBannerUrl', 'lewdcornerBannerUrl',
  'note',
]

/**
 * Pick just the fields the wishlist toggle needs from a game row.
 * Absent keys are omitted rather than sent as undefined.
 */
export const buildWishlistPayload = (game = {}) => {
  const payload = {}
  for (const field of WISHLIST_PAYLOAD_FIELDS) {
    if (game[field] !== undefined) payload[field] = game[field]
  }
  return payload
}

export { WISHLIST_PAYLOAD_FIELDS }
