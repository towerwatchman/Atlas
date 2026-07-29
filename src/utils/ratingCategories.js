// Renderer-side mirror of electron/db/ratingCategories.js.
//
// Duplicated deliberately: main is CommonJS and the renderer is an ESM bundle, so
// they cannot share a module. A test asserts the two lists stay identical — if
// they drift, the modal writes keys the database does not have and ratings are
// silently dropped.

export const PERSONAL_RATING_CATEGORIES = [
  { key: 'story', label: 'Story', gameKey: 'personalRatingStory' },
  { key: 'graphics', label: 'Graphics', gameKey: 'personalRatingGraphics' },
  { key: 'gameplay', label: 'Gameplay', gameKey: 'personalRatingGameplay' },
  { key: 'characters', label: 'Characters', gameKey: 'personalRatingCharacters' },
  { key: 'sound', label: 'Sound & Music', gameKey: 'personalRatingSound' },
  { key: 'writing', label: 'Writing', gameKey: 'personalRatingWriting' },
  { key: 'polish', label: 'Polish', gameKey: 'personalRatingPolish' },
  { key: 'replayability', label: 'Replayability', gameKey: 'personalRatingReplayability' },
]

export const RATING_MAX = 10

// F95Zone and LewdCorner score out of 5; personal ratings out of 10. The card
// shows both out of 10 so they can be compared directly.
export const COMMUNITY_RATING_SCALE = 5

/**
 * Average of the categories actually rated. 0 and null both mean "not rated", so
 * neither counts — rating two categories 8 and 6 gives 7, not 1.75.
 */
export function computeRatingAverage(values = {}) {
  const rated = PERSONAL_RATING_CATEGORIES
    .map(({ key }) => Number(values?.[key]))
    .filter((value) => Number.isFinite(value) && value > 0)
  if (rated.length === 0) return null
  const average = rated.reduce((sum, value) => sum + value, 0) / rated.length
  return Math.round(average * 10) / 10
}

/**
 * Combined community rating on the 0-10 scale: the mean of whichever sources
 * exist, not the best of them.
 *
 * Note this differs from the community-rating FILTER, which uses MAX so a title
 * rated highly on either site still passes.
 */
export function computeOnlineRating({ f95Rating, lewdcornerRating } = {}) {
  const sources = [f95Rating, lewdcornerRating]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
  if (sources.length === 0) return null
  const average = sources.reduce((sum, value) => sum + value, 0) / sources.length
  return Math.round((average * RATING_MAX / COMMUNITY_RATING_SCALE) * 10) / 10
}

/** Pull the saved per-category values off a game row. */
export function readRatingsFromGame(game = {}) {
  return Object.fromEntries(
    PERSONAL_RATING_CATEGORIES.map(({ key, gameKey }) => [key, Number(game?.[gameKey]) || 0]),
  )
}
