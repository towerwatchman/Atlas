'use strict'

// ── Searchable fields (CommonJS mirror) ─────────────────────────────────────
//
// GENERATED from src/utils/searchFields.js by scripts/sync-search-fields.js.
// Do not edit by hand — edit the ESM file and re-run `npm run sync:search-fields`.
//
// It exists because main is CommonJS and the renderer is an ESM bundle, so the
// two cannot share a module (same reason electron/db/ratingCategories.js is
// mirrored by src/utils/ratingCategories.js). tests/search-fields.test.js
// asserts the two stay identical, so a stale mirror fails the suite rather than
// silently making Browse search different columns from Library search.

const SEARCH_FIELDS = [
  {
    id: 'title',
    label: 'Title',
    group: 'Basics',
    indexColumns: ['title', 'short_name'],
    unionColumns: ['catalog.title', 'catalog.short_name'],
  },
  {
    id: 'creator',
    label: 'Creator',
    group: 'Basics',
    indexColumns: ['creator'],
    unionColumns: ['catalog.creator'],
  },
  {
    id: 'id',
    label: 'Any ID',
    group: 'IDs',
    indexColumns: ['atlas_id', 'record_id', 'f95_id', 'lc_id', 'steam_id', 'gog_id'],
    unionColumns: [
      'catalog.atlas_id', 'catalog.record_id', 'catalog.f95_id',
      'catalog.lc_id', 'catalog.steam_id', 'catalog.gog_id',
    ],
  },
  {
    id: 'atlasId',
    label: 'Atlas ID',
    group: 'IDs',
    indexColumns: ['atlas_id', 'record_id'],
    unionColumns: ['catalog.atlas_id', 'catalog.record_id'],
  },
  {
    id: 'f95Id',
    label: 'F95 ID',
    group: 'IDs',
    indexColumns: ['f95_id'],
    unionColumns: ['catalog.f95_id'],
  },
  {
    id: 'lcId',
    label: 'LewdCorner ID',
    group: 'IDs',
    indexColumns: ['lc_id'],
    unionColumns: ['catalog.lc_id'],
  },
  {
    id: 'steamId',
    label: 'Steam ID',
    group: 'IDs',
    indexColumns: ['steam_id'],
    unionColumns: ['catalog.steam_id'],
  },
  {
    id: 'gogId',
    label: 'GOG ID',
    group: 'IDs',
    indexColumns: ['gog_id'],
    unionColumns: ['catalog.gog_id'],
  },
  {
    id: 'tags',
    label: 'Tags',
    group: 'Metadata',
    // tags_text concatenates all four tag sources at index time; the union has
    // to OR across them itself.
    indexColumns: ['tags_text'],
    unionColumns: [
      'catalog.f95_tags', 'catalog.tags',
      'catalog.lewdcornerTags', 'catalog.lewdcornerPrefixes',
    ],
  },
  {
    id: 'engine',
    label: 'Engine',
    group: 'Metadata',
    indexColumns: ['engine'],
    unionColumns: ['catalog.engine'],
  },
  {
    id: 'status',
    label: 'Status',
    group: 'Metadata',
    indexColumns: ['status'],
    unionColumns: ['catalog.status'],
  },
  {
    id: 'category',
    label: 'Category',
    group: 'Metadata',
    indexColumns: ['category'],
    unionColumns: ['catalog.category'],
  },
  {
    id: 'language',
    label: 'Language',
    group: 'Metadata',
    indexColumns: ['language'],
    unionColumns: ['catalog.language'],
  },
  {
    id: 'url',
    label: 'Source URL',
    group: 'Other',
    indexColumns: ['site_url', 'source'],
    unionColumns: ['catalog.source', 'catalog.siteUrl', 'catalog.lewdCornerSiteUrl'],
  },
]

const SEARCH_FIELD_IDS = SEARCH_FIELDS.map((field) => field.id)

const SEARCH_FIELD_GROUPS = ['Basics', 'IDs', 'Metadata', 'Other']

// The out-of-the-box set. Note this is NOT what the old `type: 'all'` searched —
// that covered title/creator/tags/engine/status/category but no ids at all, so a
// record id or thread id only matched via an `id:` prefix. Ids are in by default
// now and the metadata fields are opt-in.
const DEFAULT_SEARCH_FIELD_IDS = ['title', 'creator', 'id']

