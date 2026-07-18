// Renderer mirror of electron/db/playstates.js. Main and renderer are separate
// bundles and can't share a module, so keep these two in sync when changing the
// set of states. This is the USER's play progress, separate from the
// developer/thread status (game.status: "Completed"/"Ongoing"/etc.).

export const PLAYSTATES = ['finished', 'played', 'dropped', 'on_hold', 'planned']

// Display metadata: label, a Font Awesome icon, and a CSS var for accenting.
// Icons stay within the FA set already used across the app.
export const PLAYSTATE_META = {
  finished: { label: 'Finished', icon: 'fas fa-flag-checkered', color: 'var(--color-success)' },
  played: { label: 'Played', icon: 'fas fa-play', color: 'var(--color-accent)' },
  dropped: { label: 'Dropped', icon: 'fas fa-ban', color: 'var(--color-danger)' },
  on_hold: { label: 'On Hold', icon: 'fas fa-pause', color: 'var(--color-warning)' },
  planned: { label: 'Planned', icon: 'fas fa-clock', color: 'var(--color-muted)' },
}

// Order shown in menus/pickers, with an explicit "clear" entry.
export const PLAYSTATE_OPTIONS = [
  { value: 'finished', ...PLAYSTATE_META.finished },
  { value: 'played', ...PLAYSTATE_META.played },
  { value: 'on_hold', ...PLAYSTATE_META.on_hold },
  { value: 'planned', ...PLAYSTATE_META.planned },
  { value: 'dropped', ...PLAYSTATE_META.dropped },
]

export const normalizePlaystate = (value) => {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw || raw === 'unplayed' || raw === 'none') return null
  const collapsed = raw.replace(/[\s-]+/g, '_')
  if (collapsed === 'onhold') return 'on_hold'
  return PLAYSTATES.includes(collapsed) ? collapsed : null
}

export const playstateLabel = (value) => {
  const s = normalizePlaystate(value)
  return s ? PLAYSTATE_META[s].label : ''
}

export const playstateMeta = (value) => {
  const s = normalizePlaystate(value)
  return s ? PLAYSTATE_META[s] : null
}

// Mirror of the main-process derivation so the renderer can show the effective
// title playstate optimistically without a round-trip.
export const derivePlaystateFromVersions = (versions = []) => {
  const states = (Array.isArray(versions) ? versions : [])
    .map((v) => normalizePlaystate(v?.playstate))
    .filter(Boolean)
  if (states.length === 0) return null
  const first = states[0]
  return states.every((s) => s === first) ? first : null
}

export const effectiveTitlePlaystate = (explicitPlaystate, versions = []) => {
  const explicit = normalizePlaystate(explicitPlaystate)
  if (explicit) return explicit
  return derivePlaystateFromVersions(versions)
}
