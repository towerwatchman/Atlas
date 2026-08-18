import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  SEARCH_FIELDS, SEARCH_FIELD_IDS, SEARCH_FIELD_GROUPS, DEFAULT_SEARCH_FIELD_IDS,
  LEGACY_SEARCH_TYPE_FIELDS, SEARCH_PREFIX_FIELDS,
  describeSearchFieldIds, indexColumnsForSearchFieldIds, normalizeSearchFieldIds,
  serializeSearchFieldIds, unionColumnsForSearchFieldIds,
} from '../src/utils/searchFields.js'
import {
  filterGamesWithState, normalizeFilterState, parseSearchQuery,
  resolveSearchFieldIds, setDefaultSearchFieldIds,
} from '../src/hooks/useFilters.js'

const mirror = require('../electron/db/searchFields.js')
const { generate, TARGET } = require('../scripts/sync-search-fields.js')

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')

// ── Registry / mirror ───────────────────────────────────────────────────────

// The CommonJS copy is generated, so a stale one means main and the renderer
// search different columns — Browse quietly disagreeing with Library.
test('the CommonJS mirror matches what the generator would produce', () => {
  expect(fs.readFileSync(TARGET, 'utf8').replace(/\r\n/g, '\n')).toBe(
    generate().replace(/\r\n/g, '\n'),
  )
})

test('the mirror exposes the same field definitions', () => {
  expect(mirror.SEARCH_FIELD_IDS).toEqual(SEARCH_FIELD_IDS)
  expect(mirror.DEFAULT_SEARCH_FIELD_IDS).toEqual(DEFAULT_SEARCH_FIELD_IDS)
  expect(mirror.SEARCH_FIELDS.map((f) => f.indexColumns)).toEqual(
    SEARCH_FIELDS.map((f) => f.indexColumns))
  expect(mirror.SEARCH_FIELDS.map((f) => f.unionColumns)).toEqual(
    SEARCH_FIELDS.map((f) => f.unionColumns))
})

test('the default is title, creator and any id', () => {
  expect(DEFAULT_SEARCH_FIELD_IDS).toEqual(['title', 'creator', 'id'])
})

test('every field declares a group that exists', () => {
  for (const field of SEARCH_FIELDS) {
    expect(SEARCH_FIELD_GROUPS).toContain(field.group)
    expect(field.indexColumns.length).toBeGreaterThan(0)
    expect(field.unionColumns.length).toBeGreaterThan(0)
  }
})

// A column name typo returns zero rows rather than raising, so it would look
// like "search is broken" with nothing in the logs. These check the names against
// the actual schema text.
test('every indexColumn is a real catalog_index column', () => {
  const source = read('electron', 'db', 'catalogIndex.js')
  const ddl = source.slice(
    source.indexOf('CREATE TABLE IF NOT EXISTS catalog_index'),
    source.indexOf('CREATE TABLE IF NOT EXISTS atlas_external_steam'),
  )
  const columns = new Set(
    [...ddl.matchAll(/^\s{5}(\w+)\s+(?:TEXT|INTEGER|REAL)/gm)].map((m) => m[1]))
  expect(columns.size).toBeGreaterThan(10)
  for (const column of indexColumnsForSearchFieldIds(SEARCH_FIELD_IDS)) {
    expect(columns, `catalog_index.${column}`).toContain(column)
  }
})

test('every unionColumn is selected by all four union branches', () => {
  const source = read('electron', 'db', 'versions.js')
  const region = source.slice(source.indexOf('const getCatalogGamesFromUnion'))
  for (const qualified of unionColumnsForSearchFieldIds(SEARCH_FIELD_IDS)) {
    const column = qualified.replace(/^catalog\./, '')
    // Either `... as column,` or an unaliased `table.column,` — the atlas branch
    // uses the latter for short_name and status, and SQLite names the result
    // column identically.
    const aliased = new RegExp(`\\b(?:as|AS)\\s+${column}\\b`, 'g')
    const bare = new RegExp(`\\.${column},`, 'g')
    const count = (region.match(aliased) || []).length + (region.match(bare) || []).length
    expect(count, `${qualified} appears in ${count} branches`).toBeGreaterThanOrEqual(4)
  }
})

