// Regression: the library/browse playtime badge and the Game Details "Total
// Playtime" row must read the SAME column in the SAME units. Atlas stores
// playtime in MINUTES (the xlibrary parser converts external seconds to
// minutes on import), and the detail view formats it as minutes. The badge
// resolver used to treat the value as SECONDS, so 135m of play rendered as
// "2m" — ~60x too small, and sub-hour playtimes were often wrong or blank.
//
// Write it against the unfixed behaviour first: with the seconds-based math,
// totalPlaytime: 135 produced "2m" (135s -> 2m 15s), and totalPlaytime: 45
// produced "0m" (45s -> 0m 45s -> 0m). Both assertions below fail on that
// code and pass once the badge reads minutes.
import { test, expect } from 'vitest'
import { resolveBannerField } from '../src/components/library/bannerLayout/bannerFieldResolvers.js'
import { formatPlaytime as detailFormatPlaytime } from '../src/components/detail/page/gameDetailUtils.js'

const badgePlaytime = (game) => resolveBannerField('playtime', game)

test('the library playtime badge reads playtime in minutes, not seconds', () => {
  // 135 minutes = 2h 15m. The old seconds math gave "2m".
  expect(badgePlaytime({ totalPlaytime: 135 }).value).toBe('2h 15m')
  // 45 minutes = 45m. The old seconds math gave "0m" (45s -> 0m).
  expect(badgePlaytime({ totalPlaytime: 45 }).value).toBe('45m')
  // 90 minutes = 1h 30m. The old seconds math gave "1m".
  expect(badgePlaytime({ totalPlaytime: 90 }).value).toBe('1h 30m')
  // Whole hours drop the zero minutes: 60 minutes = 1h.
  expect(badgePlaytime({ totalPlaytime: 60 }).value).toBe('1h')
})

test('the badge falls back to the snake_case column like the detail view', () => {
  // The DB column is total_playtime; the badge must read it as minutes too.
  expect(badgePlaytime({ total_playtime: 135 }).value).toBe('2h 15m')
})

// Fractional minutes: the old floor-then-round logic rendered 119.8 as
// "1h 60m" and 59.8 as "60m". Ceiling the total first keeps the badge
// consistent with the detail view and also prevents values like 0.4m from
// being hidden entirely (Math.round(0.4) === 0, Math.ceil(0.4) === 1).
test('the badge ceilings fractional minutes before splitting into hours and minutes', () => {
  expect(badgePlaytime({ totalPlaytime: 119.8 }).value).toBe('2h')
  expect(badgePlaytime({ totalPlaytime: 59.8 }).value).toBe('1h')
  expect(badgePlaytime({ totalPlaytime: 119.4 }).value).toBe('2h')
})

test('the badge stays hidden for empty playtime', () => {
  expect(badgePlaytime({ totalPlaytime: 0 }).visible).toBe(false)
  expect(badgePlaytime({ totalPlaytime: null }).visible).toBe(false)
  expect(badgePlaytime({}).visible).toBe(false)
})

test('the badge shows sub-minute playtime as at least 1m instead of hiding', () => {
  // Math.round(0.4) === 0 would hide the badge; Math.ceil(0.4) === 1 shows "1m".
  expect(badgePlaytime({ totalPlaytime: 0.4 }).value).toBe('1m')
  expect(badgePlaytime({ totalPlaytime: 0.1 }).value).toBe('1m')
  expect(badgePlaytime({ totalPlaytime: 1 }).value).toBe('1m')
})

// The two views must agree on the underlying figure. The badge is compact
// ("2h 15m") and the detail row is verbose ("2h 15m played"), so compare the
// numeric content rather than the exact string.
test('the badge and the detail view agree on the playtime figure', () => {
  for (const minutes of [45, 60, 90, 135, 600, 59.8, 119.4]) {
    const badge = badgePlaytime({ totalPlaytime: minutes }).value
    const detail = detailFormatPlaytime(minutes)
    // Strip the "played" suffix so the compact and verbose forms are comparable.
    expect(badge).toBe(detail.replace(/ played$/, ''))
  }
})