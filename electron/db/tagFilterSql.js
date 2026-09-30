'use strict'

// ── shared SQL tag predicate builder ───────────────────────────────────────
//
// One builder core used by both the index (catalogIndex.js) and the union
// fallback (versions.js). Lives electron-only; the pure token helpers are in
// ./tagTokens.js (mirrored to src/utils/tagTokens.js).
//
// Exact-token matching via comma-anchored LIKE against a dedicated
// `tags_filter` column (index) or a 3-REPLACE column wrapper (fallback).
// `;`/`|` are literal, commas are the delimiter and are NEVER touched by
// tagColumnExpr so they survive as token boundaries.

// Escape SQLite LIKE wildcards `%`, `_` and the escape char `\` itself.
const escapeLike = (value) => String(value).replace(/[\\%_]/g, (c) => `\\${c}`)

// Flat column wrapper for the union fallback: lower, trim, strip `-` `_` and
// space. Commas are the delimiter and are NEVER touched, so they survive as
// token boundaries. NOTE: `;` and `|` are intentionally NOT converted to commas
// so the fallback tokenizes exactly like the library (comma-only).
const tagColumnExpr = (col) =>
  `REPLACE(REPLACE(REPLACE(LOWER(TRIM(COALESCE(${col}, ''))), '-', ''), '_', ''), ' ', '')`

// Asymmetry is explicit and stays paired: index binds normalizeTagText(tag),
// fallback binds stripSpaces(normalizeTagText(tag)) against tagColumnExpr(col).
const stripSpaces = (value) => String(value).replace(/\s+/g, '')

// Core predicate: comma-anchored LIKE with mandatory leading/trailing comma
// and COALESCE guard so `NOT(...)` never deletes untagged rows. Single
// `{sql, params}` shape used by both paths.
function tokenPredicate(columnExpr, token) {
  return {
    sql: `(',' || COALESCE(${columnExpr}, '') || ',') LIKE ? ESCAPE '\\'`,
    params: ['%,' + escapeLike(token) + ',%'],
  }
}

module.exports = { escapeLike, tagColumnExpr, stripSpaces, tokenPredicate }