// ── normalizeSearchFieldIds ─────────────────────────────────────────────────

test('unknown ids are dropped and order follows the registry', () => {
  expect(normalizeSearchFieldIds(['id', 'nonsense', 'title'])).toEqual(['title', 'id'])
  expect(serializeSearchFieldIds(['id', 'title'])).toBe('title,id')
})

test('an empty or fully-unknown selection falls back rather than matching nothing', () => {
  expect(normalizeSearchFieldIds([])).toEqual(DEFAULT_SEARCH_FIELD_IDS)
  expect(normalizeSearchFieldIds(['bogus'])).toEqual(DEFAULT_SEARCH_FIELD_IDS)
  expect(normalizeSearchFieldIds('', ['title'])).toEqual(['title'])
})

test('a comma string is accepted, since that is how the config stores it', () => {
  expect(normalizeSearchFieldIds('title,tags')).toEqual(['title', 'tags'])
})

test('the label collapses when everything is selected', () => {
  expect(describeSearchFieldIds(['title', 'creator', 'id'])).toBe('Title, Creator, Any ID')
  expect(describeSearchFieldIds(SEARCH_FIELD_IDS)).toBe('All fields')
})

// ── Prefixes and legacy migration ───────────────────────────────────────────

test('prefixes override the selected fields for one query', () => {
  expect(parseSearchQuery('f95: 12345', ['title'])).toEqual({
    fields: ['f95Id'], query: '12345', urlSource: null,
  })
  expect(parseSearchQuery('id:99', ['title']).fields).toEqual(['id'])
  expect(parseSearchQuery('tag:ntr', ['title']).fields).toEqual(['tags'])
})

// The prefix pattern was /^([a-z]+):/ , which cannot match the digits in "f95" —
// so `f95:` silently fell through to a literal text search in all three search
// paths. It is the one prefix most likely to be reached for on this app.
test('a prefix containing digits is recognised', () => {
  expect(parseSearchQuery('f95:12345', ['title']).fields).toEqual(['f95Id'])
  expect(parseSearchQuery('f95:12345', ['title']).query).toBe('12345')
  for (const source of [
    read('src', 'hooks', 'useFilters.js'),
    read('electron', 'db', 'catalogIndex.js'),
    read('electron', 'db', 'versions.js'),
  ]) {
    // Not asserting the absence of the old pattern: useFilters.js quotes it in
    // a comment explaining the fix.
    expect(source).toContain('[a-z][a-z0-9]*')
  }
})

// `url:` filters to a source rather than searching a url column — it always has,
// and the two backends and the JS filter already disagreed about it.
test('url: still selects a source instead of overriding fields', () => {
  const parsed = parseSearchQuery('url:steam', ['title'])
  expect(parsed.urlSource).toBe('steam')
  expect(parsed.fields).toEqual(['title'])
})

// ── pasted URLs route to the matching ID field ──────────────────────────────

// Pasting a thread URL used to match against the indexed site_url, which is
// incomplete -- Steam URLs are not indexed at all, LewdCorner mixes slugged and
// bare forms. The ID is pulled out of the URL instead.
test('a known thread URL overrides fields to the site id', () => {
  expect(parseSearchQuery('https://f95zone.to/threads/slug.310615/', ['title']))
    .toEqual({ fields: ['f95Id'], query: '310615', urlSource: null })
  expect(parseSearchQuery('https://lewdcorner.com/threads/slug.5913/', ['title']))
    .toEqual({ fields: ['lcId'], query: '5913', urlSource: null })
  expect(parseSearchQuery('https://store.steampowered.com/app/4585540/Slug/', ['title']))
    .toEqual({ fields: ['steamId'], query: '4585540', urlSource: null })
})

// Non-slug and protocol-less forms must also route.
test('URL extraction works without slug, https, or www', () => {
  expect(parseSearchQuery('f95zone.to/threads/310615/', ['title']))
    .toEqual({ fields: ['f95Id'], query: '310615', urlSource: null })
  expect(parseSearchQuery('lewdcorner.com/threads/5913/', ['title']))
    .toEqual({ fields: ['lcId'], query: '5913', urlSource: null })
  expect(parseSearchQuery('store.steampowered.com/app/4585540/', ['title']))
    .toEqual({ fields: ['steamId'], query: '4585540', urlSource: null })
})

