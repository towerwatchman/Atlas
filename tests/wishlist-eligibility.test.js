// Installed titles cannot be added to the wishlist, but an existing entry must
// stay removable so the toggle can clear it.

import { describe, it, expect } from 'vitest'
import { isGameInstalled, canToggleWishlist } from '../src/utils/wishlistPayload.js'

describe('isGameInstalled', () => {
  it('recognizes each local-record field', () => {
    expect(isGameInstalled({ localRecordId: 12 })).toBe(true)
    expect(isGameInstalled({ local_record_id: 12 })).toBe(true)
    expect(isGameInstalled({ installedRecordId: 12 })).toBe(true)
  })

  it('recognizes the boolean and numeric installed flags', () => {
    expect(isGameInstalled({ isInstalled: true })).toBe(true)
    expect(isGameInstalled({ is_installed: 1 })).toBe(true)
    expect(isGameInstalled({ is_installed: true })).toBe(true)
    expect(isGameInstalled({ hasInstalledVersion: true })).toBe(true)
  })

  it('reports uninstalled when no install signal is present', () => {
    expect(isGameInstalled({ title: 'Foo' })).toBe(false)
    expect(isGameInstalled()).toBe(false)
  })
})

describe('canToggleWishlist', () => {
  it('allows an uninstalled game', () => {
    expect(canToggleWishlist({ title: 'Foo' })).toBe(true)
  })

  it('blocks an installed game without a wishlist entry', () => {
    expect(canToggleWishlist({ localRecordId: 12 })).toBe(false)
    expect(canToggleWishlist({ is_installed: 1 })).toBe(false)
  })

  it('allows removing an installed game that is already wishlisted', () => {
    expect(canToggleWishlist({ localRecordId: 12, isWishlisted: true })).toBe(true)
  })
})
