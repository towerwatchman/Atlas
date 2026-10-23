// ── Config sanitizer migration contracts ───────────────────────────────────
//
// sanitizeParsedConfig takes a parsed ini object and touches no disk, so
// these test the v3 → v4 LewdCorner shop URL migration on its own: only the
// old shipped default gets rewritten, the report calls it a replacement, and
// an already-migrated config passes through unchanged.

import { test, expect, describe } from 'vitest'

const { sanitizeParsedConfig } = require('../electron/config/configSanitizer.js')
const { CONFIG_VERSION } = require('../electron/config/configSchema.js')

const OLD_TIER_PATH = '/shop/index.php#user-ranks'
const NEW_TIER_PATH = '/economy/?section=store&category=rank'

// A v3-shaped fragment; the sanitizer only ever reads parsed ini objects.
const config = (LewdCorner = {}) => ({
  Meta: { configVersion: 3 },
  LewdCorner: { lcThreadProbeEnabled: false, ...LewdCorner },
})

describe('v3 → v4 LewdCorner shop URL migration', () => {
  test('replaces the v3 default shop URL and reports it as a changed key', () => {
    const { config: cleaned, report } = sanitizeParsedConfig(config({ lcUserTierPath: OLD_TIER_PATH }))
    expect(cleaned.LewdCorner.lcUserTierPath).toBe(NEW_TIER_PATH)
    expect(cleaned.Meta.configVersion).toBe(CONFIG_VERSION)
    expect(report.changedKeys).toEqual([
      { section: 'LewdCorner', key: 'lcUserTierPath', value: OLD_TIER_PATH },
    ])
    // A rewritten key is not a removed key.
    expect(report.removedKeys).toEqual([])
  })

  test('leaves a customized lcUserTierPath alone', () => {
    // A custom value means the user set it; the key doubles as the rename
    // escape hatch, so leave it exactly as written.
    const custom = '/economy/?section=store&category=rank&custom=1'
    const { config: cleaned, report } = sanitizeParsedConfig(config({ lcUserTierPath: custom }))
    expect(cleaned.LewdCorner.lcUserTierPath).toBe(custom)
    expect(report.changedKeys).toEqual([])
  })

  test('still removes the retired prestige/pill keys alongside the migration', () => {
    const { config: cleaned, report } = sanitizeParsedConfig(config({
      lcUserTierPath: OLD_TIER_PATH,
      lcUserPrestigePath: '/shop/index.php?rank_bundle=prestige',
      lcStatusPillClass: 'statusPill',
      lcStatusPillOwnedText: 'owned',
    }))
    expect(cleaned.LewdCorner.lcUserPrestigePath).toBeUndefined()
    expect(cleaned.LewdCorner.lcStatusPillClass).toBeUndefined()
    expect(cleaned.LewdCorner.lcStatusPillOwnedText).toBeUndefined()
    for (const key of ['lcUserPrestigePath', 'lcStatusPillClass', 'lcStatusPillOwnedText']) {
      expect(report.removedKeys.some((k) => k.key === key)).toBe(true)
    }
  })

  test('a second run over migrated values changes nothing', () => {
    const { config: once } = sanitizeParsedConfig(config({ lcUserTierPath: OLD_TIER_PATH }))
    const { report: twice, config: clean } = sanitizeParsedConfig(once)
    expect(clean.LewdCorner.lcUserTierPath).toBe(NEW_TIER_PATH)
    expect(twice.changed).toBe(false)
    expect(twice.changedKeys).toEqual([])
  })
})
