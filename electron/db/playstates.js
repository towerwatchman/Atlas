'use strict'

// Canonical user playstate values. Kept deliberately small and lowercase so
// they round-trip cleanly through SQLite and the config/IPC layers. This is the
// USER's play progress and is entirely separate from atlas_data.status (the
// developer/thread status like "Completed"/"Ongoing"/"Abandoned").
//
// NOTE: a mirror of this list lives in src/utils/playstates.js for the renderer
// (main and renderer are separate bundles and can't share a module). Keep the
// two in sync when adding/removing states.
const PLAYSTATES = ['finished', 'played', 'dropped', 'on_hold', 'planned']

// null / '' / 'unplayed' all mean "no playstate set".
const PLAYSTATE_NONE = null

const PLAYSTATE_SET = new Set(PLAYSTATES)

// Normalize any incoming value to a valid playstate or null. Accepts a few
// friendly aliases so callers don't have to be strict about spacing/casing.
const normalizePlaystate = (value) => {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw || raw === 'unplayed' || raw === 'none') return PLAYSTATE_NONE
  const collapsed = raw.replace(/[\s-]+/g, '_')
  if (collapsed === 'onhold' || collapsed === 'on_hold') return 'on_hold'
  return PLAYSTATE_SET.has(collapsed) ? collapsed : PLAYSTATE_NONE
}

// Derive a title-level playstate from its versions when the title has no
// explicit override. Rule: if every version shares the same playstate, the
// title inherits it; otherwise the title has no derived playstate. "finished"
// only wins for the whole title when ALL versions are finished (matching the
// issue's "when all versions is flagged then it should apply to the title").
const derivePlaystateFromVersions = (versions = []) => {
  const states = (Array.isArray(versions) ? versions : [])
    .map((v) => normalizePlaystate(v?.playstate))
    .filter((s) => s !== PLAYSTATE_NONE)
  if (states.length === 0) return PLAYSTATE_NONE
  const first = states[0]
  return states.every((s) => s === first) ? first : PLAYSTATE_NONE
}

// The effective title playstate: an explicit override wins; otherwise fall back
// to the value derived from the versions.
const effectiveTitlePlaystate = (explicitPlaystate, versions = []) => {
  const explicit = normalizePlaystate(explicitPlaystate)
  if (explicit !== PLAYSTATE_NONE) return explicit
  return derivePlaystateFromVersions(versions)
}

module.exports = {
  PLAYSTATES,
  PLAYSTATE_NONE,
  normalizePlaystate,
  derivePlaystateFromVersions,
  effectiveTitlePlaystate,
}
