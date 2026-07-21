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
const { addGame, updateGame } = require('../electron/db/games')
const { getGame } = require('../electron/db/versions')

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
