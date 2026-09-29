'use strict'

const dbModule = require('./index')
const {
  normalizeWishlistEntry,
  resolveMissingIds,
  getWishlistEntry,
  removeWishlistEntry,
} = require('./wishlist')
// Read through dbModule at call time: the handle does not exist until
// initializeDatabase runs, which is after this module is first required.
const getDb = () => dbModule.db

const normalizeId = (value) => {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

// Identity is deliberately the wishlist's (normalizeWishlistEntry), so a title
// has the same key on both lists and the renderer's getWishlistIdentityKey
// works for either.
//
// The one extension is GOG. The wishlist never learned about gog_id, so a
// GOG-only Browse row falls back to a title:creator key there. The blacklist
// has to match that row in SQL, which needs the id, so it is stored and used
// as the key whenever nothing better exists.
const normalizeBlacklistEntry = (entry = {}) => {
  const normalized = normalizeWishlistEntry(entry)
  const gogId = normalizeId(entry.gog_id ?? entry.gogId)
  const hasProviderId = normalized.atlasId || normalized.f95Id || normalized.lcId || normalized.steamId
  return {
    ...normalized,
    gogId,
    identityKey: !hasProviderId && gogId ? `gog:${gogId}` : normalized.identityKey,
  }
}

// Accepts a bare key, a stored row, or a game object, the same three shapes
// removeWishlistEntry takes, so the Settings list can pass its rows straight
// back.
const normalizeBlacklistIdentity = (identity = {}) => {
  if (typeof identity === 'string' && identity.trim()) return identity.trim()
  if (identity?.identity_key) return String(identity.identity_key).trim()
  return normalizeBlacklistEntry(identity).identityKey
}

// Blacklisting also clears the title from the wishlist: a title the user never
// wants to see again should not linger in the Wishlist view.
//
// resolveMissingIds runs first so the row carries every id the catalog knows
// for the title. Browse lists the same game once per source (an F95 row, an
// Atlas row, a LewdCorner row), and the exclusion SQL can only hide the
// siblings of the row that was clicked if their ids were stored too.
//
// The wishlist lookup uses getWishlistEntry rather than the key alone because
// the wishlist row may have been stored under a different key form (atlas: vs
// f95:) than the one rebuilt here.
const addBlacklistEntry = async (entry = {}) => {
  const normalized = await resolveMissingIds(normalizeBlacklistEntry(entry))
  const blacklistedAt = Math.floor(Date.now() / 1000)

  await new Promise((resolve, reject) => {
    getDb().run(
      `INSERT INTO blacklist_entries
       (identity_key, source, atlas_id, f95_id, lc_id, steam_id, gog_id, title, creator,
        banner_url, site_url, blacklisted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(identity_key) DO UPDATE SET
        atlas_id = COALESCE(excluded.atlas_id, blacklist_entries.atlas_id),
        f95_id = COALESCE(excluded.f95_id, blacklist_entries.f95_id),
        lc_id = COALESCE(excluded.lc_id, blacklist_entries.lc_id),
        steam_id = COALESCE(excluded.steam_id, blacklist_entries.steam_id),
        gog_id = COALESCE(excluded.gog_id, blacklist_entries.gog_id),
        banner_url = COALESCE(excluded.banner_url, blacklist_entries.banner_url),
        site_url = COALESCE(excluded.site_url, blacklist_entries.site_url)`,
      [
        normalized.identityKey,
        normalized.source,
        normalized.atlasId,
        normalized.f95Id,
        normalized.lcId,
        normalized.steamId,
        normalized.gogId,
        normalized.title,
        normalized.creator,
        normalized.bannerUrl,
        normalized.siteUrl,
        blacklistedAt,
      ],
      (err) => (err ? reject(err) : resolve()),
    )
  })

  let removedFromWishlist = false
  const wishlisted = await getWishlistEntry({
    ...entry,
    atlas_id: normalized.atlasId,
    f95_id: normalized.f95Id,
    lc_id: normalized.lcId,
    steam_id: normalized.steamId,
  })
  if (wishlisted) {
    const removal = await removeWishlistEntry(wishlisted)
    removedFromWishlist = removal?.removed === true
  }

  return {
    success: true,
    isBlacklisted: true,
    identityKey: normalized.identityKey,
    removedFromWishlist,
  }
}

// Removal is by stored key only. Unlike the wishlist there is no need to match
// on provider ids: the only caller is the Settings list, which hands back the
// exact row it was given.
const removeBlacklistEntry = (identity = {}) => {
  const identityKey = normalizeBlacklistIdentity(identity)
  return new Promise((resolve, reject) => {
    getDb().run(
      `DELETE FROM blacklist_entries WHERE identity_key = ?`,
      [identityKey],
      function (err) {
        if (err) reject(err)
        else resolve({ success: true, removed: this.changes > 0, isBlacklisted: false, identityKey })
      },
    )
  })
}

// Newest first, so something blacklisted by mistake a moment ago is at the top
// of the Settings list where the user goes looking for it.
const getBlacklistEntries = () => {
  return new Promise((resolve, reject) => {
    getDb().all(
      `SELECT * FROM blacklist_entries
       ORDER BY blacklisted_at DESC, title COLLATE NOCASE ASC`,
      [],
      (err, rows) => (err ? reject(err) : resolve(rows || [])),
    )
  })
}

module.exports = {
  addBlacklistEntry,
  removeBlacklistEntry,
  getBlacklistEntries,
  normalizeBlacklistEntry,
}
