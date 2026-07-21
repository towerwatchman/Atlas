// Contract for the game-properties layer (detail page). These pure helpers
// derive what the properties/details panels show: which version is default,
// install state, developer/language/date resolution, and Steam/GOG id mapping
// that gates the install/launch buttons. Subtle rules here (catalog entries have
// no mapped id; ISO dates must not be parseInt'd) have bitten before.

import { describe, it, expect } from 'vitest'
import {
  compareVersions,
  sortVersionsDesc,
  getInstalledVersions,
  getDefaultVersion,
  formatPlaytime,
  filterOutBanner,
  getSteamAppId,
  getMappedSteamAppId,
  getMappedGogId,
  isSteamGame,
  resolveDeveloper,
  formatLanguages,
  formatReleaseDate,
  splitCsv,
  htmlToText,
} from '../src/components/detail/page/gameDetailUtils.js'

describe('version comparison + selection', () => {
  it('compares dotted versions numerically', () => {
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1)
    expect(compareVersions('2.0', '1.9')).toBe(1)
    expect(compareVersions('1.0', '1.0')).toBe(0)
  })

  it('ignores a leading v and whitespace', () => {
    expect(compareVersions('v1.2', ' 1.2 ')).toBe(0)
  })

  it('sorts versions descending', () => {
    const out = sortVersionsDesc([{ version: '1.0' }, { version: '1.2' }, { version: '1.1' }])
    expect(out.map((v) => v.version)).toEqual(['1.2', '1.1', '1.0'])
  })

  it('getInstalledVersions keeps only installed', () => {
    const vs = [{ version: '1', isInstalled: true }, { version: '2', isInstalled: false }, { version: '3' }]
    // isInstalled !== false, so undefined counts as installed
    expect(getInstalledVersions(vs).map((v) => v.version)).toEqual(['1', '3'])
  })

  it('getDefaultVersion prefers the newest INSTALLED version', () => {
    const vs = [
      { version: '2.0', isInstalled: false },
      { version: '1.0', isInstalled: true },
    ]
    expect(getDefaultVersion(vs).version).toBe('1.0')
  })

  it('getDefaultVersion falls back to newest overall when none installed', () => {
    const vs = [{ version: '1.0', isInstalled: false }, { version: '2.0', isInstalled: false }]
    expect(getDefaultVersion(vs).version).toBe('2.0')
  })

  it('getDefaultVersion returns null for empty', () => {
    expect(getDefaultVersion([])).toBeNull()
  })
})

describe('formatPlaytime', () => {
  it('formats hours and minutes', () => {
    expect(formatPlaytime(0)).toBe('Not played')
    expect(formatPlaytime(45)).toBe('45m played')
    expect(formatPlaytime(60)).toBe('1h played')
    expect(formatPlaytime(135)).toBe('2h 15m played')
  })
  it('handles invalid input', () => {
    expect(formatPlaytime(null)).toBe('Not played')
    expect(formatPlaytime(-5)).toBe('Not played')
  })
})

describe('filterOutBanner', () => {
  it('removes the banner url from a preview list (by full url and filename)', () => {
    const urls = [
      'https://x/apps/1/header.jpg?t=1',
      'https://x/apps/1/ss_a.jpg',
    ]
    const out = filterOutBanner(urls, 'https://x/apps/1/header.jpg')
    expect(out).toEqual(['https://x/apps/1/ss_a.jpg'])
  })
  it('returns list unchanged when no banner', () => {
    expect(filterOutBanner(['a'], '')).toEqual(['a'])
  })
})

describe('Steam / GOG id mapping', () => {
  it('reads steam appid from various fields', () => {
    expect(getSteamAppId({ steam_appid: '440' })).toBe('440')
    expect(getSteamAppId({ steamId: 1091500 })).toBe('1091500')
  })
  it('reads steam appid from external_ids JSON', () => {
    expect(getSteamAppId({ external_ids: '{"steam_appid":"620"}' })).toBe('620')
  })
  it('getMappedSteamAppId is empty for catalog/wishlist/metadata-only entries', () => {
    expect(getMappedSteamAppId({ steam_appid: '440', isCatalogEntry: true })).toBe('')
    expect(getMappedSteamAppId({ steam_appid: '440', isWishlistEntry: true })).toBe('')
    expect(getMappedSteamAppId({ steam_appid: '440', isMetadataOnly: true })).toBe('')
    expect(getMappedSteamAppId({ steam_appid: '440' })).toBe('440')
  })
  it('isSteamGame reflects presence of an id', () => {
    expect(isSteamGame({ steam_appid: '440' })).toBe(true)
    expect(isSteamGame({})).toBe(false)
  })
  it('getMappedGogId behaves like steam for catalog entries', () => {
    expect(getMappedGogId({ gog_id: '123' })).toBe('123')
    expect(getMappedGogId({ gog_id: '123', isCatalogEntry: true })).toBe('')
  })
})

describe('resolveDeveloper', () => {
  it('prefers a real creator', () => {
    expect(resolveDeveloper({ creator: 'DevCo' })).toBe('DevCo')
  })
  it('falls back to steam/gog developer when creator is missing or Unknown', () => {
    expect(resolveDeveloper({ creator: 'Unknown', steam_developer: 'RealDev' })).toBe('RealDev')
    expect(resolveDeveloper({ steam_developer: 'RealDev' })).toBe('RealDev')
    expect(resolveDeveloper({ gog_developer: 'GogDev' })).toBe('GogDev')
  })
})

describe('formatLanguages', () => {
  it('joins a short list', () => {
    expect(formatLanguages('English, French')).toBe('English, French')
  })
  it('summarises when over the cap', () => {
    expect(formatLanguages('a,b,c,d,e,f', 5)).toBe('Multiple languages (6)')
  })
  it('empty for blank', () => {
    expect(formatLanguages('')).toBe('')
  })
})

describe('formatReleaseDate', () => {
  it('returns an ISO date verbatim (does NOT parseInt it)', () => {
    // Guards the 1996-08-31 -> parseInt=1996 -> 1970 bug.
    expect(formatReleaseDate({ release_date: '1996-08-31' })).toBe('1996-08-31')
  })
  it('renders a unix timestamp (seconds) as YYYY-MM-DD', () => {
    // 1704067200 = 2024-01-01 UTC
    expect(formatReleaseDate({ release_date: '1704067200' })).toBe('2024-01-01')
  })
  it('falls back to steam string then gog', () => {
    expect(formatReleaseDate({ steam_release_date: '12 Jun, 2024' })).toBe('12 Jun, 2024')
    expect(formatReleaseDate({ gog_release_date: '2023' })).toBe('2023')
  })
  it('returns null when nothing usable', () => {
    expect(formatReleaseDate({})).toBeNull()
  })
})

describe('splitCsv', () => {
  it('splits and trims, dropping blanks', () => {
    expect(splitCsv(' a, b ,, c ')).toEqual(['a', 'b', 'c'])
  })
  it('empty for blank', () => {
    expect(splitCsv('')).toEqual([])
  })
})

describe('htmlToText', () => {
  it('strips tags and decodes entities', () => {
    const out = htmlToText('<p>Hello&amp;world</p>')
    expect(out).toContain('Hello&world')
    expect(out).not.toContain('<p>')
  })
  it('is safe on empty input', () => {
    expect(typeof htmlToText('')).toBe('string')
  })
})
