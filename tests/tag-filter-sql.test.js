import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
const require_ = createRequire(import.meta.url)
const { tokenPredicate, tagColumnExpr, escapeLike, stripSpaces } =
  require_('../electron/db/tagFilterSql.js')
const { normalizeTagText } = require_('../electron/db/tagTokens.js')

describe('SQL Predicate Builder Suite', () => {
  it('generates exact comma-anchored SQL with ESCAPE clause and bound param', () => {
    const { sql, params } = tokenPredicate('ci.tags_filter', 'test tag')
    expect(sql).toContain("COALESCE(ci.tags_filter, '')")
    expect(sql).toContain("LIKE ?")
    expect(sql).toContain("ESCAPE '\\'")
    expect(sql).toBe("(',' || COALESCE(ci.tags_filter, '') || ',') LIKE ? ESCAPE '\\'")
    expect(params).toEqual(['%,test tag,%'])
    expect(params[0].startsWith('%,')).toBe(true)
    expect(params[0].endsWith(',%')).toBe(true)
  })

  it('escapes LIKE wildcards %, _ , \\ in bound parameters', () => {
    expect(tokenPredicate('col', '100%').params[0]).toBe('%,100\\%,%')
    expect(tokenPredicate('col', 'tag_name').params[0]).toBe('%,tag\\_name,%')
    expect(tokenPredicate('col', 'path\\tag').params[0]).toBe('%,path\\\\tag,%')
  })

  it('tagColumnExpr lower/trims and strips - _ space, keeps commas as delimiter', () => {
    expect(tagColumnExpr('c.f95_tags'))
      .toBe("REPLACE(REPLACE(REPLACE(LOWER(TRIM(COALESCE(c.f95_tags, ''))), '-', ''), '_', ''), ' ', '')")
  })

  it('fallback binds stripSpaces(normalizeTagText(tag)), not the spaced token', () => {
    const fallbackToken = stripSpaces(normalizeTagText('sci-fi action'))
    expect(fallbackToken).toBe('scifiaction')
    expect(tokenPredicate(tagColumnExpr('c.tags'), fallbackToken).params[0])
      .toBe('%,scifiaction,%')
  })
})
