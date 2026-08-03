// ── Scan row identity ────────────────────────────────────────────────────────
//
// One row in the importer's review table, identified stably enough that a row
// can be found again after it has been changed.
//
// That last part is the whole point, and it is where this used to be wrong. The
// key is not just a React list key: `resolvePendingMatches` builds a Map of
// resolved rows keyed by this function and then looks each row up by computing
// the key on the ORIGINAL, unresolved row. If resolving a row changes anything
// the key is derived from, the lookup misses, the `|| game` fallback keeps the
// unresolved row, and it stays in `pendingMatch` forever.
//
// Match resolution overwrites `title`, `creator` and `atlasId` with the
// catalog's values, so any key built from those is guaranteed to change exactly
// when it must not. Folder-scanned rows were unaffected because they key off
// their folder path, which resolution never touches — which is why this only
// ever showed up for external library imports, and within those only for the
// rows with nothing installed (no folder to key off). On a library where most
// games are tracked rather than installed, that is most of the table.
//
// So the order below is deliberate: every branch is a value that resolution does
// not rewrite, and the volatile composite is the last resort for rows that have
// no stable identity of their own.

/**
 * A stable identity for one importer scan row.
 *
 * @param {object} game
 * @returns {string}
 */
export function getScanGameKey(game) {
  // An external library row carries the source tool's own primary key — a UUID
  // for XLibrary, the games-table id for F95Checker. Nothing about matching or
  // editing can change it, which makes it the best identity available and the
  // reason it is checked first.
  if (game?.externalSource && (game?.externalId || game?.externalId === 0)) {
    return `external:${game.externalSource}:${game.externalId}`
  }
  if (game?.sourceType === 'renpySave') {
    return `renpy:${game.savePath || game.saveId || game.title}`
  }
  if (game?.sourceFile) return `source:${game.sourceFile}`
  if (game?.folder && game?.singleExecutable) {
    return `folder-file:${game.folder}/${game.singleExecutable}`
  }
  if (game?.folder) return `folder:${game.folder}`
  // Last resort. Everything here can be rewritten by match resolution or edited
  // by the user, so a row that lands on this branch cannot be reliably found
  // again after either. Rows reaching it should be rare: a manual entry with no
  // path and no external source.
  return [
    game?.sourceFile,
    game?.folder,
    game?.singleExecutable,
    game?.title,
    game?.creator,
    game?.version,
    game?.f95Id,
    game?.lcId,
    game?.lewdCornerId,
    game?.atlasId,
  ].join('|')
}

/**
 * Whether a row's key survives match resolution.
 *
 * Exposed so the resolver can warn instead of silently dropping a row: a key on
 * the volatile branch is the one case where a resolved row cannot be written
 * back, and that failure is invisible without saying so.
 */
export function hasStableScanKey(game) {
  return Boolean(
    (game?.externalSource && (game?.externalId || game?.externalId === 0))
    || game?.sourceType === 'renpySave'
    || game?.sourceFile
    || game?.folder,
  )
}

export default getScanGameKey
