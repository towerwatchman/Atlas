import { describe, it, expect } from 'vitest'
import sqlite3 from 'sqlite3'
import { createRequire } from 'node:module'
const require_ = createRequire(import.meta.url)
const { tokenPredicate, tagColumnExpr, stripSpaces } =
  require_('../electron/db/tagFilterSql.js')
const { buildTagsFilterValue, normalizeTagText, splitTagSources } = require_('../electron/db/tagTokens.js')

const libraryHas = (rawTag, filter) =>
  splitTagSources(rawTag).includes(normalizeTagText(filter).trim())

const match = (rawTag, filter) => new Promise((resolve, reject) => {
  const db = new sqlite3.Database(':memory:')
  const run = (sql, p = []) => new Promise((res, rej) =>
    db.all(sql, p, (e, r) => (e ? rej(e) : res(r))))
  const idx = tokenPredicate('ci.tags_filter', normalizeTagText(filter))
  const fb = tokenPredicate(tagColumnExpr('t.tags'), stripSpaces(normalizeTagText(filter)))
  Promise.all([
    run('CREATE TABLE ci(tags_filter TEXT)'),
    run('CREATE TABLE t(tags TEXT)'),
  ]).then(() => Promise.all([
    run('INSERT INTO ci VALUES (?)', [buildTagsFilterValue(rawTag)]),
    run('INSERT INTO t VALUES (?)', [rawTag]),
  ])).then(async () => {
    const i = await run(`SELECT 1 m FROM ci WHERE ${idx.sql}`, idx.params)
    const f = await run(`SELECT 1 m FROM t WHERE ${fb.sql}`, fb.params)
    db.close(); resolve({ index: i.length > 0, fallback: f.length > 0, library: libraryHas(rawTag, filter) })
  }).catch(reject)
})

describe('Fallback residual divergences (documented, not regressions)', () => {
  it('separator variants over-match on fallback — scifi vs sci-fi (index no, fallback yes)', async () => {
    const { index, fallback, library } = await match('scifi', 'sci-fi')
    expect(index).toBe(false)
    expect(fallback).toBe(true)
    expect(library).toBe(false)
  })
  it('cased non-ASCII under-matches on fallback — Élite (index yes, fallback no)', async () => {
    const { index, fallback } = await match('Élite', 'Élite')
    expect(index).toBe(true)
    expect(fallback).toBe(false)
  })
  it('literal delimiters — a;b vs a;b matches, a;b vs a does not', async () => {
    expect((await match('a;b', 'a;b')).index).toBe(true)
    expect((await match('a;b', 'a;b')).fallback).toBe(true)
    expect((await match('a;b', 'a')).index).toBe(false)
    expect((await match('a;b', 'a')).fallback).toBe(false)
  })
})
