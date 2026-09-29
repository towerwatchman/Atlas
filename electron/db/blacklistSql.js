'use strict'

// The one WHERE fragment that hides blacklisted titles from Browse.
//
// It lives in its own dependency-free module because BOTH catalog query paths
// need it: buildIndexWhere (catalogIndex.js) serves the normal case, and
// getCatalogGamesFromUnion (versions.js) serves the index-not-ready and
// updateAvailable cases and every fast-path failure. A copy in each file is
// how the wishlistOnly and rating clauses drifted apart; one builder cannot.
// Requiring blacklist.js instead would drag wishlist.js and db/index.js into
// catalogIndex.js's require graph for the sake of a string.
//
// The exclusion is in the shared WHERE rather than applied to a fetched page so
// the COUNT and the page queries agree -- otherwise the grid's scrollbar is
// sized for rows that never render and Browse shows holes.
//
// One NOT EXISTS per provider id, not one EXISTS with an OR inside: SQLite can
// only use the per-column idx_blacklist_entries_* indexes when each probe
// matches a single column (same reasoning as wishlistOnly).
//
// Rows linked to a local record are never hidden. The blacklist is offered only
// on titles that are not in the library, and a title the user later installed
// anyway should not vanish from Browse because of an old entry.
const BLACKLIST_ID_COLUMNS = ['atlas_id', 'f95_id', 'lc_id', 'steam_id', 'gog_id']

const buildBlacklistExclusionSql = (alias, installedExpr) => {
  const probes = BLACKLIST_ID_COLUMNS.map((column) =>
    `NOT EXISTS (SELECT 1 FROM blacklist_entries bl WHERE bl.${column} IS NOT NULL AND bl.${column} = ${alias}.${column})`)
  return `(${installedExpr} OR (${probes.join(' AND ')}))`
}

module.exports = { buildBlacklistExclusionSql, BLACKLIST_ID_COLUMNS }
