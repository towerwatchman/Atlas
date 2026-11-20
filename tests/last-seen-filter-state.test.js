import { describe, it, expect } from 'vitest'
import { defaultFilters, normalizeFilterState } from '../src/hooks/useFilters.js'

// lastSeen is a catalog-only filter: 'startup' / 'tracked' pick which unseen
// titles to show, null means no constraint. The watermark number itself lives
// in main, so the renderer only ever carries the choice. Anything that is not
// one of the two legal strings normalizes back to null.

describe('lastSeen filter state', () => {
  it('defaults to null', () => {
    expect(defaultFilters.lastSeen).toBeNull()
  })

  it('is null when the key is absent', () => {
    expect(normalizeFilterState({}).lastSeen).toBeNull()
  })

  it('keeps the legal values', () => {
    expect(normalizeFilterState({ lastSeen: 'startup' }).lastSeen).toBe('startup')
    expect(normalizeFilterState({ lastSeen: 'tracked' }).lastSeen).toBe('tracked')
  })

  it('rewrites anything illegal to null', () => {
    expect(normalizeFilterState({ lastSeen: 'bogus' }).lastSeen).toBeNull()
    expect(normalizeFilterState({ lastSeen: 42 }).lastSeen).toBeNull()
    expect(normalizeFilterState({ lastSeen: '' }).lastSeen).toBeNull()
    expect(normalizeFilterState({ lastSeen: 'none' }).lastSeen).toBeNull()
  })

  // lastSeenFloor is the number main derives from the mode; the renderer must
  // never carry it. A saved filter that picked one up has to lose it on load.
  it('drops lastSeenFloor even alongside a legal mode', () => {
    const out = normalizeFilterState({ lastSeen: 'startup', lastSeenFloor: 999999 })
    expect(out.lastSeen).toBe('startup')
    expect(Object.prototype.hasOwnProperty.call(out, 'lastSeenFloor')).toBe(false)
  })

  it('drops lastSeenFloor when no mode is set', () => {
    const out = normalizeFilterState({ lastSeenFloor: 999999 })
    expect(out.lastSeen).toBeNull()
    expect(Object.prototype.hasOwnProperty.call(out, 'lastSeenFloor')).toBe(false)
  })
})
