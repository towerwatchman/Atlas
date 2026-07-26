// Contract for EDITING a game — a real DB round-trip against a temp SQLite file
// built by the app's own initializeDatabase(). Seeds a record, edits it via the
// real updateGame(), reads it back via the real getGame(), and asserts the edit
// persisted and the metadata overrides merged. This catches schema/query drift
// in the edit path (the exact thing that breaks silently when a column or the
// overrides join changes).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const dbIndex = require('../electron/db/index')
const { addGame, updateGame, getGameOverrides, clearGameOverrides } = require('../electron/db/games')
const { getGame } = require('../electron/db/versions')
const { validateGameMetadataOverrides } = require('../electron/db/repair')

let tmpDir

// initializeDatabase runs several CREATE TABLE + ALTER statements on the
// callback queue; give them a tick to settle before we use the connection.
const settle = () => new Promise((r) => setTimeout(r, 300))

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-edit-test-'))
  dbIndex.initializeDatabase(tmpDir)
  await settle()
})

afterAll(async () => {
  try { dbIndex.db && dbIndex.db.close() } catch { /* ignore */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
})

describe('editing a game', () => {
  it('persists base field edits (title/creator/engine/description)', async () => {
    const recordId = await addGame({ title: 'Original', creator: 'DevA', engine: 'Unity' })
    expect(recordId).toBeTruthy()

    await updateGame({
      record_id: recordId,
      title: 'Edited Title',
      creator: 'DevB',
      engine: 'Godot',
      description: 'A new description',
    })

    const game = await getGame(recordId, '/tmp', true)
    expect(game.title).toBe('Edited Title')
    expect(game.creator).toBe('DevB')
    expect(game.engine).toBe('Godot')
  })

  it('stores + reads back metadata overrides (publisher/status/genre/etc.)', async () => {
    const recordId = await addGame({ title: 'MetaGame', creator: 'MetaDev', engine: 'Unity' })
    await updateGame({
      record_id: recordId,
      title: 'MetaGame',
      creator: 'MetaDev',
      engine: 'Unity',
      publisher: 'PubCo',
      status: 'Completed',
      genre: 'RPG, Adventure',
      language: 'English',
      release_date: '2024-01-01',
    })

    const game = await getGame(recordId, '/tmp', true)
    // Overrides should win / be present on the merged record.
    expect(game.publisher).toBe('PubCo')
    expect(game.status).toBe('Completed')
    expect(String(game.genre)).toContain('RPG')
  })

  it('is idempotent — editing the same record twice upserts, not duplicates', async () => {
    const recordId = await addGame({ title: 'TwiceGame', creator: 'Dev', engine: 'Unity' })
    await updateGame({ record_id: recordId, title: 'TwiceGame', creator: 'Dev', engine: 'Unity', publisher: 'First' })
    await updateGame({ record_id: recordId, title: 'TwiceGame', creator: 'Dev', engine: 'Unity', publisher: 'Second' })

    const game = await getGame(recordId, '/tmp', true)
    expect(game.publisher).toBe('Second')

    // Exactly one overrides row for this record (ON CONFLICT upsert, not insert).
    const count = await new Promise((resolve, reject) => {
      dbIndex.db.get(
        'SELECT COUNT(*) AS n FROM game_metadata_overrides WHERE record_id = ?',
        [recordId],
        (err, row) => (err ? reject(err) : resolve(row.n)),
      )
    })
    expect(count).toBe(1)
  })

  it('updates tags on edit', async () => {
    const recordId = await addGame({ title: 'TagGame', creator: 'Dev', engine: 'Unity' })
    await updateGame({ record_id: recordId, title: 'TagGame', creator: 'Dev', engine: 'Unity', tags: 'action, indie' })

    const tagCount = await new Promise((resolve, reject) => {
      dbIndex.db.get(
        'SELECT COUNT(*) AS n FROM tag_mappings WHERE record_id = ?',
        [recordId],
        (err, row) => (err ? reject(err) : resolve(row.n)),
      )
    })
    expect(tagCount).toBe(2)
  })
})

// ── Override isolation ─────────────────────────────────────────────────────
// updateGame() used to write ALL thirteen override columns on every call, using
// '' for anything the caller omitted. Because the merge is
// COALESCE(override.x, <sources>), an '' override is not null and therefore wins
// — so editing one field blanked every other field, and the pinned
// latest_version froze update detection. These tests pin the patch semantics.

const getOverrideRow = (recordId) =>
  new Promise((resolve, reject) => {
    dbIndex.db.get(
      'SELECT * FROM game_metadata_overrides WHERE record_id = ?',
      [recordId],
      (err, row) => (err ? reject(err) : resolve(row || null)),
    )
  })

const seedAtlas = async (recordId, atlasId, data = {}) => {
  const run = (sql, params) =>
    new Promise((resolve, reject) => {
      dbIndex.db.run(sql, params, (err) => (err ? reject(err) : resolve()))
    })
  await run(
    `INSERT OR REPLACE INTO atlas_data
       (atlas_id, status, version, category, genre, language, os, censored, translations, voice, overview, release_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      atlasId,
      data.status ?? 'Ongoing',
      data.version ?? '0.5.0',
      data.category ?? 'Games',
      data.genre ?? 'Sci-Fi',
      data.language ?? 'English',
      data.os ?? 'Windows',
      data.censored ?? 'No',
      data.translations ?? 'None',
      data.voice ?? 'None',
      data.overview ?? 'Atlas description',
      data.release_date ?? '2023-05-05',
    ],
  )
  await run('INSERT OR REPLACE INTO atlas_mappings (record_id, atlas_id) VALUES (?, ?)', [recordId, atlasId])
}

describe('override isolation', () => {
  it('writes ONLY the fields present in the payload', async () => {
    const recordId = await addGame({ title: 'PatchGame', creator: 'Dev', engine: 'Unity' })
    await updateGame({ record_id: recordId, status: 'Completed' })

    const row = await getOverrideRow(recordId)
    expect(row.status).toBe('Completed')
    // Every other column must still be NULL, not ''.
    for (const col of ['os', 'publisher', 'category', 'latest_version', 'censored',
                       'language', 'translations', 'genre', 'voice', 'rating', 'overview']) {
      expect(row[col]).toBeNull()
    }
  })

  it('does not pin latest_version when another field is edited', async () => {
    const recordId = await addGame({ title: 'VersionGame', creator: 'Dev', engine: 'Unity' })
    await seedAtlas(recordId, 9101, { version: '1.2.0' })
    await updateGame({ record_id: recordId, status: 'Completed' })

    const row = await getOverrideRow(recordId)
    expect(row.latest_version).toBeNull()
    // Still resolves from the source, so update detection keeps working.
    const game = await getGame(recordId, '/tmp', true)
    expect(game.latestVersion).toBe('1.2.0')
  })

  it('leaves other fields inheriting from Atlas after a single-field edit', async () => {
    const recordId = await addGame({ title: 'InheritGame', creator: 'Dev', engine: 'Unity' })
    await seedAtlas(recordId, 9102, { genre: 'Horror', language: 'Japanese' })
    await updateGame({ record_id: recordId, status: 'Completed' })

    const game = await getGame(recordId, '/tmp', true)
    expect(game.status).toBe('Completed')
    expect(game.genre).toBe('Horror')
    expect(game.language).toBe('Japanese')
  })

  it('treats an empty value as "clear this override"', async () => {
    const recordId = await addGame({ title: 'ClearGame', creator: 'Dev', engine: 'Unity' })
    await seedAtlas(recordId, 9103, { status: 'Ongoing' })
    await updateGame({ record_id: recordId, status: 'Completed' })
    expect((await getGame(recordId, '/tmp', true)).status).toBe('Completed')

    await updateGame({ record_id: recordId, status: '   ' })
    // Override gone, source value restored.
    expect((await getGame(recordId, '/tmp', true)).status).toBe('Ongoing')
  })

  it('does not wipe tags when the payload omits them', async () => {
    const recordId = await addGame({ title: 'KeepTagsGame', creator: 'Dev', engine: 'Unity' })
    await updateGame({ record_id: recordId, tags: 'action, indie' })
    // A description-only update (the importer's shape) must not touch tags.
    await updateGame({ record_id: recordId, description: 'imported blurb' })

    const tagCount = await new Promise((resolve, reject) => {
      dbIndex.db.get(
        'SELECT COUNT(*) AS n FROM tag_mappings WHERE record_id = ?',
        [recordId],
        (err, row) => (err ? reject(err) : resolve(row.n)),
      )
    })
    expect(tagCount).toBe(2)
  })

  it('removes the override row once nothing custom is left', async () => {
    const recordId = await addGame({ title: 'EmptyRowGame', creator: 'Dev', engine: 'Unity' })
    await updateGame({ record_id: recordId, publisher: 'PubCo' })
    expect(await getOverrideRow(recordId)).not.toBeNull()

    await updateGame({ record_id: recordId, publisher: '' })
    expect(await getOverrideRow(recordId)).toBeNull()
  })
})

describe('reporting and clearing custom data', () => {
  it('reports which fields are custom and what they would inherit', async () => {
    const recordId = await addGame({ title: 'ReportGame', creator: 'Dev', engine: 'Unity' })
    await seedAtlas(recordId, 9201, { status: 'Ongoing', genre: 'Horror' })
    await updateGame({ record_id: recordId, status: 'Completed' })

    const report = await getGameOverrides(recordId)
    expect(report.overriddenCount).toBe(1)

    const status = report.fields.find((f) => f.column === 'status')
    expect(status.overridden).toBe(true)
    expect(status.custom).toBe('Completed')
    expect(status.inherited).toBe('Ongoing')

    const genre = report.fields.find((f) => f.column === 'genre')
    expect(genre.overridden).toBe(false)
    expect(genre.inherited).toBe('Horror')
  })

  it('clears a single field without touching the others', async () => {
    const recordId = await addGame({ title: 'ClearOneGame', creator: 'Dev', engine: 'Unity' })
    await seedAtlas(recordId, 9202, { status: 'Ongoing' })
    await updateGame({ record_id: recordId, status: 'Completed', publisher: 'PubCo' })

    await clearGameOverrides(recordId, ['status'])
    const game = await getGame(recordId, '/tmp', true)
    expect(game.status).toBe('Ongoing')
    expect(game.publisher).toBe('PubCo')
  })

  it('accepts form keys as well as column names', async () => {
    const recordId = await addGame({ title: 'FormKeyGame', creator: 'Dev', engine: 'Unity' })
    await updateGame({ record_id: recordId, os: 'Linux' })
    // "platform" is the form key for the os column.
    const result = await clearGameOverrides(recordId, ['platform'])
    expect(result.success).toBe(true)
    expect(await getOverrideRow(recordId)).toBeNull()
  })

  it('clears every custom field at once', async () => {
    const recordId = await addGame({ title: 'ClearAllGame', creator: 'Dev', engine: 'Unity' })
    await seedAtlas(recordId, 9203, { status: 'Ongoing', genre: 'Horror' })
    await updateGame({ record_id: recordId, status: 'Completed', genre: 'RPG', publisher: 'PubCo' })

    const result = await clearGameOverrides(recordId)
    expect(result.success).toBe(true)
    expect(await getOverrideRow(recordId)).toBeNull()

    const game = await getGame(recordId, '/tmp', true)
    expect(game.status).toBe('Ongoing')
    expect(game.genre).toBe('Horror')
  })
})

describe('validating existing custom data', () => {
  it('repairs blanking overrides and restores the source values', async () => {
    const recordId = await addGame({ title: 'BlankFixGame', creator: 'Dev', engine: 'Unity' })
    await seedAtlas(recordId, 9301, { genre: 'Horror', status: 'Ongoing' })
    // Simulate the old bug: a full row of '' written by editing one field.
    await new Promise((resolve, reject) => {
      dbIndex.db.run(
        `INSERT INTO game_metadata_overrides
           (record_id, os, publisher, release_date, status, category, latest_version,
            censored, language, translations, genre, voice, rating, overview, updated_at)
         VALUES (?, '', '', '', 'Completed', '', '', '', '', '', '', '', '', '', 0)`,
        [recordId],
        (err) => (err ? reject(err) : resolve()),
      )
    })
    // Genre is blanked by the '' override before the sweep runs.
    expect((await getGame(recordId, '/tmp', true)).genre).toBe('')

    const summary = await validateGameMetadataOverrides()
    expect(summary.blankedFields).toBeGreaterThan(0)

    const game = await getGame(recordId, '/tmp', true)
    expect(game.genre).toBe('Horror')     // source value restored
    expect(game.status).toBe('Completed') // real custom value preserved
  })

  it('prunes overrides identical to the source value', async () => {
    const recordId = await addGame({ title: 'RedundantGame', creator: 'Dev', engine: 'Unity' })
    await seedAtlas(recordId, 9302, { status: 'Ongoing' })
    await updateGame({ record_id: recordId, status: 'Ongoing', publisher: 'PubCo' })

    const summary = await validateGameMetadataOverrides()
    expect(summary.redundantFields).toBeGreaterThan(0)

    const row = await getOverrideRow(recordId)
    expect(row.status).toBeNull()        // redundant, dropped
    expect(row.publisher).toBe('PubCo')  // genuinely custom, kept
    // Effective value is unchanged by the prune.
    expect((await getGame(recordId, '/tmp', true)).status).toBe('Ongoing')
  })

  it('reports without writing when dryRun is set', async () => {
    const recordId = await addGame({ title: 'DryRunGame', creator: 'Dev', engine: 'Unity' })
    await seedAtlas(recordId, 9303, { status: 'Ongoing' })
    await updateGame({ record_id: recordId, status: 'Ongoing' })

    const summary = await validateGameMetadataOverrides({ dryRun: true })
    expect(summary.dryRun).toBe(true)
    expect(summary.redundantFields).toBeGreaterThan(0)
    // Untouched.
    expect((await getOverrideRow(recordId)).status).toBe('Ongoing')
  })

  it('is idempotent — a clean pass reports no changes', async () => {
    await validateGameMetadataOverrides()
    const second = await validateGameMetadataOverrides()
    expect(second.blankedFields).toBe(0)
    expect(second.redundantFields).toBe(0)
    expect(second.deletedRows).toBe(0)
  })
})

describe('validation sweep performance and progress', () => {
  it('exits early when no title has custom data', async () => {
    await new Promise((res, rej) =>
      dbIndex.db.run('DELETE FROM game_metadata_overrides', (e) => (e ? rej(e) : res())))

    const summary = await validateGameMetadataOverrides()
    expect(summary.skipped).toBe(true)
    expect(summary.scannedRows).toBe(0)
    // Boot must not pay for a join on a library with nothing to validate.
    expect(typeof summary.durationMs).toBe('number')
  })

  it('reports progress so a slow first run can be shown to the user', async () => {
    const recordId = await addGame({ title: 'ProgressGame', creator: 'Dev', engine: 'Unity' })
    await seedAtlas(recordId, 9401, { status: 'Ongoing' })
    await updateGame({ record_id: recordId, status: 'Ongoing' })

    const events = []
    await validateGameMetadataOverrides({ onProgress: (e) => events.push(e) })

    expect(events.length).toBeGreaterThan(0)
    expect(events[0].phase).toBe('start')
    expect(events[events.length - 1].phase).toBe('done')
    for (const e of events) {
      expect(typeof e.message).toBe('string')
      expect(e.processed).toBeLessThanOrEqual(e.total)
    }
  })

  it('does not let a failing progress handler break the repair', async () => {
    const recordId = await addGame({ title: 'BadHandlerGame', creator: 'Dev', engine: 'Unity' })
    await seedAtlas(recordId, 9402, { status: 'Ongoing' })
    await updateGame({ record_id: recordId, status: 'Ongoing' })

    const summary = await validateGameMetadataOverrides({
      onProgress: () => { throw new Error('boom') },
    })
    expect(summary.redundantFields).toBeGreaterThan(0)
    expect((await getOverrideRow(recordId))).toBeNull()
  })

  it('commits the whole sweep as one unit', async () => {
    // Several corrupt rows repaired together; all or nothing.
    const ids = []
    for (let i = 0; i < 5; i += 1) {
      const id = await addGame({ title: `TxGame ${i}`, creator: 'Dev', engine: 'Unity' })
      await seedAtlas(id, 9500 + i, { genre: 'Horror' })
      await new Promise((res, rej) =>
        dbIndex.db.run(
          `INSERT INTO game_metadata_overrides (record_id, genre, status, updated_at)
           VALUES (?, '', 'Completed', 0)`,
          [id],
          (e) => (e ? rej(e) : res()),
        ))
      ids.push(id)
    }

    await validateGameMetadataOverrides()
    for (const id of ids) {
      const game = await getGame(id, '/tmp', true)
      expect(game.genre).toBe('Horror')     // blanking override cleared
      expect(game.status).toBe('Completed') // real custom value kept
    }
  })
})

// ── Base games columns (Title / Engine / Developer) ────────────────────────
// These have no override column, so "changed" means the stored value differs
// from what the sources report. Resetting writes the source value back into the
// games row rather than nulling an override.

const seedAtlasIdentity = async (recordId, atlasId, d = {}) => {
  const run = (sql, params) =>
    new Promise((resolve, reject) => { dbIndex.db.run(sql, params, (e) => (e ? reject(e) : resolve())) })
  await run(
    `INSERT OR REPLACE INTO atlas_data (atlas_id, title, engine, creator, developer, status, version)
     VALUES (?, ?, ?, ?, ?, 'Ongoing', '1.0.0')`,
    [atlasId, d.title ?? 'Atlas Title', d.engine ?? 'RenPy', d.creator ?? 'Atlas Creator', d.developer ?? 'Atlas Dev'],
  )
  await run('INSERT OR REPLACE INTO atlas_mappings (record_id, atlas_id) VALUES (?, ?)', [recordId, atlasId])
}

const fieldFor = (report, column) => report.fields.find((f) => f.column === column)

describe('base games columns', () => {
  it('does not flag a record that still matches its source', async () => {
    const recordId = await addGame({ title: 'Atlas Title', creator: 'Atlas Creator', engine: 'RenPy' })
    await seedAtlasIdentity(recordId, 9601)

    const report = await getGameOverrides(recordId)
    expect(fieldFor(report, 'title').overridden).toBe(false)
    expect(fieldFor(report, 'creator').overridden).toBe(false)
    expect(fieldFor(report, 'engine').overridden).toBe(false)
    expect(report.baseFieldCount).toBe(0)
  })

  it('flags title/engine/developer when they differ, and reports the source', async () => {
    const recordId = await addGame({ title: 'Atlas Title', creator: 'Atlas Creator', engine: 'RenPy' })
    await seedAtlasIdentity(recordId, 9602)
    await updateGame({ record_id: recordId, title: 'My Better Title', engine: 'Unity' })

    const report = await getGameOverrides(recordId)
    const title = fieldFor(report, 'title')
    expect(title.overridden).toBe(true)
    expect(title.base).toBe(true)
    expect(title.custom).toBe('My Better Title')
    expect(title.inherited).toBe('Atlas Title')

    expect(fieldFor(report, 'engine').overridden).toBe(true)
    expect(fieldFor(report, 'creator').overridden).toBe(false)
    expect(report.baseFieldCount).toBe(2)
  })

  it('ignores case and whitespace differences', async () => {
    const recordId = await addGame({ title: '  atlas title ', creator: 'ATLAS CREATOR', engine: 'RenPy' })
    await seedAtlasIdentity(recordId, 9603)

    const report = await getGameOverrides(recordId)
    expect(report.baseFieldCount).toBe(0)
  })

  it('resetting a base field writes the source value back into games', async () => {
    const recordId = await addGame({ title: 'Reset Base', creator: 'Reset Creator', engine: 'RenPy' })
    await seedAtlasIdentity(recordId, 9604, { title: 'Reset Base', creator: 'Reset Creator' })
    await updateGame({ record_id: recordId, title: 'Renamed', creator: 'Someone Else' })

    const result = await clearGameOverrides(recordId, ['title'])
    expect(result.success).toBe(true)
    expect(result.cleared).toContain('title')

    const game = await getGame(recordId, '/tmp', true)
    expect(game.title).toBe('Reset Base')
    // The other edited base field is untouched.
    expect(game.creator).toBe('Someone Else')
  })

  it('never blanks a base field that has no source value', async () => {
    const recordId = await addGame({ title: 'Homebrew Game', creator: 'Me', engine: 'Custom' })
    // No atlas/steam/gog mapping at all.
    const report = await getGameOverrides(recordId)
    expect(fieldFor(report, 'title').resettable).toBe(false)
    // Nothing to differ from, so nothing is flagged.
    expect(fieldFor(report, 'title').overridden).toBe(false)

    const result = await clearGameOverrides(recordId, ['title'])
    expect(result.cleared).not.toContain('title')
    expect(result.skipped).toContain('title')
    expect((await getGame(recordId, '/tmp', true)).title).toBe('Homebrew Game')
  })

  it('reset-all restores base columns and overrides together', async () => {
    const recordId = await addGame({ title: 'All Base', creator: 'All Creator', engine: 'RenPy' })
    await seedAtlasIdentity(recordId, 9605, { title: 'All Base', creator: 'All Creator' })
    await updateGame({ record_id: recordId, title: 'Renamed', engine: 'Unity', status: 'Completed' })
    expect((await getGameOverrides(recordId)).overriddenCount).toBe(3)

    await clearGameOverrides(recordId)

    const game = await getGame(recordId, '/tmp', true)
    expect(game.title).toBe('All Base')
    expect(game.engine).toBe('RenPy')
    expect(game.status).toBe('Ongoing')
    expect((await getGameOverrides(recordId)).overriddenCount).toBe(0)
  })

  it('accepts the developer form key for the creator column', async () => {
    const recordId = await addGame({ title: 'FormKey Base', creator: 'FormKey Creator', engine: 'RenPy' })
    await seedAtlasIdentity(recordId, 9606, { title: 'FormKey Base', creator: 'FormKey Creator' })
    await updateGame({ record_id: recordId, creator: 'Someone Else' })

    const result = await clearGameOverrides(recordId, ['developer'])
    expect(result.cleared).toContain('creator')
    expect((await getGame(recordId, '/tmp', true)).creator).toBe('FormKey Creator')
  })

  it('refuses a reset that would duplicate another record, without a raw SQL error', async () => {
    // games is UNIQUE on (title, creator, engine). Two imports of the same game
    // where the user renamed one to tell them apart: resetting the renamed one
    // would collide with the original.
    await addGame({ title: 'Twin Title', creator: 'Twin Creator', engine: 'RenPy' })
    const renamed = await addGame({ title: 'Twin Title (v2)', creator: 'Twin Creator', engine: 'RenPy' })
    await seedAtlasIdentity(renamed, 9607, { title: 'Twin Title', creator: 'Twin Creator' })

    const report = await getGameOverrides(renamed)
    expect(fieldFor(report, 'title').overridden).toBe(true)

    const result = await clearGameOverrides(renamed, ['title'])
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/identical to another record/i)
    expect(result.error).not.toMatch(/SQLITE|constraint failed/i)
    // The record is left intact rather than half-reset.
    expect((await getGame(renamed, '/tmp', true)).title).toBe('Twin Title (v2)')
  })
})

// ── Tracked base-field edits ───────────────────────────────────────────────
// Comparing a base column against its source chain is not enough on its own:
// Steam and GOG rarely publish an engine and many Atlas records lack one, so an
// edited engine with no source value to differ from was invisible in the
// properties window. updateGame() now records what the column held before a
// user edit, which gives exact intent and a revert target that does not depend
// on the source still having a value.

const userEdit = (game) => updateGame(game, { recordBaseEdits: true })

describe('tracked base-field edits', () => {
  it('marks an edited engine even when no source has an engine value', async () => {
    const recordId = await addGame({ title: 'No Engine Source', creator: 'Dev', engine: 'Original' })
    await seedAtlasIdentity(recordId, 9701, { title: 'No Engine Source', engine: '', creator: 'Dev' })

    await userEdit({ record_id: recordId, engine: 'RenPy' })

    const field = fieldFor(await getGameOverrides(recordId), 'engine')
    expect(field.overridden).toBe(true)
    expect(field.inheritedFrom).toBe('original')
    expect(field.inherited).toBe('Original')
    expect(field.resettable).toBe(true)
  })

  it('resets to the recorded pre-edit value and forgets it afterwards', async () => {
    const recordId = await addGame({ title: 'Revert Engine', creator: 'Dev', engine: 'Original' })
    await seedAtlasIdentity(recordId, 9702, { title: 'Revert Engine', engine: '', creator: 'Dev' })
    await userEdit({ record_id: recordId, engine: 'RenPy' })

    const result = await clearGameOverrides(recordId, ['engine'])
    expect(result.cleared).toContain('engine')
    expect((await getGame(recordId, '/tmp', true)).engine).toBe('Original')
    // No longer reads as changed, and the row is gone since nothing is left.
    expect(fieldFor(await getGameOverrides(recordId), 'engine').overridden).toBe(false)
    expect(await getOverrideRow(recordId)).toBeNull()
  })

  it('does NOT treat importer writes as user edits', async () => {
    const recordId = await addGame({ title: 'Importer Write', creator: 'Dev', engine: 'Original' })
    await seedAtlasIdentity(recordId, 9703, { title: 'Importer Write', engine: '', creator: 'Dev' })

    // The importer's shape, called without recordBaseEdits.
    await updateGame({ record_id: recordId, title: 'Importer Write', creator: 'Dev', engine: 'Unity', description: 'blurb' })

    const report = await getGameOverrides(recordId)
    expect(report.baseFieldCount).toBe(0)
    expect(fieldFor(report, 'engine').overridden).toBe(false)
  })

  it('clears the mark when the user edits back to the original value', async () => {
    const recordId = await addGame({ title: 'Toggle Back', creator: 'Dev', engine: 'Alpha' })
    await userEdit({ record_id: recordId, engine: 'Beta' })
    expect(fieldFor(await getGameOverrides(recordId), 'engine').overridden).toBe(true)

    await userEdit({ record_id: recordId, engine: 'Alpha' })
    expect(fieldFor(await getGameOverrides(recordId), 'engine').overridden).toBe(false)
  })

  it('tracks and reverts edits on a record with no source at all', async () => {
    const recordId = await addGame({ title: 'Homebrew', creator: 'Me', engine: 'Custom' })
    await userEdit({ record_id: recordId, title: 'Homebrew Deluxe' })

    const field = fieldFor(await getGameOverrides(recordId), 'title')
    expect(field.overridden).toBe(true)
    expect(field.resettable).toBe(true)
    expect(field.inherited).toBe('Homebrew')

    await clearGameOverrides(recordId, ['title'])
    expect((await getGame(recordId, '/tmp', true)).title).toBe('Homebrew')
  })

  it('still infers legacy edits made before tracking existed', async () => {
    const recordId = await addGame({ title: 'Legacy Edit', creator: 'Dev', engine: 'Unity' })
    await seedAtlasIdentity(recordId, 9704, { title: 'Legacy Edit', engine: 'RenPy', creator: 'Dev' })

    // No recorded original — the difference against the source is all we have.
    const field = fieldFor(await getGameOverrides(recordId), 'engine')
    expect(field.overridden).toBe(true)
    expect(field.inheritedFrom).toBe('source')
    expect(field.inherited).toBe('RenPy')
  })

  it('survives a junk value in the originals column', async () => {
    const recordId = await addGame({ title: 'Junk Originals', creator: 'Dev', engine: 'Unity' })
    await new Promise((res, rej) => dbIndex.db.run(
      `INSERT INTO game_metadata_overrides (record_id, base_field_originals, updated_at) VALUES (?, 'not json', 0)`,
      [recordId], (e) => (e ? rej(e) : res())))

    const report = await getGameOverrides(recordId)
    expect(report.baseFieldCount).toBe(0)
    expect(report.fields.length).toBeGreaterThan(0)
  })
})
