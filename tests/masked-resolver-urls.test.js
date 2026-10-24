import { describe, it, expect } from 'vitest'

// A destination is only usable if it can actually be downloaded. The Patreon
// case that reached production: the user clicked the support banner in the
// revealed window, the site opened a popup, and the resolver accepted that page
// as the resolved link. The parser already knows which hosts are never files;
// candidate selection has to consult it.

const { pickBestCandidate } = require('../electron/downloads/maskedResolverUrls.js')

const GATE = ['f95zone.to']

describe('pickBestCandidate non-download hosts', () => {
  it('refuses a funding page as the destination', () => {
    const best = pickBestCandidate(
      [{ source: 'window-open', url: 'https://www.patreon.com/someone', fragment: false }],
      GATE,
    )
    expect(best).toBe(null)
  })

  it('keeps the real mirror when a denied host was seen first', () => {
    const best = pickBestCandidate(
      [
        { source: 'window-open', url: 'https://www.patreon.com/someone', fragment: false },
        { source: 'will-navigate', url: 'https://pixeldrain.com/u/abc', fragment: false },
      ],
      GATE,
    )
    expect(best.url).toBe('https://pixeldrain.com/u/abc')
  })

  it('still accepts a host the parser has never seen', () => {
    const best = pickBestCandidate(
      [{ source: 'will-navigate', url: 'https://dropmefiles.com/abc', fragment: false }],
      GATE,
    )
    expect(best.url).toBe('https://dropmefiles.com/abc')
  })

  it('keeps fragment priority between two accepted hosts', () => {
    const best = pickBestCandidate(
      [
        { source: 'web-request', url: 'https://mega.nz/file/abc', fragment: false },
        { source: 'will-navigate', url: 'https://mega.nz/file/abc#Zm9vYmFy', fragment: true },
      ],
      GATE,
    )
    expect(best.fragment).toBe(true)
  })
})