// The URL scheme parses as a prefix (`https:`), and a slug can contain one too.
// Neither may divert the URL away from ID routing.
test('a URL is not parsed as a prefix', () => {
  expect(parseSearchQuery('https://f95zone.to/threads/f95-is-awesome.123/', ['title']))
    .toEqual({ fields: ['f95Id'], query: '123', urlSource: null })
})

// An EXPLICIT prefix wins over URL extraction. The user said which field they
// meant; a URL in the argument must not silently override it. Ordering these
// the other way round makes `url:` unreachable for the three known domains.
test('an explicit prefix is not overridden by a URL in its argument', () => {
  const url = parseSearchQuery('url: https://f95zone.to/threads/slug.123/', ['title'])
  expect(url.fields).toEqual(['title'])
  expect(url.query).toBe('https://f95zone.to/threads/slug.123/')

  const title = parseSearchQuery('title: https://f95zone.to/threads/slug.123/', ['creator'])
  expect(title.fields).toEqual(['title'])
  expect(title.query).toBe('https://f95zone.to/threads/slug.123/')

  const steam = parseSearchQuery('steam: 4585540', ['title'])
  expect(steam.fields).toEqual(['steamId'])
  expect(steam.query).toBe('4585540')
})

// A title that happens to contain a URL is still a title search.
test('a URL embedded in longer text does not become an ID search', () => {
  expect(parseSearchQuery('Half-Life 2 store.steampowered.com/app/220/', ['title']))
    .toEqual({ fields: ['title'], query: 'Half-Life 2 store.steampowered.com/app/220/', urlSource: null })
})

// ── all three search paths must route URLs the same way ─────────────────────

// Library (catalog_index), Browse (union) and the renderer's JS filter each
// resolve search fields independently. If only one learns about URL routing,
// the same pasted link returns different rows depending on the view. These read
// the two main-process files as text -- neither buildIndexWhere nor
// getCatalogGamesFromUnion is exported.
// buildIndexWhere IS exported, so Library's routing is asserted by calling it
// rather than by reading the file. The emitted LIKE params are the observable:
// a routed URL searches for the bare ID, an unrouted one for the whole string.
test('the catalog_index path searches the bare id for a pasted URL', () => {
  const { buildIndexWhere } = require('../electron/db/catalogIndex.js')
  const paramsFor = (text) => buildIndexWhere({ text, fields: ['title'] }, {}).params

  expect(paramsFor('https://f95zone.to/threads/slug.310615/')).toEqual(['%310615%'])
  expect(paramsFor('https://lewdcorner.com/threads/slug.5913/')).toEqual(['%5913%'])
  // A steamId search also probes atlas_external_steam, so the id is bound twice
  // -- once for ci.steam_id and once for the EXISTS. Both must be the extracted
  // appid and nothing else.
  expect(paramsFor('store.steampowered.com/app/4585540/')).toEqual(['%4585540%', '%4585540%'])
})

// The main-process paths reassign `text` inside the prefix branch, so without an
// explicit ordering guard the URL left in a prefix's argument would override the
// field the user actually asked for.
test('the catalog_index path lets an explicit prefix beat a URL in its argument', () => {
  const { buildIndexWhere } = require('../electron/db/catalogIndex.js')
  const params = buildIndexWhere(
    { text: 'title: https://f95zone.to/threads/slug.123/', fields: ['creator'] }, {}).params
  // Searching the whole URL text, not the extracted "123".
  expect(params.every((p) => p.includes('f95zone.to'))).toBe(true)
  expect(params).not.toContain('%123%')
})

test('the catalog_index path does not route a URL embedded in longer text', () => {
  const { buildIndexWhere } = require('../electron/db/catalogIndex.js')
  const params = buildIndexWhere(
    { text: 'Half-Life 2 store.steampowered.com/app/220/', fields: ['title'] }, {}).params
  expect(params).not.toEqual(['%220%'])
  expect(params.some((p) => p.includes('half-life'))).toBe(true)
})

