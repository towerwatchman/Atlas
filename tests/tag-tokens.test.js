import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import * as esm from '../src/utils/tagTokens.js'
const require_ = createRequire(import.meta.url)
const { normalizeTagText, buildTagsFilterValue, splitTagSources } =
  require_('../electron/db/tagTokens.js')

describe('Tag Tokens Unit Suite', () => {
  describe('normalizeTagText', () => {
    it('lowercases, collapses whitespace, maps - and _ to space', () => {
      expect(normalizeTagText('  Foo-Bar_BAZ   qux  ')).toBe('foo bar baz qux')
    })
    it('preserves non-ASCII Unicode and does full Unicode lowercase', () => {
      expect(normalizeTagText('  日本語-Tag_Test  ')).toBe('日本語 tag test')
      expect(normalizeTagText('  Élite  ')).toBe('élite')
    })
    it('collapses ALL whitespace (tabs/newlines), not just U+0020', () => {
      expect(normalizeTagText('foo\tbar\nbaz')).toBe('foo bar baz')
    })
  })

  describe('buildTagsFilterValue', () => {
    it('splits on comma only, trims, drops empty tokens', () => {
      const result = buildTagsFilterValue('Tag A, Tag-B', 'Tag_B, Tag C', null, '')
      expect(result).toBe('tag a,tag b,tag c')
    })
    it('keeps ; and | as literal characters inside a token (matches library)', () => {
      expect(buildTagsFilterValue('a;b', 'c|d')).toBe('a;b,c|d')
    })
    it('dedupes case-insensitively, first-seen order across fixed source order', () => {
      const result = buildTagsFilterValue('Alpha-Beta', 'alpha_beta', 'GAMMA', 'alpha beta')
      expect(result).toBe('alpha beta,gamma')
    })
    it('returns empty string when all sources are null/empty/whitespace or normalize to empty', () => {
      expect(buildTagsFilterValue(null, '', '   ', ' -_ ')).toBe('')
      expect(buildTagsFilterValue(' , , ')).toBe('')
    })
    it('keeps ; and | as literal — ";;||" is a single token, not empty', () => {
      expect(buildTagsFilterValue(';;||')).toBe(';;||')
    })
    it('does not split on / or & inside a token', () => {
      expect(buildTagsFilterValue('futa/trans, tease&denial')).toBe('futa/trans,tease&denial')
    })
  })

  describe('splitTagSources (comma-split, mirrors library getGameTagValues)', () => {
    it('splits each source on comma, trims, drops empties, dedupes', () => {
      expect(splitTagSources('Female Protagonist, Male', 'male protagonist')).toEqual([
        'female protagonist', 'male', 'male protagonist',
      ])
    })
  })
})

// The CJS electron mirror (electron/db/tagTokens.js) must stay byte-for-byte
// equivalent in behaviour to the ESM source of truth (src/utils/tagTokens.js).
// Both catalog-index and union-fallback SQL build predicates from these helpers,
// so any silent drift between the two copies would split index vs fallback
// results. This guard fails loudly instead.
describe('CJS mirror parity with ESM source of truth', () => {
  const cjs = require_('../electron/db/tagTokens.js')

  // The core tokenization the index/fallback SQL is built from — a drift here
  // silently splits index vs fallback results, so it must be guarded too.
  const rawTagSources = [
    null, '', '   ', ' -_ ', 'Tag A, Tag-B', 'Tag_B, Tag C', 'a;b', 'c|d',
    'futa/trans, futa/trans (avoidable)', '  Female  PROTAGONIST  ', ';;||',
    '100%', '日本語-Tag_Test',
  ]
  it('normalizeTagText matches', () => {
    for (const t of rawTagSources) expect(cjs.normalizeTagText(t)).toBe(esm.normalizeTagText(t))
  })
  it('splitTagSources matches', () => {
    for (const t of rawTagSources) expect(cjs.splitTagSources(t)).toEqual(esm.splitTagSources(t))
  })
  it('buildTagsFilterValue matches', () => {
    for (const t of rawTagSources) {
      expect(cjs.buildTagsFilterValue(t)).toBe(esm.buildTagsFilterValue(t))
    }
  })
  it('normalizeTagList matches', () => {
    const includes = ['male protagonist', 'ntr (avoidable)', 'futa/trans']
    expect(cjs.normalizeTagList(includes)).toEqual(esm.normalizeTagList(includes))
    expect(cjs.normalizeTagList(null)).toEqual(esm.normalizeTagList(null))
    expect(cjs.normalizeTagList('single')).toEqual(esm.normalizeTagList('single'))
  })
})
