import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require_ = createRequire(import.meta.url)
const { buildIndexWhere } = require_('../electron/db/catalogIndex.js')

// Browse date filter: the slider sets dateRange "custom" with dateFrom/dateTo.
// Both SQL paths (catalog index + union fallback) must produce >= / <= clauses.
// BETWEEN fails when one bound is null (SQLite: BETWEEN x AND NULL is always false).

describe('Browse date filter (custom range)', () => {
  it('custom range with both dates produces >= and <= on thread_updated_ms', () => {
    const { where, params } = buildIndexWhere({}, {
      dateField: 'latestUpdate',
      dateRange: 'custom',
      dateFrom: '2024-01-01',
      dateTo: '2024-12-31',
    })
    expect(where).toContain('ci.thread_updated_ms >= ?')
    expect(where).toContain('ci.thread_updated_ms <= ?')
    const fromMs = Date.parse('2024-01-01T00:00:00')
    const toMs = Date.parse('2024-12-31T23:59:59.999')
    expect(params).toContain(fromMs)
    expect(params).toContain(toMs)
  })

  it('custom range with only dateFrom (slider default) produces >= only', () => {
    const { where, params } = buildIndexWhere({}, {
      dateField: 'latestUpdate',
      dateRange: 'custom',
      dateFrom: '2024-06-15',
      dateTo: '',
    })
    expect(where).toContain('ci.thread_updated_ms >= ?')
    expect(where).not.toContain('ci.thread_updated_ms <= ?')
    const fromMs = Date.parse('2024-06-15T00:00:00')
    expect(params).toContain(fromMs)
  })

  it('custom range with neither date set adds no clause', () => {
    const { where } = buildIndexWhere({}, {
      dateField: 'latestUpdate',
      dateRange: 'custom',
      dateFrom: '',
      dateTo: '',
    })
    expect(where).not.toContain('thread_updated_ms')
  })

  it('preset 7d still produces a >= clause (regression guard)', () => {
    const { where, params } = buildIndexWhere({}, {
      dateField: 'latestUpdate',
      dateRange: '7d',
    })
    expect(where).toContain('ci.thread_updated_ms')
    expect(params.length).toBeGreaterThanOrEqual(1)
  })

  it('dateField none with browseDateRange 30d still works (saved-filter path)', () => {
    const { where } = buildIndexWhere({}, {
      dateField: 'none',
      browseDateRange: '30d',
    })
    expect(where).toContain('thread_updated_ms')
  })
})

describe('versions.js fallback path (text guard)', () => {
  const read = (...parts) =>
    fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8')
  const source = read('electron', 'db', 'versions.js')

  it('addDateRangeFilter handles custom with separate >= and <= conditions', () => {
    const fnStart = source.indexOf('const addDateRangeFilter')
    const fnEnd = source.indexOf('const browseSource', fnStart)
    const fn = source.slice(fnStart, fnEnd)
    expect(fn).toContain("'custom'")
    // The push statements must use separate >= and <=, not a single BETWEEN
    expect(fn).toContain('>= ?')
    expect(fn).toContain('<= ?')
    expect(fn).not.toContain('BETWEEN ? AND ?')
  })

  it('date filters use the catalog index COALESCE fallback chains', () => {
    // Each date concept falls back to a second column, mirroring
    // projectAtlasRow in catalogIndex.js.
    const lu = source.slice(source.indexOf('const luExpr'), source.indexOf('const tpExpr'))
    const tpStart = source.indexOf('const tpExpr')
    const tp = source.slice(tpStart, source.indexOf('if (filters.dateField', tpStart))
    expect(lu).toContain("dateMsExpression('catalog.thread_updated')")
    expect(lu).toContain("dateMsExpression('catalog.lewdcornerThreadUpdated')")
    expect(tp).toContain("dateMsExpression('catalog.thread_publish_date')")
    expect(tp).toContain("dateMsExpression('catalog.lewdcornerRegisterDate')")
  })

  it('date sorts pass the same COALESCE expressions into orderByParsedDate', () => {
    const sortStart = source.indexOf('const browseSortAliases = {')
    const sort = source.slice(sortStart, source.indexOf('getTableColumns', sortStart))
    expect(sort).toContain("orderByParsedDate('catalog.thread_updated', 'DESC', luExpr)")
    expect(sort).toContain("orderByParsedDate('catalog.thread_updated', 'ASC', luExpr)")
    // A generic alias could serve these arms instead, so each is pinned to its own date expression.
    expect(sort).toContain("orderByParsedDate('catalog.thread_publish_date', 'DESC', tpExpr)")
    expect(sort).toContain("orderByParsedDate('catalog.thread_publish_date', 'ASC', tpExpr)")
    expect(sort).toContain("ORDER BY catalog.atlas_id DESC, catalog.title COLLATE NOCASE ASC, catalog.catalogKey ASC")
    expect(sort).toContain("ORDER BY CASE WHEN catalog.atlas_id IS NULL THEN 1 ELSE 0 END ASC, catalog.atlas_id ASC, catalog.title COLLATE NOCASE ASC, catalog.catalogKey ASC")
  })

  it('orderByParsedDate accepts an optional dateExpr defaulting to dateMsExpression', () => {
    const fnStart = source.indexOf('const orderByParsedDate')
    const fn = source.slice(fnStart, source.indexOf('const orderByNullableNumber', fnStart))
    expect(fn).toContain('dateExpr === undefined')
    expect(fn).toContain('dateMsExpression(field)')
  })
})
