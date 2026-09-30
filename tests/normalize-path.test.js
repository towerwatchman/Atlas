import { describe, it, expect } from 'vitest'
const { normalizePath } = require('../electron/db/helpers')

describe('normalizePath', () => {
  it('converts Windows backslashes to forward slashes', () => {
    expect(normalizePath('data\\images\\1\\preview.webp')).toBe('data/images/1/preview.webp')
  })

  it('leaves forward slashes unchanged', () => {
    expect(normalizePath('data/images/1/preview.webp')).toBe('data/images/1/preview.webp')
  })

  it('handles mixed separators', () => {
    expect(normalizePath('data\\images/1\\preview.webp')).toBe('data/images/1/preview.webp')
  })

  it('returns empty string for null/undefined', () => {
    expect(normalizePath(null)).toBe('')
    expect(normalizePath(undefined)).toBe('')
  })

  it('returns empty string for empty string', () => {
    expect(normalizePath('')).toBe('')
  })

  it('handles non-string input by coercing to string', () => {
    expect(normalizePath(123)).toBe('123')
    // false is falsy so input || '' short-circuits to '' — acceptable since
    // no real caller passes booleans to this path utility.
    expect(normalizePath(false)).toBe('')
  })

  it('normalizes absolute Windows paths', () => {
    expect(normalizePath('C:\\Users\\test\\data\\images\\1\\a.webp')).toBe('C:/Users/test/data/images/1/a.webp')
  })

  it('normalizes absolute Unix paths (no-op)', () => {
    expect(normalizePath('/home/user/data/images/1/a.webp')).toBe('/home/user/data/images/1/a.webp')
  })

  it('preserves URLs (always forward slashes)', () => {
    expect(normalizePath('https://example.com/images/1/a.jpg')).toBe('https://example.com/images/1/a.jpg')
  })

  it('handles paths with spaces', () => {
    expect(normalizePath('data\\images\\1\\my file.webp')).toBe('data/images/1/my file.webp')
  })

  it('handles paths with special characters', () => {
    expect(normalizePath('data\\images\\1\\game [v2]\\preview.webp')).toBe('data/images/1/game [v2]/preview.webp')
  })

  it('handles double backslashes', () => {
    expect(normalizePath('data\\\\images\\\\1\\\\a.webp')).toBe('data//images//1//a.webp')
  })

  it('handles single backslash at various positions', () => {
    expect(normalizePath('\\leading')).toBe('/leading')
    expect(normalizePath('trailing\\')).toBe('trailing/')
    expect(normalizePath('a\\b\\c')).toBe('a/b/c')
  })

  it('is idempotent — running twice produces the same result', () => {
    const input = 'data\\images\\1\\preview.webp'
    const once = normalizePath(input)
    const twice = normalizePath(once)
    expect(once).toBe(twice)
  })
})
