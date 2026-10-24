// ── Config sanitizer migration contracts ───────────────────────────────────
//
// sanitizeParsedConfig takes a parsed ini object and touches no disk, so these
// test what happens to a config.ini written by an older build.
//
// The LewdCorner shop URL is not a user setting any more: the tier scraper
// reads it from electron/config/lcTier.json, which ships with the code. The old
// config key is therefore retired and removed at startup like any deprecation,
// whatever value it holds. Rewriting it in place was the previous approach and
// could not work, because the INI reader ends the value at the '#' in the
// shipped default, so the key arrived as '/shop/index.php' and never matched.

import { test, expect, describe } from 'vitest'

const ini = require('ini')

const { sanitizeParsedConfig } = require('../electron/config/configSanitizer.js')
const { buildDefaultConfig } = require('../electron/config/configSchema.js')

// A real v3 config.ini fragment, parsed the way the app parses it. The value on
// disk carries the #user-ranks fragment; the parsed value does not.
const v3File = [
  '[Meta]',
  'configVersion=3',
  '[LewdCorner]',
  'lcUserTierPath=/shop/index.php#user-ranks',
  'lcProbeThreadId=14057',
  'lcCardClass=jblcEconomy-item',
  'lcBuyButtonClass=jblcEconomy-buyButton',
  'lcOwnedText=owned',
  '',
].join('\r\n')

describe('retired LewdCorner site keys', () => {
  const RETIRED = {
    lcUserTierPath: '/shop/index.php',
    lcProbeThreadId: '14057',
    lcCardClass: 'jblcEconomy-item',
    lcBuyButtonClass: 'jblcEconomy-buyButton',
    lcOwnedText: 'owned',
  }

  test('removes the keys from a real v3 config.ini', () => {
    const { config: cleaned, report } = sanitizeParsedConfig(ini.parse(v3File))
    for (const key of Object.keys(RETIRED)) {
      expect(cleaned.LewdCorner[key]).toBeUndefined()
      expect(report.removedKeys.some((k) => k.key === key)).toBe(true)
    }
    // The INI reader starts a comment at '#', so the shipped default arrives
    // here as the bare path.
    expect(report.removedKeys.find((k) => k.key === 'lcUserTierPath').value).toBe('/shop/index.php')
    expect(report.changed).toBe(true)
  })

  test('removes them whatever value they hold, including a custom one', () => {
    // Nobody edits these by hand, and the code no longer reads them, so a
    // custom value is as retired as the shipped one.
    const { config: cleaned } = sanitizeParsedConfig({
      Meta: { configVersion: 4 },
      LewdCorner: { ...RETIRED, lcUserTierPath: '/economy/?section=store&category=rank&custom=1' },
    })
    for (const key of Object.keys(RETIRED)) expect(cleaned.LewdCorner[key]).toBeUndefined()
  })

  test('a fresh config never contains them', () => {
    const lc = buildDefaultConfig().LewdCorner
    for (const key of Object.keys(RETIRED)) expect(lc).not.toHaveProperty(key)
  })
})
