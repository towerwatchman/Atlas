import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  PERSONAL_RATING_CATEGORIES as UI_CATEGORIES,
  computeRatingAverage as uiAverage,
  computeOnlineRating as uiOnline,
} from '../src/utils/ratingCategories.js'
const db = require('../electron/db/ratingCategories.js')

// Main is CommonJS and the renderer an ESM bundle, so the category list is
// duplicated. If the two drift, the modal writes keys the database has no columns
// for and ratings vanish silently.
test('the renderer and database category lists are identical', () => {
  expect(UI_CATEGORIES.map((c) => c.key)).toEqual(db.PERSONAL_RATING_CATEGORIES.map((c) => c.key))
  expect(UI_CATEGORIES.map((c) => c.gameKey)).toEqual(
    db.PERSONAL_RATING_CATEGORIES.map((c) => c.gameKey),
  )
  expect(UI_CATEGORIES.map((c) => c.label)).toEqual(
    db.PERSONAL_RATING_CATEGORIES.map((c) => c.label),
  )
})

test('fappability is gone from the rating', () => {
  expect(db.PERSONAL_RATING_COLUMNS).not.toContain('fappability')
  expect(UI_CATEGORIES.map((c) => c.key)).not.toContain('fappability')
  expect(db.RETIRED_RATING_COLUMNS).toContain('fappability')
  // Never referenced by the generated average, even though the column remains.
  expect(db.buildRatingAverageSql('lr')).not.toContain('fappability')
})

test('the added categories are present', () => {
  for (const key of ['characters', 'sound', 'writing', 'polish', 'replayability']) {
    expect(db.PERSONAL_RATING_COLUMNS).toContain(key)
  }
})

// Requirement 4: a category counts only when above 0.
test('only categories above zero count towards the average', () => {
  expect(db.computeRatingAverage({})).toBeNull()
  expect(db.computeRatingAverage({ story: 0, graphics: 0 })).toBeNull()
  expect(db.computeRatingAverage({ story: 8, graphics: 6 })).toBe(7)
  // The key case: zeros must not drag it down. Dividing by all eight would give
  // 1.75 here instead of 7.
  expect(db.computeRatingAverage({ story: 8, graphics: 6, gameplay: 0, sound: 0 })).toBe(7)
})

test('the renderer average agrees with the database average', () => {
  for (const sample of [
    {}, { story: 0 }, { story: 8, graphics: 6 },
    { story: 8, graphics: 6, gameplay: 0 }, { story: 10, replayability: 3, polish: 7 },
  ]) {
    expect(uiAverage(sample)).toBe(db.computeRatingAverage(sample))
  }
})

test('values are clamped to 0-10 and rounded', () => {
  expect(db.normalizeRatingValue(99)).toBe(10)
  expect(db.normalizeRatingValue(-5)).toBe(0)
  expect(db.normalizeRatingValue('7')).toBe(7)
  expect(db.normalizeRatingValue('')).toBeNull()
  expect(db.normalizeRatingValue(null)).toBeNull()
})

// Online rating is the MEAN of the two sources, converted from 0-5 to 0-10.
test('the online rating averages F95 and LewdCorner on the 0-10 scale', () => {
  expect(db.computeOnlineRating({ f95Rating: 4.5, lewdcornerRating: 3.5 })).toBe(8)
  expect(db.computeOnlineRating({ f95Rating: 4.2 })).toBe(8.4)
  expect(db.computeOnlineRating({ lewdcornerRating: 5 })).toBe(10)
  expect(db.computeOnlineRating({})).toBeNull()
  // A zero score means "not scored", not a real zero.
  expect(db.computeOnlineRating({ f95Rating: 0, lewdcornerRating: 4 })).toBe(8)
})

test('the renderer online rating agrees with the database one', () => {
  for (const sample of [
    { f95Rating: 4.5, lewdcornerRating: 3.5 }, { f95Rating: 4.2 }, {}, { f95Rating: 0 },
  ]) {
    expect(uiOnline(sample)).toBe(db.computeOnlineRating(sample))
  }
})

// The average SQL was hand-written in two files and had drifted in both.
test('the average SQL is generated, not hand-written', () => {
  for (const file of ['electron/db/versions.js', 'electron/db/catalogIndex.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
    expect(src).toContain('buildRatingAverageSql')
    expect(src).not.toMatch(/COALESCE\(\w+\.fappability/)
  }
})

test('the modal explains the averaging rule', () => {
  const modal = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'components', 'detail', 'RatingModal.jsx'),
    'utf8',
  )
  expect(modal).toMatch(/Only categories above 0 count/i)
  expect(modal).toContain('PERSONAL_RATING_CATEGORIES')
})

test('the detail page shows both ratings and defaults to Unrated', () => {
  const page = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'components', 'detail', 'GameDetailPage.jsx'),
    'utf8',
  )
  expect(page).toContain('Online Rating')
  expect(page).toContain('Personal Rating')
  expect(page).toContain('<RatingModal')
  expect(page).toMatch(/'Unrated'/)
})

test('the context menus offer rating', () => {
  const banner = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'components', 'library', 'GameBanner.jsx'), 'utf8')
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8')
  const windows = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'ipc', 'windows.js'), 'utf8')
  expect(banner).toContain('rateTitleRequested')
  expect(app).toContain('rateTitleRequested')
  expect(app).toContain('onRateTitleRequested')
  expect(windows).toContain('rate-title-requested')
})

// A deps array evaluates at render, so referencing a const declared later is a
// temporal dead zone error. This has bitten three times now.
test('the rating effect is declared after what it depends on', () => {
  const page = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'components', 'detail', 'GameDetailPage.jsx'), 'utf8')
  const decl = page.indexOf('const canManagePersonalRatings =')
  const use = page.indexOf('openRatingFor !== game?.record_id')
  expect(decl).toBeGreaterThan(-1)
  expect(use).toBeGreaterThan(decl)
})
