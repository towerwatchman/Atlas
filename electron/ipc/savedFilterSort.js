'use strict'

const DEFAULT_SAVED_BROWSE_SORT = 'threadUpdatedDesc'

const browseSortAliases = {
  name: 'titleAsc',
  nameAsc: 'titleAsc',
  nameDesc: 'titleDesc',
  newest: 'threadUpdatedDesc',
  oldest: 'threadUpdatedAsc',
}

const savedBrowseSorts = new Set([
  'titleAsc',
  'titleDesc',
  'creatorAsc',
  'creatorDesc',
  'likesDesc',
  'likesAsc',
  'ratingDesc',
  'ratingAsc',
  'threadUpdatedDesc',
  'threadUpdatedAsc',
  'threadPublishedDesc',
  'threadPublishedAsc',
  'releaseDateDesc',
  'releaseDateAsc',
  'f95LatestOrderDesc',
  'f95LatestOrderAsc',
])

// Saved filters cross the renderer/IPC boundary, so normalize current values and
// legacy aliases in one dependency-free place that regression tests can load.
const normalizeSavedBrowseSort = (value) => {
  const normalized = browseSortAliases[value] || value
  return savedBrowseSorts.has(normalized) ? normalized : DEFAULT_SAVED_BROWSE_SORT
}

module.exports = { DEFAULT_SAVED_BROWSE_SORT, normalizeSavedBrowseSort }
