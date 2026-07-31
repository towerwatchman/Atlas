'use strict'

// ── Rating categories ────────────────────────────────────────────────────────
//
// One definition, used by the schema migration, the SQL that computes averages,
// the IPC layer and the renderer. The field list previously appeared in six
// separate places (db/index.js, db/versions.js, db/games.js, db/catalogIndex.js,
// GameDetailPage.jsx and the filter layer), so adding or removing a category
// meant finding all of them — which is exactly how "fappability" ended up
// baked into two hand-written SQL average expressions.
//
// `column` is the SQLite column, `key` the IPC/renderer key, `gameKey` the
// camelCase property put on a game object by applyPersonalRatings.

const PERSONAL_RATING_CATEGORIES = [
  { column: 'story', key: 'story', label: 'Story', gameKey: 'personalRatingStory' },
  { column: 'graphics', key: 'graphics', label: 'Graphics', gameKey: 'personalRatingGraphics' },
  { column: 'gameplay', key: 'gameplay', label: 'Gameplay', gameKey: 'personalRatingGameplay' },
  { column: 'characters', key: 'characters', label: 'Characters', gameKey: 'personalRatingCharacters' },
  { column: 'sound', key: 'sound', label: 'Sound & Music', gameKey: 'personalRatingSound' },
  { column: 'writing', key: 'writing', label: 'Writing', gameKey: 'personalRatingWriting' },
  { column: 'polish', key: 'polish', label: 'Polish', gameKey: 'personalRatingPolish' },
  { column: 'replayability', key: 'replayability', label: 'Replayability', gameKey: 'personalRatingReplayability' },
]

// Dropped from the rating. The column is deliberately NOT removed from the
// table: SQLite's DROP COLUMN would rewrite the table and destroy the data
// irreversibly, and there is no benefit to that over simply ignoring it. It is
// excluded from every read, write and average, so it is inert.
const RETIRED_RATING_COLUMNS = ['fappability']

const PERSONAL_RATING_COLUMNS = PERSONAL_RATING_CATEGORIES.map((c) => c.column)
const PERSONAL_RATING_KEYS = PERSONAL_RATING_CATEGORIES.map((c) => c.key)

const RATING_MIN = 0 // 0 means "not rated", which is why it never counts
const RATING_MAX = 10

// Community ratings from F95Zone and LewdCorner are on a 0-5 scale, personal
// ratings on 0-10. The card shows both out of 10 so they can be read against
// each other, which needs this factor.
const COMMUNITY_RATING_SCALE = 5
const COMMUNITY_TO_PERSONAL_FACTOR = RATING_MAX / COMMUNITY_RATING_SCALE

/** Clamp to an integer in range, or null when absent/unrated. */
function normalizeRatingValue(value) {
  if (value === undefined || value === null || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  const clamped = Math.max(RATING_MIN, Math.min(RATING_MAX, Math.round(number)))
  // 0 is stored, but treated as unrated everywhere it is averaged.
  return clamped
}

/**
 * Average of the categories that have actually been rated.
 *
 * A category counts only when it is greater than zero: 0 and null both mean
 * "not rated". Rating two categories 8 and 6 gives 7, not 1.75 — dividing by the
 * full category count would punish anyone who does not fill in all eight.
 */
function computeRatingAverage(values = {}) {
  const rated = PERSONAL_RATING_KEYS
    .map((key) => normalizeRatingValue(values[key]))
    .filter((value) => value !== null && value > 0)
  if (rated.length === 0) return null
  const average = rated.reduce((sum, value) => sum + value, 0) / rated.length
  return Math.round(average * 10) / 10
}

/**
 * The combined community rating, converted to the 0-10 scale.
 *
 * The mean of whichever sources exist, not the best of them. Note this differs
 * from the community-rating FILTER in useFilters, which uses MAX so that a title
 * highly rated on either site still passes; averaging there would hide titles
 * that only one site has scored.
 */
function computeOnlineRating({ f95Rating, lewdcornerRating } = {}) {
  const sources = [f95Rating, lewdcornerRating]
    .map((value) => {
      if (value === undefined || value === null || value === '') return null
      const number = Number(value)
      return Number.isFinite(number) && number > 0 ? number : null
    })
    .filter((value) => value !== null)
  if (sources.length === 0) return null
  const average = sources.reduce((sum, value) => sum + value, 0) / sources.length
  return Math.round(average * COMMUNITY_TO_PERSONAL_FACTOR * 10) / 10
}

/**
 * SQL fragment averaging the rated categories for a joined ratings table.
 *
 * Generated rather than hand-written because the previous versions in
 * db/versions.js and db/catalogIndex.js each listed the columns literally and
 * both still counted fappability. NULLIF(x, 0) is what makes an explicit zero
 * count as unrated, matching computeRatingAverage above.
 */
function buildRatingAverageSql(alias) {
  const sum = PERSONAL_RATING_COLUMNS
    .map((column) => `COALESCE(NULLIF(${alias}.${column}, 0), 0)`)
    .join(' + ')
  const count = PERSONAL_RATING_COLUMNS
    .map((column) => `(CASE WHEN COALESCE(${alias}.${column}, 0) > 0 THEN 1 ELSE 0 END)`)
    .join(' + ')
  return `(${sum}) * 1.0 / NULLIF(${count}, 0)`
}

module.exports = {
  PERSONAL_RATING_CATEGORIES,
  PERSONAL_RATING_COLUMNS,
  PERSONAL_RATING_KEYS,
  RETIRED_RATING_COLUMNS,
  RATING_MIN,
  RATING_MAX,
  COMMUNITY_RATING_SCALE,
  COMMUNITY_TO_PERSONAL_FACTOR,
  normalizeRatingValue,
  computeRatingAverage,
  computeOnlineRating,
  buildRatingAverageSql,
}
