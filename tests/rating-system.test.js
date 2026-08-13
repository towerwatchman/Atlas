// @vitest-environment jsdom
import { test, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import fs from 'fs'
import path from 'path'
import {
  PERSONAL_RATING_CATEGORIES as UI_CATEGORIES,
  computeRatingAverage as uiAverage,
  computeOnlineRating as uiOnline,
} from '../src/utils/ratingCategories.js'
import { getPersonalRatingsOverall } from '../src/components/detail/GameDetailPage.jsx'
import { resolveBannerField } from '../src/components/library/bannerLayout/bannerFieldResolvers.js'
import React from 'react'
import RatingModal from '../src/components/detail/RatingModal.jsx'
const db = require('../electron/db/ratingCategories.js')

afterEach(() => cleanup())

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

// getPersonalRatingsOverall ignores zero ratings when calculating average
test('getPersonalRatingsOverall ignores zero ratings', () => {
  expect(getPersonalRatingsOverall({})).toBeNull()
  expect(getPersonalRatingsOverall({ story: 0, graphics: 0, gameplay: 0 })).toBeNull()
  expect(getPersonalRatingsOverall({
    story: 9, graphics: 9, gameplay: 9,
    characters: 0, sound: 0, writing: 0, polish: 0, replayability: 0,
  })).toBe(9)
  expect(getPersonalRatingsOverall({ story: 8, graphics: 6 })).toBe(7)
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

// Menu construction moved out of GameBanner into the shared builder when the
// custom React menu landed, so the grid and the tree present one menu.
test('the context menu offers rating', () => {
  const builder = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'components', 'library', 'gameContextMenu.js'), 'utf8')
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8')
  const windows = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'ipc', 'windows.js'), 'utf8')
  expect(builder).toContain('rateTitleRequested')
  expect(app).toContain('onRateTitleRequested')
  expect(windows).toContain('rate-title-requested')
})

// Ratings on banner layout fields must format out of 10 even when <= 5.
test('banner layout rating fields format on the 0-10 scale even when rating is below or equal to 5', () => {
  const personalLow = resolveBannerField('personalRating', { personalRatingOverall: 3.0 })
  expect(personalLow.value).toBe('3.0/10')
  expect(personalLow.value).not.toContain('/5')

  const personalOne = resolveBannerField('personalRating', { personalRatingOverall: 1.1 })
  expect(personalOne.value).toBe('1.1/10')
  expect(personalOne.value).not.toContain('/5')

  const sourceLow = resolveBannerField('sourceRating', { sourceRating: 4.4 })
  expect(sourceLow.value).toBe('4.4/10')
  expect(sourceLow.value).not.toContain('/5')

  const f95Low = resolveBannerField('sourceRating', { rating: 2.2 })
  expect(f95Low.value).toBe('4.4/10')
  expect(f95Low.value).not.toContain('/5')
})

test('RatingModal preserves unsaved draft ratings when background metadata update passes fresh ratings prop', () => {
  const initialRatings = { story: 2, graphics: 3 }
  const { rerender } = render(
    React.createElement(RatingModal, {
      open: true,
      title: 'Test Game',
      ratings: initialRatings,
      onSave: () => {},
      onCancel: () => {},
    }),
  )

  // User moves the Story slider to 8 while modal is open.
  const storyInput = screen.getByRole('slider', { name: 'Story' })
  fireEvent.change(storyInput, { target: { value: '8' } })
  expect(storyInput.value).toBe('8')

  // Background metadata update finishes and passes a new ratings object reference to RatingModal.
  const refreshedRatings = { story: 2, graphics: 3 }
  rerender(
    React.createElement(RatingModal, {
      open: true,
      title: 'Test Game',
      ratings: refreshedRatings,
      onSave: () => {},
      onCancel: () => {},
    }),
  )

  // The draft rating set by the user (8) should NOT be reset back to the initial saved rating (2).
  expect(screen.getByRole('slider', { name: 'Story' }).value).toBe('8')
})

