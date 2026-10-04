import { describe, it, expect } from 'vitest'
import { selectedSteamAppId, seasonLogoOverride } from '../src/components/detail/page/gameDetailUtils.js'

// Per-season Steam logo: the hero already re-resolves per selected season
// (heroOverride); the logo overlay never did, so every season wore Season 1's
// logo. These helpers drive the logo override the same way.
describe('season logo override helpers', () => {
  const steamVersion = (over = {}) => ({
    version: 'Season 2',
    version_id: 2,
    source: 'steam',
    source_app_id: '1754870',
    ...over,
  })

  it('reads the selected steam version appid', () => {
    expect(selectedSteamAppId(steamVersion())).toBe('1754870')
  })

  it('reads the camelCase appid spelling', () => {
    expect(selectedSteamAppId({ source: 'steam', sourceAppId: '2749380' })).toBe('2749380')
  })

  it('returns null for non-steam versions', () => {
    expect(selectedSteamAppId({ source: 'f95', source_app_id: '1' })).toBeNull()
  })

  it('returns null with no version selected', () => {
    expect(selectedSteamAppId(null)).toBeNull()
    expect(selectedSteamAppId(undefined)).toBeNull()
  })

  it('builds the season logo url for a steam version', () => {
    expect(seasonLogoOverride(steamVersion())).toBe(
      'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1754870/logo.png',
    )
  })

  it('builds no logo override without a steam version', () => {
    expect(seasonLogoOverride({ source: 'f95' })).toBeNull()
    expect(seasonLogoOverride(null)).toBeNull()
  })
})
