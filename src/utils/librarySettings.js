// ── Library config, read and written in one place ────────────────────────────
//
// Three screens now write config.Library: the settings page, and the two prompts
// the install flow raises when a setting it needs has never been answered
// (LibraryFolderModal, LibraryStructureModal).
//
// They share this module rather than each keeping their own copy of the
// read-modify-write. The read-modify-write is the reason: saveSettings takes the
// WHOLE config object, so every writer has to fetch the current one, splice its
// key into config.Library, and send the lot back. Three hand-written copies of
// that would be three chances to spread the Library object with a stale read, and
// the symptom of getting it wrong — an unrelated setting silently reverting —
// gives no clue where it came from.

/** Current config.Library, or an empty object if the config cannot be read. */
export async function getLibraryConfig() {
  try {
    const config = await window.electronAPI.getConfig()
    return config?.Library || {}
  } catch (err) {
    console.warn('Could not read library settings:', err?.message || err)
    return {}
  }
}

/**
 * Write one key under config.Library, leaving everything else as it is on disk.
 *
 * Re-reads immediately before writing rather than accepting a config the caller
 * already has. A modal can sit open for a while, and saving a snapshot taken when
 * it opened would roll back anything changed in the meantime.
 *
 * @returns {Promise<boolean>} whether the write went through.
 */
export async function saveLibrarySetting(key, value) {
  try {
    const config = await window.electronAPI.getConfig()
    await window.electronAPI.saveSettings({
      ...config,
      Library: { ...(config?.Library || {}), [key]: value },
    })
    return true
  } catch (err) {
    console.warn(`Could not save library setting "${key}":`, err?.message || err)
    return false
  }
}

/**
 * Write several keys under config.Library in ONE save.
 *
 * Not a loop over saveLibrarySetting: each of those does its own read, so two
 * back-to-back calls race and the second can overwrite the first with the config
 * it read before the first landed. LibraryStructureModal writes two keys at once
 * (the structure and the flag saying it was asked), which is exactly that case.
 */
export async function saveLibrarySettings(patch = {}) {
  try {
    const config = await window.electronAPI.getConfig()
    await window.electronAPI.saveSettings({
      ...config,
      Library: { ...(config?.Library || {}), ...patch },
    })
    return true
  } catch (err) {
    console.warn('Could not save library settings:', err?.message || err)
    return false
  }
}

/**
 * Open the OS folder picker for the games library and persist the result.
 *
 * The single picker for Library.gameFolder. The settings page and the install
 * prompt both call this one, because two pickers writing the same key drift —
 * one grows a validation rule or a default starting directory and the other does
 * not, and which behaviour you get depends on where you happened to be standing.
 *
 * @returns {Promise<string>} the chosen path, or '' if the user cancelled.
 */
export async function pickGameFolder() {
  const path = await window.electronAPI.selectDirectory()
  if (!path) return ''
  await saveLibrarySetting('gameFolder', path)
  return path
}
