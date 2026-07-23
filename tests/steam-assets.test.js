// Regression contract for Steam asset resolution + image dedup.
//
// These lock in behaviour we've repeatedly churned: GetItems is authoritative,
// the logo tries library_logo before the legacy logo key, 2x variants win, the
// convention filename is expanded (no ${FILENAME} leaks), and screenshots dedupe
// by Steam's embedded content hash. If a future change breaks any of these, this
// suite fails before it ships.

import { describe, it, expect, vi, afterEach } from 'vitest'

const {
  fetchStoreItemAssets,
  steamImageContentKey,
  normalizeAssetSourceOrder,
  DEFAULT_STEAM_ASSET_SOURCE_ORDER,
} = require('../electron/scanners/steamscanner')

const BASE = 'https://shared.fastly.steamstatic.com/store_item_assets/'

// Build a fake GetItems response for a given assets object.
function mockGetItems(assets) {
  global.fetch = vi.fn(async () => ({
    status: 200,
    json: async () => ({ response: { store_items: [{ assets }] } }),
  }))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('fetchStoreItemAssets — asset URL building', () => {
  it('expands asset_url_format and never leaks ${FILENAME}', async () => {
    mockGetItems({
      asset_url_format: 'steam/apps/440/${FILENAME}?t=123',
      header: 'h/header.jpg',
      library_hero_2x: 'h/library_hero_2x.jpg',
      library_capsule_2x: 'h/library_capsule_2x.jpg',
    })
    const a = await fetchStoreItemAssets(440)
    expect(a.header).toBe(`${BASE}steam/apps/440/h/header.jpg?t=123`)
    expect(a.hero).toBe(`${BASE}steam/apps/440/h/library_hero_2x.jpg?t=123`)
    expect(a.capsule).toBe(`${BASE}steam/apps/440/h/library_capsule_2x.jpg?t=123`)
    for (const v of [a.header, a.hero, a.capsule]) {
      expect(v).not.toContain('${FILENAME}')
    }
  })

  it('prefers 2x variants over 1x when both present', async () => {
    mockGetItems({
      asset_url_format: 'steam/apps/1/${FILENAME}',
      library_hero: 'h/library_hero.jpg',
      library_hero_2x: 'h/library_hero_2x.jpg',
      library_capsule: 'h/library_capsule.jpg',
      library_capsule_2x: 'h/library_capsule_2x.jpg',
    })
    const a = await fetchStoreItemAssets(1)
    expect(a.hero).toContain('library_hero_2x.jpg')
    expect(a.capsule).toContain('library_capsule_2x.jpg')
  })

  it('resolves the logo from library_logo (current key)', async () => {
    mockGetItems({
      asset_url_format: 'steam/apps/2/${FILENAME}',
      library_logo: 'h/logo.png',
    })
    const a = await fetchStoreItemAssets(2)
    expect(a.logo).toBe(`${BASE}steam/apps/2/h/logo.png`)
  })

  it('falls back to the legacy logo key when library_logo is absent', async () => {
    mockGetItems({
      asset_url_format: 'steam/apps/3/${FILENAME}',
      logo: 'h/logo.png',
    })
    const a = await fetchStoreItemAssets(3)
    expect(a.logo).toBe(`${BASE}steam/apps/3/h/logo.png`)
  })

  it('returns empty logo (not a broken URL) when no logo key exists', async () => {
    // This is the "Kelly's Family" class of game: GetItems omits the logo
    // entirely. We must NOT fabricate a URL here — an empty string lets the
    // hero fall back to the title text instead of showing a broken image.
    mockGetItems({
      asset_url_format: 'steam/apps/4/${FILENAME}',
      header: 'h/header.jpg',
      library_hero_2x: 'h/library_hero_2x.jpg',
    })
    const a = await fetchStoreItemAssets(4)
    expect(a.logo).toBe('')
  })

  it('captures logo_position when present', async () => {
    mockGetItems({
      asset_url_format: 'steam/apps/5/${FILENAME}',
      library_logo: 'h/logo.png',
      logo_position: { pinned_position: 'BottomLeft', width_pct: 40, height_pct: 30 },
    })
    const a = await fetchStoreItemAssets(5)
    expect(a.logoPosition).toEqual({ pinned: 'BottomLeft', widthPct: 40, heightPct: 30 })
  })

  it('throws a rate_limited error on HTTP 429', async () => {
    global.fetch = vi.fn(async () => ({ status: 429, json: async () => ({}) }))
    await expect(fetchStoreItemAssets(6)).rejects.toMatchObject({ code: 'rate_limited' })
  })

  it('returns {} when the response has no assets', async () => {
    global.fetch = vi.fn(async () => ({ status: 200, json: async () => ({ response: { store_items: [{}] } }) }))
    const a = await fetchStoreItemAssets(7)
    expect(a).toEqual({})
  })
})

describe('normalizeAssetSourceOrder — GetItems is authoritative', () => {
  it('default order puts getitems first', () => {
    expect(DEFAULT_STEAM_ASSET_SOURCE_ORDER[0]).toBe('getitems')
  })

  it('falls back to default for empty/invalid input', () => {
    expect(normalizeAssetSourceOrder(undefined)).toEqual(DEFAULT_STEAM_ASSET_SOURCE_ORDER)
    expect(normalizeAssetSourceOrder('')).toEqual(DEFAULT_STEAM_ASSET_SOURCE_ORDER)
  })

  it('parses a comma string and keeps only known sources', () => {
    const out = normalizeAssetSourceOrder('fastly,akamaihd')
    expect(out).toContain('fastly')
    expect(out).toContain('akamaihd')
  })
})

describe('steamImageContentKey — dedupe by embedded content hash', () => {
  it('treats the same image at different ?t= timestamps as one', () => {
    const a = 'https://x/steam/apps/1/ss_0002f18563d313bdd1d82c725d411408ebf762b0.1920x1080.jpg?t=111'
    const b = 'https://x/steam/apps/1/ss_0002f18563d313bdd1d82c725d411408ebf762b0.1920x1080.jpg?t=999'
    expect(steamImageContentKey(a)).toBe(steamImageContentKey(b))
  })

  it('treats the same image on different CDN hosts as one', () => {
    const fastly = 'https://shared.fastly.steamstatic.com/steam/apps/1/ss_abcdef0123456789abcdef0123456789abcdef01.jpg'
    const akamai = 'https://steamcdn-a.akamaihd.net/steam/apps/1/ss_abcdef0123456789abcdef0123456789abcdef01.jpg'
    expect(steamImageContentKey(fastly)).toBe(steamImageContentKey(akamai))
  })

  it('treats different images as distinct', () => {
    const a = 'https://x/ss_1111111111111111111111111111111111111111.jpg'
    const b = 'https://x/ss_2222222222222222222222222222222222222222.jpg'
    expect(steamImageContentKey(a)).not.toBe(steamImageContentKey(b))
  })

  it('is stable for empty/garbage input', () => {
    expect(steamImageContentKey('')).toBe('')
    expect(typeof steamImageContentKey(null)).toBe('string')
  })
})