// getCatalogGamesFromUnion is not exported, so Browse keeps a text guard. It
// must route URLs identically to Library or the same paste returns different
// rows in the two views.
test('the union path routes URLs through the shared extractor', () => {
  const source = read('electron', 'db', 'versions.js')
  expect(source).toContain("require('./urlIdExtractor')")
  expect(source).toContain('extractUrlId(searchText)')
  expect(source).toContain("prefixedSearch && SEARCH_PREFIX_FIELDS[prefixedSearch[1].toLowerCase()]")
})

// A title with a colon must not be swallowed as an unknown prefix.
test('an unrecognised prefix is treated as literal text', () => {
  expect(parseSearchQuery('Ep 2: Reunion', ['title'])).toEqual({
    fields: ['title'], query: 'Ep 2: Reunion', urlSource: null,
  })
})

test('legacy filters.type values still resolve', () => {
  expect(normalizeFilterState({ type: 'anyId' }).searchFields).toEqual(['id'])
  expect(normalizeFilterState({ type: 'lewdcornerId' }).searchFields).toEqual(['lcId'])
  expect(normalizeFilterState({ type: 'title' }).searchFields).toEqual(['title'])
})

// The deliberate behaviour change: the catch-all is now whatever the user
// configured, not the old fixed title/creator/tags/engine/status/category list.
test("type 'all' defers to the configured default", () => {
  expect(normalizeFilterState({ type: 'all' }).searchFields).toEqual([])
  setDefaultSearchFieldIds(['title', 'tags'])
  try {
    expect(resolveSearchFieldIds({ searchFields: [] })).toEqual(['title', 'tags'])
    // An explicit selection still wins over the default.
    expect(resolveSearchFieldIds({ searchFields: ['creator'] })).toEqual(['creator'])
  } finally {
    setDefaultSearchFieldIds(DEFAULT_SEARCH_FIELD_IDS)
  }
})

test('an explicit selection survives normalization', () => {
  expect(normalizeFilterState({ searchFields: ['tags', 'title'] }).searchFields)
    .toEqual(['title', 'tags'])
})

// ── Matching ────────────────────────────────────────────────────────────────

const game = (over = {}) => ({
  record_id: 1, title: 'Deep Space', creator: 'Nebula Games',
  f95_tags: 'sci-fi, ntr', engine: "Ren'Py", status: 'Completed',
  f95_id: '54321', steam_id: '620', ...over,
})

const search = (text, searchFields, games) =>
  filterGamesWithState(games, { text, searchFields, installState: 'all', includeUninstalled: true })
    .map((g) => g.title)

test('the default set matches title, creator and ids but not tags', () => {
  const games = [
    game(),
    // Ids explicitly cleared: `game()` spreads over a base that carries them, so
    // without this the second row inherits 54321 and the id assertion below
    // passes for the wrong reason.
    game({ record_id: 2, title: 'Other', creator: 'X', f95_tags: 'sci-fi', f95_id: '', steam_id: '' }),
  ]
  expect(search('nebula', DEFAULT_SEARCH_FIELD_IDS, games)).toEqual(['Deep Space'])
  expect(search('54321', DEFAULT_SEARCH_FIELD_IDS, games)).toEqual(['Deep Space'])
  // sci-fi is a tag on both, and tags are not in the default set.
  expect(search('sci-fi', DEFAULT_SEARCH_FIELD_IDS, games)).toEqual([])
  expect(search('sci-fi', ['tags'], games)).toEqual(['Deep Space', 'Other'])
})

test('adding a field widens the search without a prefix', () => {
  const games = [game()]
  expect(search('completed', DEFAULT_SEARCH_FIELD_IDS, games)).toEqual([])
  expect(search('completed', [...DEFAULT_SEARCH_FIELD_IDS, 'status'], games)).toEqual(['Deep Space'])
})

// AND across terms, OR across fields.
test('multiple terms must all match, but may match different fields', () => {
  const games = [game(), game({ record_id: 2, title: 'Deep Water', creator: 'Other' })]
  expect(search('deep nebula', DEFAULT_SEARCH_FIELD_IDS, games)).toEqual(['Deep Space'])
  expect(search('deep missing', DEFAULT_SEARCH_FIELD_IDS, games)).toEqual([])
})

