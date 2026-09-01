import { test, expect } from 'vitest'
import { filterGamesWithState, normalizeFilterState, getDefaultSortDirectionForSort } from '../src/hooks/useFilters.js'
import { normalizeGameForRenderer } from '../src/utils/gameDisplay.js'

describe('Date Added sort and filter', () => {
  const nowSec = Math.floor(Date.now() / 1000)
  const daySec = 86400

  const games = [
    { record_id: 1, title: 'Old Game', dateAdded: nowSec - 100 * daySec, hasInstalledVersion: true },
    { record_id: 2, title: 'Recent Game', dateAdded: nowSec - 2 * daySec, hasInstalledVersion: true },
    { record_id: 3, title: 'Month Ago Game', dateAdded: nowSec - 25 * daySec, hasInstalledVersion: true },
    { record_id: 4, title: 'Undated Game', dateAdded: null, hasInstalledVersion: true },
  ]

  test('getDefaultSortDirectionForSort defaults dateAdded to desc', () => {
    expect(getDefaultSortDirectionForSort('dateAdded')).toBe('desc')
  })

  test('sorts by dateAdded descending (newest additions first)', () => {
    const filters = normalizeFilterState({ sort: 'dateAdded', sortDirection: 'desc' })
    const sorted = filterGamesWithState(games, filters)
    const titles = sorted.map((g) => g.title)
    // Recent (2d ago) -> Month Ago (25d ago) -> Old (100d ago) -> Undated (null at end)
    expect(titles).toEqual(['Recent Game', 'Month Ago Game', 'Old Game', 'Undated Game'])
  })

  test('sorts by dateAdded ascending (oldest additions first)', () => {
    const filters = normalizeFilterState({ sort: 'dateAdded', sortDirection: 'asc' })
    const sorted = filterGamesWithState(games, filters)
    const titles = sorted.map((g) => g.title)
    // Old (100d ago) -> Month Ago (25d ago) -> Recent (2d ago) -> Undated at end
    expect(titles).toEqual(['Old Game', 'Month Ago Game', 'Recent Game', 'Undated Game'])
  })

  test('tie breaker falls back to alphabetical title sort', () => {
    const sameDate = [
      { record_id: 10, title: 'Zebra', dateAdded: nowSec - 10 * daySec, hasInstalledVersion: true },
      { record_id: 11, title: 'Apple', dateAdded: nowSec - 10 * daySec, hasInstalledVersion: true },
      { record_id: 12, title: 'Mango', dateAdded: nowSec - 10 * daySec, hasInstalledVersion: true },
    ]
    const filters = normalizeFilterState({ sort: 'dateAdded', sortDirection: 'desc' })
    const sorted = filterGamesWithState(sameDate, filters)
    expect(sorted.map((g) => g.title)).toEqual(['Apple', 'Mango', 'Zebra'])
  })

  test('filters by dateAdded with 7d range', () => {
    const filters = normalizeFilterState({ dateField: 'dateAdded', dateRange: '7d' })
    const filtered = filterGamesWithState(games, filters)
    expect(filtered.map((g) => g.title)).toEqual(['Recent Game'])
  })

  test('filters by dateAdded with 30d range', () => {
    const filters = normalizeFilterState({
      dateField: 'dateAdded',
      dateRange: '30d',
      sort: 'dateAdded',
      sortDirection: 'desc',
    })
    const filtered = filterGamesWithState(games, filters)
    expect(filtered.map((g) => g.title)).toEqual(['Recent Game', 'Month Ago Game'])
  })

  test('earliest version timestamp represents dateAdded while latest represents lastInstalled', () => {
    // Simulates versions aggregation in versions.js
    const toFiniteNumber = (val, fallback = 0) => {
      const num = Number(val)
      return Number.isFinite(num) ? num : fallback
    }
    const minPositiveNumber = (values = []) =>
      values.reduce((min, value) => {
        const number = toFiniteNumber(value, 0)
        if (number <= 0) return min
        return min === 0 ? number : Math.min(min, number)
      }, 0)
    const maxPositiveNumber = (values = []) =>
      values.reduce((max, value) => {
        const number = toFiniteNumber(value, 0)
        return number > max ? number : max
      }, 0)

    const allVersions = [
      { version: 'v1.0', date_added: 1700000000 },
      { version: 'v1.1', date_added: 1705000000 },
      { version: 'v2.0', date_added: 1710000000 },
    ]

    const dateAdded = minPositiveNumber(allVersions.map((v) => v.date_added))
    const lastInstalled = maxPositiveNumber(allVersions.map((v) => v.date_added))

    expect(dateAdded).toBe(1700000000)
    expect(lastInstalled).toBe(1710000000)
    expect(dateAdded).toBeLessThan(lastInstalled)
  })

  test('wishlist entries map flagged_at to dateAdded and sort correctly', () => {
    const rawWishlist = [
      { record_id: 101, title: 'Old Wishlist', flagged_at: nowSec - 90 * daySec, isWishlistEntry: true },
      { record_id: 102, title: 'Fresh Wishlist', flagged_at: nowSec - 1 * daySec, isWishlistEntry: true },
      { record_id: 103, title: 'Mid Wishlist', flagged_at: nowSec - 20 * daySec, isWishlistEntry: true },
    ]

    const normalizedWishlist = rawWishlist.map(normalizeGameForRenderer)
    expect(normalizedWishlist[0].dateAdded).toBe(nowSec - 90 * daySec)
    expect(normalizedWishlist[1].dateAdded).toBe(nowSec - 1 * daySec)

    // Sort descending
    const descSorted = filterGamesWithState(normalizedWishlist, normalizeFilterState({ sort: 'dateAdded', sortDirection: 'desc' }))
    expect(descSorted.map((g) => g.title)).toEqual(['Fresh Wishlist', 'Mid Wishlist', 'Old Wishlist'])

    // Sort ascending
    const ascSorted = filterGamesWithState(normalizedWishlist, normalizeFilterState({ sort: 'dateAdded', sortDirection: 'asc' }))
    expect(ascSorted.map((g) => g.title)).toEqual(['Old Wishlist', 'Mid Wishlist', 'Fresh Wishlist'])

    // Filter 30d
    const filtered = filterGamesWithState(normalizedWishlist, normalizeFilterState({ dateField: 'dateAdded', dateRange: '30d' }))
    expect(filtered.map((g) => g.title)).toEqual(['Fresh Wishlist', 'Mid Wishlist'])
  })
})

