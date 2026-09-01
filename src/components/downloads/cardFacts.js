// ── What a download card asserts, and where it points ────────────────────────
//
// Both decisions live here because the card is rendered twice -- DownloadsPage
// and DownloadsDock -- and the dock has no game records at all. Inline copies
// would drift, and one of them already had: the "keeps both versions" line was
// duplicated in both files and wrong in both.

import { isInstalledGame } from './threadUrl.js'

/**
 * Whether "keeps both versions" is a true statement about this row.
 *
 * `onComplete === 'add'` alone is not enough. ipc/downloads.js forces "add" for
 * any download with no library record -- "Nothing to replace without a library
 * record, whatever the caller asked for" -- which is right for the install logic
 * and meaningless as a caption. It made every download of a game you do not own
 * yet claim it was keeping both of something that did not exist.
 *
 * So: a record id means the mode was a real choice rather than a forced default,
 * and a loaded game must actually have an installed version to keep. When the
 * game is not loaded the record id is trusted, because gamesByRecordId is built
 * from the FILTERED library list and a real record can resolve to null.
 */
export function keepsBothVersions(item, game) {
  if (item?.onComplete !== 'add') return false
  if (!item?.recordId) return false
  if (!game) return true
  return isInstalledGame(game)
}

/**
 * Where the banner click goes: 'game' | 'thread' | 'host' | null.
 *
 * Installed titles open inside Atlas; anything else opens the page a user would
 * want while still deciding. The order matters more than it looks:
 *
 *   - A library game with no thread url still opens its game page. Requiring a
 *     thread url made Steam imports and local titles silently dead, which was a
 *     regression against the original behaviour of opening the game page for any
 *     row that had a record at all.
 *   - A row with no record at all falls back to the host page. That was
 *     originally left inert on the understanding it meant Browse and wishlist
 *     downloads only; it actually covers every download of a game not already in
 *     the library, which is the common case, and an inert banner there reads as
 *     broken rather than deliberate.
 */
export function bannerTargetFor({ game = null, threadUrl = '', hostUrl = '' } = {}) {
  if (game) {
    if (isInstalledGame(game)) return 'game'
    return threadUrl ? 'thread' : 'game'
  }
  if (threadUrl) return 'thread'
  return hostUrl ? 'host' : null
}