// The old searchableText joined nine fields with spaces, so a term spanning a
// boundary matched. Per-field values make the OR explicit and drop that.
// Each selected field is matched independently. This is not guarding a bug the
// old concatenated blob had — terms are whitespace-split, so no term could span
// its join — it pins the OR down as behaviour rather than a side effect of how
// the haystack happened to be built.
test('each selected field is matched independently', () => {
  const games = [
    game({ record_id: 1, title: 'Alpha', creator: 'Zeta', f95_id: '', steam_id: '' }),
    game({ record_id: 2, title: 'Omega', creator: 'Beta', f95_id: '', steam_id: '' }),
  ]
  // A term matches if ANY selected field contains it, whichever field that is.
  expect(search('alpha', ['title', 'creator'], games)).toEqual(['Alpha'])
  expect(search('beta', ['title', 'creator'], games)).toEqual(['Omega'])
  // Narrowing the scope drops the match that came from the excluded field.
  expect(search('beta', ['title'], games)).toEqual([])
})

// Negatives are scoped to the SELECTED fields now. Previously they always
// consulted a fixed blob, so `title:` plus a negative term silently read tags.
test('negative terms exclude on the selected fields only', () => {
  const games = [game(), game({ record_id: 2, title: 'Clean Game', f95_tags: 'sci-fi' })]
  expect(search('-ntr', ['tags'], games)).toEqual(['Clean Game'])
  // ntr is only a tag, so with tags deselected it excludes nothing.
  expect(search('-ntr', ['title'], games).sort()).toEqual(['Clean Game', 'Deep Space'])
})

test('a prefix search bypasses the selected fields entirely', () => {
  const games = [game(), game({ record_id: 2, title: 'Other', f95_id: '11111' })]
  expect(search('f95:54321', ['title'], games)).toEqual(['Deep Space'])
})

// ── Config plumbing ─────────────────────────────────────────────────────────

test('the config carries a [Search] defaultFields matching the registry', () => {
  const { buildDefaultConfig } = require('../electron/config/configSchema.js')
  expect(buildDefaultConfig('/tmp').Search.defaultFields)
    .toBe(DEFAULT_SEARCH_FIELD_IDS.join(','))
})

// All three search implementations must go through the registry, or one of them
// drifts back to a hardcoded column list.
test('no search path keeps its own hardcoded column list', () => {
  const catalogIndex = read('electron', 'db', 'catalogIndex.js')
  const versions = read('electron', 'db', 'versions.js')
  const filters = read('src', 'hooks', 'useFilters.js')

  expect(catalogIndex).toContain('indexColumnsForSearchFieldIds')
  expect(versions).toContain('unionColumnsForSearchFieldIds')
  expect(filters).toContain('SEARCH_FIELD_VALUE_GETTERS')

  // The old per-file tables and the blob they fed.
  expect(catalogIndex).not.toContain('const fieldsFor = {')
  expect(versions).not.toContain("searchType === 'anyId'")
  expect(filters).not.toContain('const getSearchableText')
})

test('every field id has a renderer-side value getter', () => {
  const filters = read('src', 'hooks', 'useFilters.js')
  const block = filters.slice(
    filters.indexOf('const SEARCH_FIELD_VALUE_GETTERS'),
    filters.indexOf('const getSearchHaystack'),
  )
  for (const id of SEARCH_FIELD_IDS) {
    expect(block, `getter for ${id}`).toMatch(new RegExp(`\\b${id}:`))
  }
})

test('prefix and legacy tables only reference real field ids', () => {
  for (const ids of Object.values(SEARCH_PREFIX_FIELDS)) {
    for (const id of ids) expect(SEARCH_FIELD_IDS).toContain(id)
  }
  for (const ids of Object.values(LEGACY_SEARCH_TYPE_FIELDS)) {
    if (ids === null) continue
    for (const id of ids) expect(SEARCH_FIELD_IDS).toContain(id)
  }
})
