import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// The server's atlas table grew `locked_fields` -- which fields an admin has
// pinned so the scraper won't overwrite them. The client did not know the
// column, so every package ingest logged
//   insertJsonData: ignoring unexpected column(s) for atlas_data: locked_fields
// and dropped it. Harmless in itself (that path exists so a server-side schema
// addition degrades instead of aborting the whole batch), but it fired on every
// single update and drowned the warning's actual purpose.
const read = (...parts) =>
  fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8')

describe('locked_fields', () => {
  it('is accepted by the ingest column filter', () => {
    const source = read('electron', 'db', 'atlas.js')
    const atlasSet = source.slice(source.indexOf('atlas_data: new Set('),
      source.indexOf('f95_zone_data: new Set('))
    expect(atlasSet).toContain('"locked_fields"')
  })

  it('is in the atlas_data table definition for new installs', () => {
    const source = read('electron', 'db', 'index.js')
    const ddl = source.slice(source.indexOf('CREATE TABLE IF NOT EXISTS atlas_data'))
    expect(ddl.slice(0, 1600)).toContain('locked_fields')
  })

  // CREATE TABLE IF NOT EXISTS is a no-op against an existing table, so the DDL
  // alone reaches new installs only -- exactly how atlas_external_steam's is_dlc
  // shipped broken. Existing installs need the ALTER.
  it('is added to existing installs by an ALTER, not just the DDL', () => {
    const source = read('electron', 'db', 'index.js')
    expect(source).toContain('ALTER TABLE atlas_data ADD COLUMN locked_fields')
  })

  // Nullable, because ADD COLUMN applies to rows already there and the client
  // has no value to backfill.
  it('is nullable so the migration cannot fail on existing rows', () => {
    const source = read('electron', 'db', 'index.js')
    const stmt = source.slice(source.indexOf('ADD COLUMN locked_fields'))
    expect(stmt.slice(0, 60)).not.toMatch(/NOT NULL/)
  })

  it('round-trips through a table shaped like the migrated one', async () => {
    const sqlite3 = require('sqlite3')
    const db = new sqlite3.Database(':memory:')
    const run = (sql) => new Promise((res, rej) =>
      db.run(sql, (err) => (err ? rej(err) : res())))
    const all = (sql) => new Promise((res, rej) =>
      db.all(sql, (err, rows) => (err ? rej(err) : res(rows))))

    await run(`CREATE TABLE atlas_data (atlas_id INTEGER PRIMARY KEY, title STRING)`)
    await run(`ALTER TABLE atlas_data ADD COLUMN locked_fields STRING`)
    await run(`INSERT INTO atlas_data VALUES (1, 'X', '["title","creator"]')`)
    // A row that predates the column reads NULL rather than breaking.
    await run(`INSERT INTO atlas_data (atlas_id, title) VALUES (2, 'Y')`)
    expect(await all(`SELECT atlas_id, locked_fields FROM atlas_data ORDER BY atlas_id`))
      .toEqual([
        { atlas_id: 1, locked_fields: '["title","creator"]' },
        { atlas_id: 2, locked_fields: null },
      ])
    db.close()
  })
})

// The warning is the mechanism that kept a new server column from aborting the
// whole ingest. Silencing it for locked_fields specifically must not silence it
// generally, or the next server addition passes unnoticed.
it('still warns about a column nobody has handled', () => {
  const source = read('electron', 'db', 'atlas.js')
  expect(source).toContain('insertJsonData: ignoring unexpected column(s)')
  expect(source).toContain('return columns.filter((column) => allowedColumns.has(column))')
})
