import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import sqlite3 from 'sqlite3'

// The gate is pure SQL, so these run it for real against an in-memory database
// rather than asserting on query strings. Three-valued logic is the whole reason:
// `NULL = 'Free'` is unknown, not false, and a WHERE that evaluates to unknown
// drops the row — which is what makes a NULL tier hidden without needing an
// explicit IS NULL branch. That is subtle enough to be worth executing.

const ROOT = path.join(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')

// Both query paths must carry the same predicate: the union is the fallback used
// whenever catalog_index is missing or stale, so if only the fast path filtered,
// the same browse would show different rows depending on index state.
const INDEX_PREDICATE = "(ci.lc_id IS NULL OR lct.tier = 'Free')"
const UNION_PREDICATE = "(catalog.lc_id IS NULL OR catalog.lewdcornerTier = 'Free')"

const FIXTURE = `
  CREATE TABLE lewdcorner_data (lc_id INTEGER PRIMARY KEY, tier STRING);
  INSERT INTO lewdcorner_data VALUES
    (1,'Free'), (2,'VIP'), (3,NULL), (4,'free'), (5,'Free Tier'), (6,'');

  CREATE TABLE catalog_index (catalog_key TEXT PRIMARY KEY, lc_id INTEGER, title TEXT);
  INSERT INTO catalog_index VALUES
    ('lc:1', 1, 'LC Free'),
    ('lc:2', 2, 'LC VIP'),
    ('lc:3', 3, 'LC null tier'),
    ('lc:4', 4, 'LC lowercase free'),
    ('lc:5', 5, 'LC Free Tier'),
    ('lc:6', 6, 'LC empty tier'),
    ('atlas:10', 1, 'Atlas linked to Free LC'),
    ('atlas:11', 2, 'Atlas linked to paid LC'),
    ('atlas:12', NULL, 'Atlas with no LC link'),
    ('steam:20', NULL, 'Steam row'),
    ('lc:99', 99, 'LC id with no data row');
`

// Uses the app's own sqlite3 build, so the semantics under test are the ones
// that will actually run in the main process.
const visibleTitles = (predicate = INDEX_PREDICATE) =>
  new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:')
    db.exec(FIXTURE, (execErr) => {
      if (execErr) { db.close(); reject(execErr); return }
      db.all(
        `SELECT ci.title FROM catalog_index ci
         LEFT JOIN lewdcorner_data AS lct ON lct.lc_id = ci.lc_id
         WHERE ${predicate}
         ORDER BY ci.title`,
        (err, rows) => {
          db.close()
          if (err) reject(err)
          else resolve(rows.map((row) => row.title))
        })
    })
  })

test('only exactly-Free LewdCorner rows survive, plus everything with no LC link', async () => {
  expect(await visibleTitles()).toEqual([
    'Atlas linked to Free LC',
    'Atlas with no LC link',
    'LC Free',
    'Steam row',
  ])
})

test('a NULL tier is hidden, via three-valued logic rather than an explicit branch', async () => {
  const visible = await visibleTitles()
  expect(visible).not.toContain('LC null tier')
  expect(visible).not.toContain('LC empty tier')
})

// `=` on TEXT is case- and whitespace-sensitive in SQLite, which is what "exact
// match" means here. If scraped tiers ever vary in casing these would need a
// COLLATE NOCASE, so pin the current behaviour rather than leave it implicit.
test('the match is exact: lowercase and prefixed variants do not count as Free', async () => {
  const visible = await visibleTitles()
  expect(visible).not.toContain('LC lowercase free')
  expect(visible).not.toContain('LC Free Tier')
})

// An lc_id whose lewdcorner_data row is gone cannot be shown to be Free, so the
// LEFT JOIN yields NULL and the row is hidden.
test('an lc_id with no matching lewdcorner_data row is hidden', async () => {
  expect(await visibleTitles()).not.toContain('LC id with no data row')
})

// The requirement is per-LC-link, not per-source: an atlas entry linked to a paid
// LC thread is hidden even though its source is 'atlas'.
test('the gate follows the lc_id, not the row source', async () => {
  const visible = await visibleTitles()
  expect(visible).toContain('Atlas linked to Free LC')
  expect(visible).not.toContain('Atlas linked to paid LC')
  // Rows with no LewdCorner linkage at all are never affected.
  expect(visible).toContain('Steam row')
  expect(visible).toContain('Atlas with no LC link')
})

test('the union predicate selects the same rows as the index predicate', async () => {
  // Same shape, different column names — the union exposes the tier as
  // catalog.lewdcornerTier and needs no join, since all four of its branches
  // already select lc_id and lewdcornerTier.
  const asUnion = UNION_PREDICATE
    .replace(/catalog\.lewdcornerTier/g, 'lct.tier')
    .replace(/catalog\./g, 'ci.')
  expect(await visibleTitles(asUnion)).toEqual(await visibleTitles(INDEX_PREDICATE))
})

