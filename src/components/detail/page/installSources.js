// ── Where a game can be installed FROM ───────────────────────────────────────
//
// A title can have more than one route into the library: F95 mirrors, a Steam
// appid, a GOG store page. The INSTALL button used to pick one of those for the
// user and hide the rest -- `hasSteamInstall ? 'steam' : …` sat at the top of
// the priority chain in resolveActionBarRoutes, so any title with a Steam
// mapping lost its mirror picker entirely. Nothing said so. The button still
// read INSTALL (with a Steam glyph) and still did something, it just did
// something else, and the F95 build the user came for became unreachable from
// the page they were standing on.
//
// The list is computed here so it can be asserted. That is the same reason
// resolveActionBarRoutes exists at all, and the Steam takeover is a good
// argument for it: the rule was expressed twice, once inside that function and
// once as `steamInstallCta` in ActionBar's body, and only the second one drove
// the button's label. Two copies of one rule, and they did not have to agree.
//
// ── What counts as available ─────────────────────────────────────────────────
//
// Each source needs BOTH an id to act on and a handler wired to act with. A
// steam appid with no onSteamInstall is not an option, it is a mapping.
//
// Sources the user has removed from Metadata.sourceOrder are excluded. Someone
// who has taken Steam out of their sources has said they do not want Atlas
// treating this as a Steam game, and offering a Steam install anyway would be
// the same override this module exists to remove -- just in the other
// direction. An absent/unset order means "all of them", which is what
// normalizeSourceOrder does with null, and is the right default for a config
// key most people never touch.
//
// LewdCorner is not a source here even though it is one in Metadata.sourceOrder.
// UpdateModal fetches by `f95_id` and there is no LewdCorner download path yet,
// so listing it would be an option that cannot be taken.

/** Every source id this module knows how to install from, in fallback order. */
const KNOWN_SOURCES = Object.freeze(['f95', 'steam', 'gog'])

const SOURCE_META = Object.freeze({
  f95: {
    id: 'f95',
    label: 'F95Zone',
    icon: 'fas fa-download',
    description: 'Pick a build and mirror from the thread. Downloads through Atlas.',
  },
  steam: {
    id: 'steam',
    label: 'Steam',
    icon: 'fab fa-steam',
    description: 'Hands off to the Steam client, which downloads and installs it.',
  },
  gog: {
    id: 'gog',
    label: 'GOG',
    icon: 'gog',
    description: 'Opens the store page in your browser. Atlas cannot download this one.',
  },
})

/**
 * Parse Metadata.sourceOrder the way db/mediaSources.js normalizeSourceOrder
 * does, so the renderer and the main process agree on what "enabled" means.
 *
 * null/undefined -> every source. An empty STRING is a different thing from an
 * unset key: the user removed everything, and returning all sources for that
 * would ignore a deliberate choice.
 */
export function parseSourceOrder(raw) {
  if (raw === undefined || raw === null) return [...KNOWN_SOURCES]
  const list = Array.isArray(raw) ? raw : String(raw).split(',')
  const seen = new Set()
  const out = []
  for (const entry of list) {
    const id = String(entry || '').trim().toLowerCase()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/**
 * Which sources this game can actually be installed from, in the user's
 * configured preference order.
 *
 * Ordered by Metadata.sourceOrder rather than by a fixed list, because that key
 * already means "which of these do I prefer" everywhere else in the app --
 * media resolution reads it exactly that way. A user who put Steam first sees
 * Steam first, and the one-source shortcut below then picks what they would
 * have picked.
 *
 * @returns {Array<{id, label, icon, description}>}
 */
export function resolveInstallSources({
  hasMirrors = false,
  hasSteamInstall = false,
  gogStoreUrl = '',
  sourceOrder = null,
} = {}) {
  const available = {
    f95: Boolean(hasMirrors),
    steam: Boolean(hasSteamInstall),
    // GOG earns its place only when there is somewhere to send the user. There
    // is no gog:// install handoff, so without a store page the entry would be a
    // button that does nothing.
    gog: Boolean(String(gogStoreUrl || '').trim()),
  }

  const enabled = parseSourceOrder(sourceOrder)
  const out = []
  for (const id of enabled) {
    if (!available[id] || !SOURCE_META[id]) continue
    out.push(SOURCE_META[id])
  }
  // A source that is available but missing from the order is NOT added back.
  // That is the whole point of honouring the setting.
  return out
}

/**
 * What the INSTALL button should do, given the sources above.
 *
 *   0 sources -> 'localImport'  nothing to fetch; the manual panel is the only
 *                               route, which is the pre-existing behaviour for a
 *                               browse row with no mirrors
 *   1 source  -> that source    no dialog for a choice that is not one
 *   2+        -> 'picker'
 */
export function resolveInstallAction(sources = []) {
  if (sources.length === 0) return 'localImport'
  if (sources.length === 1) return sources[0].id
  return 'picker'
}

export { KNOWN_SOURCES, SOURCE_META }
