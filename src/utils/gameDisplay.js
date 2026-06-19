export const safeText = (value) => String(value ?? '')

export const getGameTitle = (game) => {
  const value =
    game?.title ||
    game?.name ||
    game?.short_name ||
    game?.atlas_id ||
    game?.f95_id ||
    'Untitled'
  return safeText(value)
}

export const normalizeGameForRenderer = (game) => {
  if (!game || typeof game !== 'object') return null
  const title = getGameTitle(game)
  const versions = Array.isArray(game.versions) ? game.versions : []
  const safeNumber = (value) => {
    const number = Number(value || 0)
    return Number.isFinite(number) ? number : 0
  }
  const nullableNumber = (value) => {
    if (value === undefined || value === null || value === '') return null
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }
  const localRecordId = nullableNumber(game.localRecordId ?? game.installedRecordId ?? game.local_record_id)
  const hasInstalledVersion =
    game.hasInstalledVersion === true || game.isInstalled === true || game.is_installed === 1 || game.is_installed === true
      ? true
      : game.hasInstalledVersion === false
        ? false
        : versions.some((version) => version?.isInstalled !== false)
  return {
    ...game,
    record_id: game.record_id ?? safeText(game.atlas_id || game.f95_id || title),
    localRecordId,
    installedRecordId: nullableNumber(game.installedRecordId ?? localRecordId),
    local_record_id: nullableNumber(game.local_record_id ?? localRecordId),
    isInstalled: game.isInstalled === true || game.is_installed === 1 || game.is_installed === true || hasInstalledVersion,
    title,
    creator: safeText(game.creator || game.developer || 'Unknown'),
    engine: game.engine == null ? null : safeText(game.engine),
    status: game.status == null ? null : safeText(game.status),
    category: game.category == null ? null : safeText(game.category),
    censored: game.censored == null ? null : safeText(game.censored),
    language: game.language == null ? null : safeText(game.language),
    f95_tags: safeText(game.f95_tags),
    tags: safeText(game.tags),
    versions,
    hasInstalledVersion,
    versionCount: safeNumber(game.versionCount),
    installedVersionCount: safeNumber(game.installedVersionCount),
    totalVersionCount: safeNumber(game.totalVersionCount || versions.length),
    lastPlayed: safeNumber(game.lastPlayed ?? game.last_played_r),
    totalPlaytime: safeNumber(game.totalPlaytime ?? game.total_playtime),
    lastInstalled: safeNumber(game.lastInstalled),
    totalFolderSize: safeNumber(game.totalFolderSize),
    isUpdateAvailable: game.isUpdateAvailable === true,
    isFavorite: game.isFavorite === true || game.is_favorite === 1,
    personalRatingStory: nullableNumber(game.personalRatingStory ?? game.personal_rating_story),
    personalRatingGraphics: nullableNumber(game.personalRatingGraphics ?? game.personal_rating_graphics),
    personalRatingGameplay: nullableNumber(game.personalRatingGameplay ?? game.personal_rating_gameplay),
    personalRatingFappability: nullableNumber(game.personalRatingFappability ?? game.personal_rating_fappability),
    personalRatingOverall: nullableNumber(game.personalRatingOverall ?? game.personal_rating_overall),
    personalRatingUpdatedAt: nullableNumber(game.personalRatingUpdatedAt ?? game.personal_rating_updated_at),
  }
}

export const normalizeGamesForRenderer = (games) =>
  (Array.isArray(games) ? games : [])
    .map(normalizeGameForRenderer)
    .filter(Boolean)
