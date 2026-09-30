import { test, expect } from 'vitest'
import { createRequire } from 'module'

const require_ = createRequire(import.meta.url)

// The wishlist filter shape both query paths must produce: an OR of four separate
// EXISTS clauses. A single EXISTS with an internal 4-way OR forces SQLite to scan,
// whereas separate EXISTS clauses allow per-column index lookups.
const WISHLIST_FILTER_SQL = `(
  EXISTS (SELECT 1 FROM wishlist_entries wishlist
          WHERE wishlist.atlas_id IS NOT NULL AND wishlist.atlas_id = catalog.atlas_id)
  OR EXISTS (SELECT 1 FROM wishlist_entries wishlist
          WHERE wishlist.f95_id IS NOT NULL AND wishlist.f95_id = catalog.f95_id)
  OR EXISTS (SELECT 1 FROM wishlist_entries wishlist
          WHERE wishlist.lc_id IS NOT NULL AND wishlist.lc_id = catalog.lc_id)
  OR EXISTS (SELECT 1 FROM wishlist_entries wishlist
          WHERE wishlist.steam_id IS NOT NULL AND wishlist.steam_id = catalog.steam_id)
)`

const query = (setup, select) => new Promise((resolve, reject) => {
  const sqlite3 = require_('sqlite3')
  const db = new sqlite3.Database(':memory:')
  db.exec(setup, (execErr) => {
    if (execErr) { db.close(); reject(execErr); return }
    db.all(select, (err, rows) => {
      db.close()
      if (err) { reject(err); return }
      resolve(rows)
    })
  })
})

test('wishlist-only filter matches a catalog row via any single provider id', async () => {
  const rows = await query(`
    CREATE TABLE catalog (
      catalog_key TEXT, atlas_id INT, f95_id INT, lc_id INT, steam_id INT);
    CREATE TABLE wishlist_entries (
      identity_key TEXT, atlas_id INT, f95_id INT, lc_id INT, steam_id INT);

    INSERT INTO catalog VALUES
      ('a1', 10, NULL, NULL, NULL),    -- wishlisted via atlas
      ('a2', 20, 200, NULL, NULL),     -- wishlisted via f95
      ('f1', NULL, 100, NULL, NULL),   -- wishlisted via f95
      ('l1', NULL, NULL, 300, NULL),   -- wishlisted via lc
      ('s1', NULL, NULL, NULL, 400),   -- wishlisted via steam
      ('none', NULL, NULL, NULL, NULL);

    -- f95:555 also carries atlas_id=999; catalog a4 matches by atlas_id,
    -- proving the 4-dimension probe catches cross-matches a single
    -- identity_key join would miss.
    INSERT INTO wishlist_entries VALUES
      ('atlas:10', 10, NULL, NULL, NULL),
      ('f95:100', NULL, 100, NULL, NULL),
      ('lewdcorner:300', NULL, NULL, 300, NULL),
      ('steam:400', NULL, NULL, NULL, 400),
      ('f95:200', 20, 200, NULL, NULL),
      ('f95:555', 999, 555, NULL, NULL);

    INSERT INTO catalog (catalog_key, atlas_id) VALUES ('a4', 999);
  `, `
    SELECT catalog.catalog_key FROM catalog WHERE ${WISHLIST_FILTER_SQL} ORDER BY catalog.catalog_key;
  `)

  expect(rows.map((r) => r.catalog_key)).toEqual([
    'a1', 'a2', 'a4', 'f1', 'l1', 's1',
  ])
  expect(rows.map((r) => r.catalog_key)).not.toContain('none')
})
