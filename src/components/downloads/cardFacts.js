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
 * Where the download banner goes: 'game' | 'catalog' | null.
 *
 * Banner stays in-app; the host chip already opens the download URL.
 * Installed opens the library entry. Not installed opens Browse when the
 * entry is known. Otherwise falls back to the library entry when there is
 * one (local titles have no Browse entry). Else nowhere.
 */
export function downloadBannerTarget({ game = null, catalogRef = null } = {}) {
  if (game && isInstalledGame(game)) return 'game'
  if (catalogRef) return 'catalog'
  if (game) return 'game'
  return null
}

/**
 * Which catalog entry this download belongs to.
 * Uses the saved reference first, then the game's Atlas id if needed.
 * Returns null if neither is available.
 */
export function downloadCatalogRef(item, game) {
  if (item?.catalogRef) return item.catalogRef
  const atlas = game?.atlas_id ?? game?.atlasId
  if (atlas) return `catalog:${atlas}`
  return null
}
