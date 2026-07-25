'use strict'

// Single source of truth for the per-game user metadata overrides stored in
// game_metadata_overrides.
//
// Historically updateGame() wrote ALL of these columns on every save, using ''
// for any field the caller did not supply. Because the merge in versions.js is
// COALESCE(game_metadata_overrides.x, <source chain>), an '' override is NOT
// null and therefore WINS over every upstream source — permanently blanking
// fields the user never touched. The importer hit the same path with only five
// keys, so a plain import could write a full row of blanking overrides.
//
// The rules now are:
//   * only columns explicitly present in a payload are written,
//   * '' / whitespace means "clear this override" and is stored as SQL NULL,
//   * a row with no remaining overrides is deleted outright, so the presence of
//     a row is a meaningful "this title has custom data" signal.
//
// INHERITED_SQL mirrors, for each field, the exact source chain used by the
// merge queries in versions.js with the override term removed. That gives us
// the value a field would fall back to if its override were cleared, which
// powers both the "custom vs inherited" UI and the redundant-override sweep.
// If you change a COALESCE chain in versions.js, change it here too.

const OVERRIDE_FIELDS = [
  { column: 'os',             label: 'Platform',     formKey: 'platform' },
  { column: 'publisher',      label: 'Publisher',    formKey: 'publisher' },
  { column: 'release_date',   label: 'Release Date', formKey: 'release_date' },
  { column: 'status',         label: 'Status',       formKey: 'status' },
  { column: 'category',       label: 'Category',     formKey: 'category' },
  { column: 'latest_version', label: 'Last Update',  formKey: 'latest_version' },
  { column: 'censored',       label: 'Censored',     formKey: 'censored' },
  { column: 'language',       label: 'Language',     formKey: 'language' },
  { column: 'translations',   label: 'Translations', formKey: 'translations' },
  { column: 'genre',          label: 'Genre',        formKey: 'genre' },
  { column: 'voice',          label: 'Voice',        formKey: 'voice' },
  { column: 'rating',         label: 'Rating',       formKey: 'rating' },
  { column: 'overview',       label: 'Description',  formKey: 'description' },
]

const OVERRIDE_COLUMNS = OVERRIDE_FIELDS.map((f) => f.column)

// Accepted aliases in an updateGame payload, mapped to the override column.
// The renderer sends camelCase for a couple of these; the importer and older
// call sites send snake_case.
const OVERRIDE_ALIASES = {
  latestVersion: 'latest_version',
  releaseDate: 'release_date',
}

// Source chains, override term removed. Kept in sync with versions.js.
const INHERITED_SQL = {
  os:             `COALESCE(NULLIF(atlas_data.os, ''), NULLIF(steam_data.os, ''), gog_data.os)`,
  publisher:      `COALESCE(NULLIF(steam_data.publisher, ''), gog_data.publisher)`,
  release_date:   `COALESCE(atlas_data.release_date, NULLIF(gog_data.release_date, ''))`,
  status:         `atlas_data.status`,
  category:       `COALESCE(NULLIF(atlas_data.category, ''), NULLIF(steam_data.category, ''), gog_data.category)`,
  latest_version: `atlas_data.version`,
  censored:       `COALESCE(NULLIF(atlas_data.censored, ''), NULLIF(steam_data.censored, ''), gog_data.censored)`,
  language:       `COALESCE(NULLIF(atlas_data.language, ''), NULLIF(steam_data.language, ''), gog_data.language)`,
  translations:   `COALESCE(NULLIF(atlas_data.translations, ''), NULLIF(steam_data.translations, ''), gog_data.translations)`,
  genre:          `COALESCE(NULLIF(atlas_data.genre, ''), NULLIF(steam_data.genre, ''), gog_data.genre)`,
  voice:          `COALESCE(NULLIF(atlas_data.voice, ''), NULLIF(steam_data.voice, ''), gog_data.voice)`,
  rating:         `f95_zone_data.rating`,
  overview:       `COALESCE(NULLIF(games.description, ''), NULLIF(atlas_data.overview, ''), NULLIF(steam_data.overview, ''), gog_data.overview)`,
}

// The join chain the expressions above depend on. Mirrors versions.js; banner
// and LewdCorner joins are omitted because no override field reads from them.
const INHERITED_JOINS = `
  LEFT JOIN atlas_mappings ON games.record_id = atlas_mappings.record_id
  LEFT JOIN steam_mappings ON games.record_id = steam_mappings.record_id
  LEFT JOIN atlas_data ON atlas_mappings.atlas_id = atlas_data.atlas_id
  LEFT JOIN f95_zone_data ON atlas_mappings.atlas_id = f95_zone_data.atlas_id
  LEFT JOIN steam_data ON steam_mappings.steam_id = steam_data.steam_id
    OR (steam_mappings.steam_id IS NULL AND atlas_mappings.atlas_id IS NOT NULL AND steam_data.atlas_id = atlas_mappings.atlas_id)
  LEFT JOIN gog_mappings ON games.record_id = gog_mappings.record_id
  LEFT JOIN gog_data ON gog_mappings.gog_id = gog_data.gog_id
    OR (gog_mappings.gog_id IS NULL AND atlas_mappings.atlas_id IS NOT NULL AND gog_data.atlas_id = atlas_mappings.atlas_id)
`

// SELECT list of inherited values, aliased inherited_<column>.
const inheritedSelect = () =>
  OVERRIDE_COLUMNS.map((col) => `${INHERITED_SQL[col]} AS inherited_${col}`).join(',\n        ')

// Normalizes an incoming override value.
//   undefined            -> undefined (field absent; do not touch the column)
//   null / '' / '   '    -> null      (clear the override, fall back to source)
//   anything else        -> trimmed string
const normalizeOverrideValue = (value) => {
  if (value === undefined) return undefined
  if (value === null) return null
  const str = String(value).trim()
  return str === '' ? null : str
}

// Pulls the override columns out of an arbitrary updateGame payload. Only keys
// actually present on the object are returned, so callers that supply a partial
// payload (the importer, or the properties window sending just the fields the
// user edited) can never clobber columns they did not mention.
const extractOverridePatch = (payload = {}) => {
  const patch = {}
  for (const [key, value] of Object.entries(payload)) {
    const column = OVERRIDE_ALIASES[key] || key
    if (!OVERRIDE_COLUMNS.includes(column)) continue
    // Prefer an explicit snake_case key over an alias if both are present.
    if (column !== key && Object.prototype.hasOwnProperty.call(payload, column)) continue
    patch[column] = normalizeOverrideValue(value)
  }
  return patch
}

// True when two values are equivalent for override purposes. Comparison is
// trimmed and case-insensitive so "Completed" and "completed " count as the
// same value as far as redundancy is concerned.
const sameValue = (a, b) => {
  const norm = (v) => (v === null || v === undefined ? '' : String(v).trim().toLowerCase())
  return norm(a) === norm(b)
}

module.exports = {
  OVERRIDE_FIELDS,
  OVERRIDE_COLUMNS,
  OVERRIDE_ALIASES,
  INHERITED_SQL,
  INHERITED_JOINS,
  inheritedSelect,
  normalizeOverrideValue,
  extractOverridePatch,
  sameValue,
}