// ── Wiring ──────────────────────────────────────────────────────────────────

test('the index path applies the gate and joins lewdcorner_data', () => {
  const source = read('electron', 'db', 'catalogIndex.js')
  expect(source).toContain(INDEX_PREDICATE)
  expect(source).toMatch(/LEFT JOIN lewdcorner_data AS lct ON lct\.lc_id = ci\.lc_id/)
})

// The count query and the page query share CATALOG_INDEX_JOINS and the WHERE
// builder. If the gate were applied to only the page query, the grid's scrollbar
// would be sized for rows it never renders.
test('the gate is in the shared WHERE builder, so the count query gets it too', () => {
  const source = read('electron', 'db', 'catalogIndex.js')
  const builder = source.slice(
    source.indexOf('const buildIndexWhere'),
    source.indexOf('const buildIndexOrderBy'),
  )
  expect(builder).toContain(INDEX_PREDICATE)
  const countQuery = source.slice(source.indexOf('SELECT COUNT(*) AS total FROM catalog_index'))
  expect(countQuery.slice(0, 200)).toContain('CATALOG_INDEX_JOINS')
})

test('the union fallback applies the gate as well', () => {
  const source = read('electron', 'db', 'versions.js')
  expect(source).toContain(UNION_PREDICATE)
})

// This was deliberately NOT implemented as an extra catalog_index column: reading
// live through the join means no reindex is needed to adopt it, and a rescrape
// that changes a tier takes effect at once instead of waiting for the row to be
// re-projected.
//
// This used to pin CATALOG_INDEX_VERSION to the literal 4. That asserted more
// than it meant to: the point is that THE TIER GATE adds no column, not that the
// index schema is frozen, and an unrelated bump (adding is_dlc to
// atlas_external_steam) failed it. The tier-specific checks below are the real
// guard and are unchanged.
test('the gate needs no catalog_index schema change or version bump', () => {
  const source = read('electron', 'db', 'catalogIndex.js')
  expect(source).not.toContain('lc_tier')
  // The catalog_index DDL must carry no LewdCorner tier column. Matched
  // specifically rather than on /tier/, which also hits the unrelated
  // thread_updated_tier / release_date_tier date-sort columns.
  const ddl = source.slice(source.indexOf('const CATALOG_INDEX_DDL'),
    source.indexOf('const CATALOG_INDEX_COLUMNS'))
  expect(ddl).not.toMatch(/\b(lc|lewdcorner)_?tier\b/i)
})

// It must be SQL-side. A post-fetch filter in the renderer would corrupt Browse's
// windowed loading, which relies on array indices matching the server's absolute
// result positions (see the comment on catalogGames in App.jsx).
test('no client-side LewdCorner tier filtering was added', () => {
  for (const file of [
    ['src', 'hooks', 'useFilters.js'],
    ['src', 'App.jsx'],
  ]) {
    expect(read(...file)).not.toMatch(/lewdcornerTier\s*[=!]==?\s*['"]Free/)
  }
})

// ── VIP user gating ──────────────────────────────────────────────────────────

// When the user is VIP, the tier gate is skipped entirely — all LC content
// (Free, VIP, NULL tier) should be visible. This tests the SQL predicate
// behaviour directly: no predicate = no filtering.
test('VIP user sees all LewdCorner content (no gate applied)', async () => {
  // With no WHERE predicate at all, every row is visible.
  const allTitles = await visibleTitles('1=1')
  expect(allTitles).toContain('LC Free')
  expect(allTitles).toContain('LC VIP')
  expect(allTitles).toContain('LC null tier')
  expect(allTitles).toContain('Atlas linked to paid LC')
  expect(allTitles).toContain('Steam row')
})

// The gate is conditional on getLcUserTier() !== 'VIP'. Verify the
// source code wraps the predicate in this check.
test('the index gate is conditional on user tier', () => {
  const source = read('electron', 'db', 'catalogIndex.js')
  const builder = source.slice(
    source.indexOf('const buildIndexWhere'),
    source.indexOf('const buildIndexOrderBy'),
  )
  expect(builder).toMatch(/getLcUserTier\(\)\s*!==\s*['"]VIP['"]/)
  expect(builder).toContain(INDEX_PREDICATE)
})

test('the union gate is conditional on user tier', () => {
  const source = read('electron', 'db', 'versions.js')
  // Find the section around the union tier gate.
  const idx = source.indexOf(UNION_PREDICATE)
  expect(idx).toBeGreaterThan(-1)
  const surrounding = source.slice(Math.max(0, idx - 200), idx + UNION_PREDICATE.length + 50)
  expect(surrounding).toMatch(/getLcUserTier\(\)\s*!==\s*['"]VIP['"]/)
})
