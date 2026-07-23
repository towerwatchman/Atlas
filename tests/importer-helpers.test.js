// Contract for the importer's pure decision helpers — the logic that decides
// which source a scanned row belongs to, how versions are named, and how the
// structured library path is built. These run on every import; a silent
// regression here misfiles games or mislabels versions across the whole library.

import { describe, it, expect } from 'vitest'
import path from 'path'

const { __testables: T } = require('../electron/ipc/importer')

describe('sanitizePathSegment', () => {
  it('replaces filesystem-illegal characters', () => {
    expect(T.sanitizePathSegment('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j')
  })

  it('collapses whitespace and trims trailing dots/spaces', () => {
    expect(T.sanitizePathSegment('  hello   world .. ')).toBe('hello world')
  })

  it('falls back for empty input', () => {
    expect(T.sanitizePathSegment('')).toBe('Unknown')
    expect(T.sanitizePathSegment('   ')).toBe('Unknown')
  })

  it('escapes Windows reserved device names', () => {
    expect(T.sanitizePathSegment('CON')).toBe('_CON')
    expect(T.sanitizePathSegment('lpt1')).toBe('_lpt1')
    expect(T.sanitizePathSegment('nul.txt')).toBe('_nul.txt')
  })

  it('uses the provided fallback', () => {
    expect(T.sanitizePathSegment('', 'Fallback')).toBe('Fallback')
  })
})

describe('normalizeVersionName', () => {
  it('trims and preserves a real version', () => {
    expect(T.normalizeVersionName('  1.2.3 ')).toBe('1.2.3')
  })

  it('falls back to Unknown for blank', () => {
    expect(T.normalizeVersionName('')).toBe('Unknown')
    expect(T.normalizeVersionName(null)).toBe('Unknown')
    expect(T.normalizeVersionName(undefined)).toBe('Unknown')
  })

  it('honours a custom fallback', () => {
    expect(T.normalizeVersionName('', 'v0')).toBe('v0')
  })
})

describe('buildStructuredImportPath', () => {
  const game = { creator: 'DevCo', title: 'My Game', version: '1.0', engine: 'Unity', f95Id: '123' }

  it('expands tokens into path segments', () => {
    const out = T.buildStructuredImportPath('/lib', '{creator}/{title}/{version}', game)
    expect(out).toBe(path.join('/lib', 'DevCo', 'My Game', '1.0'))
  })

  it('sanitizes tokens that contain illegal characters', () => {
    const out = T.buildStructuredImportPath('/lib', '{title}', { title: 'Game: The/Sequel' })
    expect(out).toBe(path.join('/lib', 'Game_ The_Sequel'))
  })

  it('fills Unknown/Untitled for missing fields', () => {
    const out = T.buildStructuredImportPath('/lib', '{creator}/{title}', {})
    expect(out).toBe(path.join('/lib', 'Unknown', 'Untitled'))
  })

  it('ignores empty path segments in the format', () => {
    const out = T.buildStructuredImportPath('/lib', '{creator}//{title}/', game)
    expect(out).toBe(path.join('/lib', 'DevCo', 'My Game'))
  })

  it('supports lcid / lewdcornerid aliases', () => {
    const out = T.buildStructuredImportPath('/lib', '{lcid}', { lcId: 'LC9' })
    expect(out).toBe(path.join('/lib', 'LC9'))
  })
})

describe('source detection — Steam', () => {
  it('detects via sourceType', () => {
    expect(T.isSteamImportRow({ sourceType: 'steam' })).toBe(true)
  })
  it('detects via scanStatus', () => {
    expect(T.isSteamImportRow({ scanStatus: 'steamVersion' })).toBe(true)
  })
  it('detects via any appid field', () => {
    expect(T.isSteamImportRow({ steam_appid: 440 })).toBe(true)
    expect(T.isSteamImportRow({ steamId: '440' })).toBe(true)
  })
  it('is false for non-steam rows', () => {
    expect(T.isSteamImportRow({ sourceType: 'f95' })).toBe(false)
    expect(T.isSteamImportRow({})).toBe(false)
  })
  it('extracts a positive integer appid from any field', () => {
    expect(T.getSteamIdFromGame({ steam_appid: '440' })).toBe(440)
    expect(T.getSteamIdFromGame({ steamId: 1091500 })).toBe(1091500)
    expect(T.getSteamIdFromGame({})).toBeFalsy()
  })
})

describe('source detection — GOG', () => {
  it('detects via sourceType/scanStatus/id', () => {
    expect(T.isGogImportRow({ sourceType: 'gog' })).toBe(true)
    expect(T.isGogImportRow({ scanStatus: 'gogVersion' })).toBe(true)
    expect(T.isGogImportRow({ gog_id: 123 })).toBe(true)
  })
  it('does not misclassify a steam row as gog', () => {
    expect(T.isGogImportRow({ steam_appid: 440 })).toBe(false)
  })
})

describe('inferCatalogImportVersion', () => {
  it('pulls a version from the filename', () => {
    expect(T.inferCatalogImportVersion('/games/MyGame-v1.2.3/game.exe', {})).toContain('1.2.3')
  })

  it('recognises chapter-style versions', () => {
    const v = T.inferCatalogImportVersion('/games/Story-Chapter5/app.exe', {})
    expect(v.toLowerCase()).toContain('chapter')
  })

  it('falls back to catalog version when path has none', () => {
    expect(T.inferCatalogImportVersion('/games/plainfolder/game.exe', { latestVersion: '2.0' })).toBe('2.0')
  })

  it('returns Unknown when nothing is available', () => {
    expect(T.inferCatalogImportVersion('/games/plainfolder/game.exe', {})).toBe('Unknown')
  })
})

describe('archive detection', () => {
  const cfg = { Library: { extractionExtensions: 'zip,7z,rar' } }
  it('recognises configured archive extensions', () => {
    expect(T.isArchiveFilePath('/x/game.zip', cfg)).toBe(true)
    expect(T.isArchiveFilePath('/x/game.7z', cfg)).toBe(true)
    expect(T.isArchiveFilePath('/x/game.exe', cfg)).toBe(false)
  })
  it('flags rar specifically', () => {
    expect(T.isRarArchivePath('/x/game.rar')).toBe(true)
    expect(T.isRarArchivePath('/x/game.zip')).toBe(false)
  })
})

describe('clampInteger', () => {
  it('clamps within range', () => {
    expect(T.clampInteger('50', 10, 0, 100)).toBe(50)
    expect(T.clampInteger('500', 10, 0, 100)).toBe(100)
    expect(T.clampInteger('-5', 10, 0, 100)).toBe(0)
  })
  it('uses the fallback for non-numbers', () => {
    expect(T.clampInteger('abc', 10, 0, 100)).toBe(10)
  })
})

describe('getUrlHost', () => {
  it('extracts a lowercased host', () => {
    expect(T.getUrlHost('https://F95Zone.TO/threads/x')).toBe('f95zone.to')
  })
  it('returns empty for garbage', () => {
    expect(T.getUrlHost('not a url')).toBe('')
    expect(T.getUrlHost('')).toBe('')
  })
})
