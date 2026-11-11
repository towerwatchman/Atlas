// ── Resolve config defaults ──────────────────────────────────────────────────
//
// showWindow defaults to false so existing installs keep the hidden behaviour,
// and a stored true must survive mergeWithDefaults.

import { test, expect, describe } from 'vitest'

const { buildDefaultConfig, mergeWithDefaults } = require('../electron/config/configSchema.js')

describe('Resolve section defaults', () => {
  test('showWindow is false in a fresh config', () => {
    expect(buildDefaultConfig().Resolve.showWindow).toBe(false)
  })

  test('mergeWithDefaults preserves an existing showWindow: true', () => {
    const merged = mergeWithDefaults(
      { Resolve: { showWindow: 'true' } },
      buildDefaultConfig(),
    )
    expect(merged.Resolve.showWindow).toBe(true)
  })
})
