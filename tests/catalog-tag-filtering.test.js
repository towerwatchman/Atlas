import { describe, it, expect } from 'vitest'
import sqlite3 from 'sqlite3'
import { createRequire } from 'node:module'
const require_ = createRequire(import.meta.url)
const { tokenPredicate, tagColumnExpr, stripSpaces } =
  require_('../electron/db/tagFilterSql.js')
const { buildTagsFilterValue, splitTagSources, normalizeTagText } =
  require_('../electron/db/tagTokens.js')

// Library oracle: mirrors useFilters.js includesTag/hasAnyTag over getGameTagValues.
const libraryHas = (rawSources, filter) => {
  const wanted = normalizeTagText(filter)
  return splitTagSources(...rawSources).some((tok) => tok === wanted)
}

// Run one stored tag string through BOTH catalog predicates; returns
// { index: boolean, fallback: boolean } for an include of `filter`.
const evalPredicates = (rawTag, filter) =>
  new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:')
    const run = (sql, params = []) => new Promise((res, rej) =>
      db.all(sql, params, (e, rows) => (e ? rej(e) : res(rows))))
    const idx = tokenPredicate('ci.tags_filter', normalizeTagText(filter))
    const fb = tokenPredicate(tagColumnExpr('t.tags'), stripSpaces(normalizeTagText(filter)))
    Promise.all([
      run(`CREATE TABLE ci(tags_filter TEXT)`),
      run(`CREATE TABLE t(tags TEXT)`),
    ]).then(() => Promise.all([
      run(`INSERT INTO ci VALUES (?)`, [buildTagsFilterValue(rawTag)]),
      run(`INSERT INTO t VALUES (?)`, [rawTag]),
    ])).then(async () => {
      const iRows = await run(`SELECT 1 AS m FROM ci WHERE ${idx.sql}`, idx.params)
      const fRows = await run(`SELECT 1 AS m FROM t WHERE ${fb.sql}`, fb.params)
      db.close()
      resolve({ index: iRows.length > 0, fallback: fRows.length > 0 })
    }).catch(reject)
  })

describe('Catalog Tag Filter Matrix (index vs fallback vs library oracle)', () => {
  const cases = [
    ['male protagonist only', 'male protagonist', false],
    ['female protagonist only', 'female protagonist', false],
    ['non-ntr', 'ntr', false],
    ['female protagonist, male protagonist', 'male protagonist', true],
    ['female_protagonist', 'female protagonist', true],
    ['a;b', 'a;b', true],
    ['a;b', 'a', false],
    ['c|d', 'c|d', true],
    ['100%', '100%', true],
  ]
  for (const [stored, filter, expectInclude] of cases) {
    it(`include "${filter}" against stored "${stored}" -> ${expectInclude}`, async () => {
      const { index, fallback } = await evalPredicates(stored, filter)
      const oracle = libraryHas([stored], filter)
      expect(oracle).toBe(expectInclude)
      expect(index).toBe(expectInclude)
      expect(fallback).toBe(expectInclude)
    })
  }

  it('exclude keeps untagged rows and drops only the matching tag', async () => {
    const db = new sqlite3.Database(':memory:')
    const run = (sql, params = []) => new Promise((res, rej) =>
      db.all(sql, params, (e, rows) => (e ? rej(e) : res(rows))))
    const inc = tokenPredicate('ci.tags_filter', normalizeTagText('x'))
    const exc = tokenPredicate('ci.tags_filter', normalizeTagText('x'))
    await run(`CREATE TABLE ci(tags_filter TEXT)`)
    await run(`INSERT INTO ci VALUES (NULL)`)
    await run(`INSERT INTO ci VALUES (?)`, [buildTagsFilterValue('x')])
    const included = await run(`SELECT COUNT(*) c FROM ci WHERE ${inc.sql}`, inc.params)
    const excluded = await run(`SELECT COUNT(*) c FROM ci WHERE NOT(${exc.sql})`, exc.params)
    db.close()
    expect(included[0].c).toBe(1)
    expect(excluded[0].c).toBe(1)
  })
})

describe('Exact-token matching — excluding a tag keeps unrelated tags', () => {
  for (const kept of ['female protagonist', 'female domination', 'male protagonist', 'male domination']) {
    it(`excluding "male" keeps a game tagged "${kept}"`, async () => {
      const { index, fallback } = await evalPredicates(kept, 'male')
      expect(index).toBe(false)
      expect(fallback).toBe(false)
    })
  }
})

describe('tagLogic OR vs AND (exact-token)', () => {
  const evalOrAnd = async (rawTag, filters) => {
    const inc = (filters.include || []).map((v) => normalizeTagText(v).trim()).filter(Boolean)
    const tagsFilter = buildTagsFilterValue(rawTag)
    const logic = filters.tagLogic === 'OR' ? 'OR' : 'AND'
    let keep = true
    if (inc.length > 0) {
      const perInc = inc.map((f) => `,${tagsFilter},`.includes(`,${f},`))
      keep = logic === 'AND' ? perInc.every(Boolean) : perInc.some(Boolean)
    }
    return keep
  }
  it('AND requires both tags, OR requires any', async () => {
    expect(await evalOrAnd('a', { include: ['a', 'b'], tagLogic: 'AND' })).toBe(false)
    expect(await evalOrAnd('a', { include: ['a', 'b'], tagLogic: 'OR' })).toBe(true)
    expect(await evalOrAnd('a, b', { include: ['a', 'b'], tagLogic: 'AND' })).toBe(true)
    expect(await evalOrAnd('a, b', { include: ['a', 'b'], tagLogic: 'OR' })).toBe(true)
  })
})
