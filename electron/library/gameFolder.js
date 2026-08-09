'use strict'

// Opening a game folder is NOT the same question as launching a version, and
// this exists so the two stop sharing an answer.
//
// Both used to go through getTrustedVersion, which asks "is this version
// installed". That is the right question for launch and the wrong one here:
//
//   launch  needs an executable on disk, OR a Steam appid, OR a GOG id. The
//           handoff branches in launchGame never touch game_path, so a Steam
//           version launches whether or not the folder is where we recorded it.
//   folder  needs one thing: a directory on disk.
//
// Sharing the gate had two costs. Steam and GOG versions carry no exec_path by
// design, so they were judged by install rules written around executables --
// and those rules disagree between getGames, getGame and getVersionForRecord,
// the last of which joins only steam_mappings and so has no GOG branch at all.
// And the library grid is fetched with skipPathValidation, where "installed"
// means "a path is recorded", so a version whose folder had been moved was
// offered by the renderer and refused here.
//
// Nothing below reads source, source_app_id, in_place or exec_path. Whatever
// external launcher owns the version, the folder is just a folder.
//
// Dependencies are injected rather than required so this can be exercised
// without an Electron runtime; main.js supplies the real ones.
function createGameFolderOpener({ getVersionById, getVersionForRecord, shell, fs }) {
  // Resolves the row the caller is pointing at. versionId is exact; the version
  // string is kept for callers that predate it and is ambiguous exactly where
  // the database holds duplicate or blank version labels, which is why nothing
  // new sends it.
  const resolveVersion = async ({ recordId, versionId, version }) => {
    if (Number.isFinite(Number(versionId)) && Number(versionId) > 0) {
      // record_id is in the WHERE clause, not just carried alongside it.
      // version_id is a bare rowid -- versions has no INTEGER PRIMARY KEY
      // (electron/db/index.js) -- and SQLite does not guarantee rowid stability
      // across the VACUUM that the client audit runs. Scoping the lookup means
      // a rotated id resolves to nothing rather than to another game's folder.
      return await getVersionById(recordId, Number(versionId))
    }
    if (version !== undefined && version !== null && String(version) !== '') {
      return await getVersionForRecord(recordId, version)
    }
    return null
  }

  return async function openGameFolderForVersion({ recordId, versionId, version } = {}) {
    if (!recordId) return { success: false, error: 'No game was specified.' }

    let selectedVersion
    try {
      selectedVersion = await resolveVersion({ recordId, versionId, version })
    } catch (err) {
      return { success: false, error: err.message || String(err) }
    }
    if (!selectedVersion) {
      return {
        success: false,
        error: 'That version is no longer in the library. Refresh and try again.',
      }
    }

    const folderPath = selectedVersion.game_path || ''
    if (!folderPath) {
      return {
        success: false,
        error: `"${selectedVersion.version || 'This version'}" has no folder recorded, so there is nothing to open.`,
      }
    }

    const stat = await fs.promises.stat(folderPath).catch(() => null)
    if (!stat) {
      return {
        success: false,
        error: `The folder for "${selectedVersion.version || 'this version'}" is not there any more:\n\n${folderPath}\n\nIt may have been moved, deleted, or be on a drive that is not connected.`,
      }
    }
    if (!stat.isDirectory()) {
      return { success: false, error: `That path is a file, not a folder:\n\n${folderPath}` }
    }

    // shell.openPath RESOLVES with an error string rather than rejecting, so
    // discarding the return value is how a folder that never opened reported
    // success. Both call sites used to do exactly that.
    const openError = await shell.openPath(folderPath)
    if (openError) return { success: false, error: openError }

    return { success: true, path: folderPath }
  }
}

module.exports = { createGameFolderOpener }
