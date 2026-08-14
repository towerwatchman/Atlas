import { describe, it, expect } from 'vitest'
import { extractUrlId, isLikelyUrl } from '../src/utils/urlIdExtractor.js'

describe('isLikelyUrl', () => {
  it('returns false for plain text without known URL indicators', () => {
    expect(isLikelyUrl('Monster Factory')).toBe(false)
    expect(isLikelyUrl('310615')).toBe(false)
    expect(isLikelyUrl('f95:12345')).toBe(false)
    expect(isLikelyUrl('')).toBe(false)
    expect(isLikelyUrl('   ')).toBe(false)
    expect(isLikelyUrl('Pro. Hunter')).toBe(false)
    expect(isLikelyUrl('AliStudio/ KaguriPublisher')).toBe(false)
    expect(isLikelyUrl('random text with a . in it')).toBe(false)
    expect(isLikelyUrl('path/to/something')).toBe(false)
  })

  it('returns true only for inputs containing known domains or protocols', () => {
    expect(isLikelyUrl('https://f95zone.to/threads/123')).toBe(true)
    expect(isLikelyUrl('http://lewdcorner.com/threads/123')).toBe(true)
    expect(isLikelyUrl('www.store.steampowered.com/app/123')).toBe(true)
    expect(isLikelyUrl('f95zone.to/threads/123')).toBe(true)
    expect(isLikelyUrl('store.steampowered.com/app/123')).toBe(true)
    expect(isLikelyUrl('HTTPS://F95ZONE.TO/THREADS/123')).toBe(true)
  })
})

describe('extractUrlId', () => {
  const f95Cases = [
    ['https://f95zone.to/threads/abduction-final-tanoshiitake.310615/', 'f95Id', '310615'],
    ['https://f95zone.to/threads/310615/', 'f95Id', '310615'],
    ['f95zone.to/threads/slug.310615/', 'f95Id', '310615'],
    ['f95zone.to/threads/310615/', 'f95Id', '310615'],
    ['http://f95zone.to/threads/abduction-final-tanoshiitake-310615/', 'f95Id', '310615'],
    ['https://www.f95zone.to/threads/310615/', 'f95Id', '310615'],
    ['https://f95zone.to/threads/310615', 'f95Id', '310615'],
    ['https://f95zone.to/threads/hurricane-v0-1-ultra-nova-games.310278/page-2', 'f95Id', '310278'],
    ['https://f95zone.to/threads/310278/page-2', 'f95Id', '310278'],
  ]

  const lcCases = [
    ['https://lewdcorner.com/threads/lydias-new-life-v0-9-5-lewd-worlds.5913/', 'lcId', '5913'],
    ['https://lewdcorner.com/threads/5913/', 'lcId', '5913'],
    ['lewdcorner.com/threads/slug.5913/', 'lcId', '5913'],
    ['lewdcorner.com/threads/5913/', 'lcId', '5913'],
    ['http://lewdcorner.com/threads/5913/', 'lcId', '5913'],
    ['https://www.lewdcorner.com/threads/5913/', 'lcId', '5913'],
    ['https://lewdcorner.com/threads/5913', 'lcId', '5913'],
    ['https://lewdcorner.com/threads/slug.5913/page-2', 'lcId', '5913'],
  ]

  const steamCases = [
    ['https://store.steampowered.com/app/4585540/Monster_Girl_Factory/', 'steamId', '4585540'],
    ['https://store.steampowered.com/app/4585540/', 'steamId', '4585540'],
    ['store.steampowered.com/app/4585540/', 'steamId', '4585540'],
    ['http://store.steampowered.com/app/4585540/', 'steamId', '4585540'],
    ['https://www.store.steampowered.com/app/4585540/', 'steamId', '4585540'],
    ['https://store.steampowered.com/app/4585540', 'steamId', '4585540'],
    ['https://store.steampowered.com/app/4585540/something', 'steamId', '4585540'],
  ]

  const negativeCases = [
    'random text',
    'https://example.com/threads/123/',
    'https://store.steampowered.com/app/abc123/',
    'f95:12345',
    'id:12345',
    '',
    '   ',
    // passes isLikelyUrl but no regex matches
    'https://f95zone.to/about',
    'https://lewdcorner.com/forum',
    'https://store.steampowered.com/about',
    'https://f95zone.to/threads/',
    'https://lewdcorner.com/threads/',
    'https://store.steampowered.com/app/',
  ]

  for (const [url, expectedField, expectedId] of f95Cases) {
    it(`extracts F95Zone id from ${url}`, () => {
      const result = extractUrlId(url)
      expect(result).toEqual({ field: expectedField, query: expectedId })
    })
  }

  for (const [url, expectedField, expectedId] of lcCases) {
    it(`extracts LewdCorner id from ${url}`, () => {
      const result = extractUrlId(url)
      expect(result).toEqual({ field: expectedField, query: expectedId })
    })
  }

  for (const [url, expectedField, expectedId] of steamCases) {
    it(`extracts Steam id from ${url}`, () => {
      const result = extractUrlId(url)
      expect(result).toEqual({ field: expectedField, query: expectedId })
    })
  }

  for (const text of negativeCases) {
    it(`returns null for non-matching text: ${text}`, () => {
      expect(extractUrlId(text)).toBeNull()
    })
  }
})
