import { describe, it, expect, beforeAll } from 'vitest'
import { createRequire } from 'node:module'
import * as esm from '../src/utils/urlIdExtractor.js'

// There are two copies of this extractor -- ESM for the renderer, CJS for the
// main process -- because they cannot share a module. The main-process copy is
// the one the database search actually runs, so testing only the renderer copy
// would leave the shipping code path uncovered. Every case below is therefore
// run against BOTH, and a change to one and not the other fails here.
const cjs = createRequire(import.meta.url)('../electron/db/urlIdExtractor.js')

const copies = [['renderer (src/utils)', esm], ['main process (electron/db)', cjs]]

const f95Cases = [
  ['https://f95zone.to/threads/abduction-final-tanoshiitake.310615/', '310615'],
  ['https://f95zone.to/threads/310615/', '310615'],
  ['f95zone.to/threads/slug.310615/', '310615'],
  ['f95zone.to/threads/310615/', '310615'],
  ['http://f95zone.to/threads/abduction-final-tanoshiitake-310615/', '310615'],
  ['https://www.f95zone.to/threads/310615/', '310615'],
  ['https://f95zone.to/threads/310615', '310615'],
  ['https://f95zone.to/threads/hurricane-v0-1-ultra-nova-games.310278/page-2', '310278'],
  ['https://f95zone.to/threads/310278/page-2', '310278'],
  ['HTTPS://F95ZONE.TO/THREADS/310615/', '310615'],
]

const lcCases = [
  ['https://lewdcorner.com/threads/lydias-new-life-v0-9-5-lewd-worlds.5913/', '5913'],
  ['https://lewdcorner.com/threads/5913/', '5913'],
  ['lewdcorner.com/threads/slug.5913/', '5913'],
  ['lewdcorner.com/threads/5913/', '5913'],
  ['http://lewdcorner.com/threads/5913/', '5913'],
  ['https://www.lewdcorner.com/threads/5913/', '5913'],
  ['https://lewdcorner.com/threads/5913', '5913'],
  ['https://lewdcorner.com/threads/slug.5913/page-2', '5913'],
]

const steamCases = [
  ['https://store.steampowered.com/app/4585540/Monster_Girl_Factory/', '4585540'],
  ['https://store.steampowered.com/app/4585540/', '4585540'],
  ['store.steampowered.com/app/4585540/', '4585540'],
  ['http://store.steampowered.com/app/4585540/', '4585540'],
  ['https://www.store.steampowered.com/app/4585540/', '4585540'],
  ['https://store.steampowered.com/app/4585540', '4585540'],
  ['https://store.steampowered.com/app/4585540/something', '4585540'],
]

const negativeCases = [
  'random text',
  'Monster Factory',
  '310615',
  'Pro. Hunter',
  'AliStudio/ KaguriPublisher',
  'path/to/something',
  'https://example.com/threads/123/',
  'https://store.steampowered.com/app/abc123/',
  'f95:12345',
  'id:12345',
  '',
  '   ',
  // Reach isLikelyUrl but match no pattern.
  'https://f95zone.to/about',
  'https://lewdcorner.com/forum',
  'https://store.steampowered.com/about',
  'https://f95zone.to/threads/',
  'https://lewdcorner.com/threads/',
  'https://store.steampowered.com/app/',
]

// A URL embedded in longer text is NOT a URL search. Before the patterns were
// anchored these matched, so typing a title with a link pasted after it
// silently became an ID search against the wrong field.
const embeddedCases = [
  'Half-Life 2 store.steampowered.com/app/220/',
  'check this https://f95zone.to/threads/slug.123/',
  'url: https://f95zone.to/threads/slug.123/',
  'title: https://f95zone.to/threads/slug.123/',
  'my notes about lewdcorner.com/threads/5913/',
  // These START with a recognised host, so isLikelyUrl passes and the
  // PATTERNS are what must reject them. Without that second anchor a query
  // string or redirect carrying a thread link would be read as an ID.
  'https://f95zone.to/about?next=https://f95zone.to/threads/slug.123/',
  'https://lewdcorner.com/search?q=lewdcorner.com/threads/5913/',
  'https://store.steampowered.com/search/?term=store.steampowered.com/app/220/',
]

describe.each(copies)('%s', (_label, mod) => {
  describe('isLikelyUrl', () => {
    it('is false for plain text', () => {
      for (const text of ['Monster Factory', '310615', 'f95:12345', '', '   ',
        'Pro. Hunter', 'AliStudio/ KaguriPublisher', 'random text with a . in it',
        'path/to/something']) {
        expect(mod.isLikelyUrl(text)).toBe(false)
      }
    })

    it('is true only for a recognised protocol or host at the START of the text', () => {
      for (const text of ['https://f95zone.to/threads/123', 'http://lewdcorner.com/threads/123',
        'www.store.steampowered.com/app/123', 'f95zone.to/threads/123',
        'store.steampowered.com/app/123', 'HTTPS://F95ZONE.TO/THREADS/123']) {
        expect(mod.isLikelyUrl(text)).toBe(true)
      }
      // Mid-string is not a URL, which is what keeps a title search a title search.
      expect(mod.isLikelyUrl('Half-Life 2 store.steampowered.com/app/220/')).toBe(false)
    })
  })

  describe('extractUrlId', () => {
    it('extracts F95Zone ids', () => {
      for (const [url, id] of f95Cases) {
        expect(mod.extractUrlId(url), url).toEqual({ field: 'f95Id', query: id })
      }
    })

    it('extracts LewdCorner ids', () => {
      for (const [url, id] of lcCases) {
        expect(mod.extractUrlId(url), url).toEqual({ field: 'lcId', query: id })
      }
    })

    it('extracts Steam ids', () => {
      for (const [url, id] of steamCases) {
        expect(mod.extractUrlId(url), url).toEqual({ field: 'steamId', query: id })
      }
    })

    it('returns null for text that is not a recognised URL', () => {
      for (const text of negativeCases) {
        expect(mod.extractUrlId(text), JSON.stringify(text)).toBeNull()
      }
    })

    it('returns null for a URL embedded in longer text', () => {
      for (const text of embeddedCases) {
        expect(mod.extractUrlId(text), JSON.stringify(text)).toBeNull()
      }
    })
  })
})

// The pair above proves each copy is correct in isolation. This proves they are
// the SAME, which is the failure mode a hand-maintained mirror actually has.
it('both copies return identical results for every case', () => {
  const everyInput = [
    ...f95Cases.map(([url]) => url),
    ...lcCases.map(([url]) => url),
    ...steamCases.map(([url]) => url),
    ...negativeCases,
    ...embeddedCases,
  ]
  for (const input of everyInput) {
    expect(cjs.extractUrlId(input), input).toEqual(esm.extractUrlId(input))
    expect(cjs.isLikelyUrl(input), input).toBe(esm.isLikelyUrl(input))
  }
})
