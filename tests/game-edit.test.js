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