// `prefix:` shorthand typed into the box. Kept working exactly as before, with
// the field ids as the new target. `url:` is deliberately absent — it does not
// mean "search the url column", it means "filter to this source", which is a
// different operation handled separately (see parseSearchQuery).
const SEARCH_PREFIX_FIELDS = {
  id: ['id'],
  atlas: ['atlasId'],
  f95: ['f95Id'],
  lc: ['lcId'],
  lewdcorner: ['lcId'],
  steam: ['steamId'],
  gog: ['gogId'],
  title: ['title'],
  name: ['title'],
  creator: ['creator'],
  dev: ['creator'],
  tag: ['tags'],
  tags: ['tags'],
  engine: ['engine'],
  status: ['status'],
  category: ['category'],
  language: ['language'],
  lang: ['language'],
}

// Legacy `filters.type` values, which are still on disk in saved_filters.json
// and may arrive from an older renderer. `all` maps to null meaning "use the
// user's configured default set" — that is the deliberate behaviour change: the
// catch-all is now whatever the user configured, not a fixed column list.
const LEGACY_SEARCH_TYPE_FIELDS = {
  all: null,
  title: ['title'],
  creator: ['creator'],
  atlasId: ['atlasId'],
  f95Id: ['f95Id'],
  lewdcornerId: ['lcId'],
  steamId: ['steamId'],
  anyId: ['id'],
  source: ['url'],
}

const fieldById = new Map(SEARCH_FIELDS.map((field) => [field.id, field]))

const getSearchField = (id) => fieldById.get(String(id)) || null

// Drops unknown ids, de-dupes, and preserves SEARCH_FIELDS order so two
// selections with the same members always serialize identically (which is what
// lets the config value and the "is this the default set?" check be compared as
// plain strings).
const normalizeSearchFieldIds = (value, fallback = DEFAULT_SEARCH_FIELD_IDS) => {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? '').split(',')
  const wanted = new Set(raw.map((item) => String(item ?? '').trim()).filter(Boolean))
  const ordered = SEARCH_FIELD_IDS.filter((id) => wanted.has(id))
  if (ordered.length > 0) return ordered
  // An empty or fully-unknown selection would silently match nothing, which
  // looks exactly like a broken search box. Fall back rather than do that.
  return [...fallback]
}

const serializeSearchFieldIds = (ids) => normalizeSearchFieldIds(ids).join(',')

const isDefaultSearchFieldSet = (ids, defaults = DEFAULT_SEARCH_FIELD_IDS) =>
  serializeSearchFieldIds(ids) === serializeSearchFieldIds(defaults)

// Short label for the scope button, e.g. "Title, Creator, Any ID". Collapses to
// "All fields" when everything is selected so the button doesn't overflow.
const describeSearchFieldIds = (ids) => {
  const normalized = normalizeSearchFieldIds(ids)
  if (normalized.length === SEARCH_FIELD_IDS.length) return 'All fields'
  return normalized.map((id) => getSearchField(id)?.label || id).join(', ')
}

const indexColumnsForSearchFieldIds = (ids) => {
  const out = []
  for (const id of normalizeSearchFieldIds(ids)) {
    for (const column of getSearchField(id)?.indexColumns || []) {
      if (!out.includes(column)) out.push(column)
    }
  }
  return out
}

const unionColumnsForSearchFieldIds = (ids) => {
  const out = []
  for (const id of normalizeSearchFieldIds(ids)) {
    for (const column of getSearchField(id)?.unionColumns || []) {
      if (!out.includes(column)) out.push(column)
    }
  }
  return out
}

module.exports = {
  SEARCH_FIELDS,
  SEARCH_FIELD_IDS,
  SEARCH_FIELD_GROUPS,
  DEFAULT_SEARCH_FIELD_IDS,
  SEARCH_PREFIX_FIELDS,
  LEGACY_SEARCH_TYPE_FIELDS,
  getSearchField,
  normalizeSearchFieldIds,
  serializeSearchFieldIds,
  isDefaultSearchFieldSet,
  describeSearchFieldIds,
  indexColumnsForSearchFieldIds,
  unionColumnsForSearchFieldIds,
}
