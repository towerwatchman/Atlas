'use strict'

const dbModule = require('./index')
const getDb = () => dbModule.db

const normalizeId = (value) => {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

const normalizeText = (value, fallback = '') => {
  const text = String(value ?? '').trim()
  return text || fallback
}

const firstText = (...values) => {
  for (const value of values) {
    const text = normalizeText(value)
    if (text) return text
  }
  return ''
}

const slug = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/\s+/g, ' ')

const parseExternalIds = (raw) => {
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

const stringifyExternalIds = (value) => {
  const parsed = parseExternalIds(value)
  return Object.keys(parsed).length > 0 ? JSON.stringify(parsed) : null
}

const mergeExternalIds = (base, additions = {}) => {
  const merged = { ...parseExternalIds(base) }
  for (const [key, value] of Object.entries(additions)) {
    const text = normalizeText(value)
    if (text && !normalizeText(merged[key])) merged[key] = text
  }
  return Object.keys(merged).length > 0 ? JSON.stringify(merged) : null
}

const steamStoreUrl = (steamId) =>
  normalizeId(steamId) ? `https://store.steampowered.com/app/${normalizeId(steamId)}/` : null

const normalizeSource = (entry = {}) => {
  const source = normalizeText(entry.source).toLowerCase()
  if (source === 'f95' || source === 'steam' || source === 'atlas' || source === 'lewdcorner') return source
  if (normalizeId(entry.f95_id ?? entry.f95Id)) return 'f95'
  if (normalizeId(entry.lc_id ?? entry.lcId ?? entry.lewdCornerId ?? entry.lewdcornerId)) return 'lewdcorner'
  if (normalizeId(entry.steam_id ?? entry.steamId ?? entry.steam_appid)) return 'steam'
  return 'atlas'
}

const normalizeWishlistEntry = (entry = {}) => {
  const source = normalizeSource(entry)
  const atlasId = normalizeId(entry.atlas_id ?? entry.atlasId)
  const f95Id = normalizeId(entry.f95_id ?? entry.f95Id)
  const lcId = normalizeId(entry.lc_id ?? entry.lcId ?? entry.lewdCornerId ?? entry.lewdcornerId)
  const steamId = normalizeId(entry.steam_id ?? entry.steamId ?? entry.steam_appid)
  const title = normalizeText(entry.title || entry.name || entry.short_name, 'Untitled')
  const creator = normalizeText(entry.creator || entry.developer, 'Unknown')
  const identityKey =
    source === 'lewdcorner' && atlasId ? `atlas:${atlasId}`
      : f95Id ? `f95:${f95Id}`
      : lcId ? `lewdcorner:${lcId}`
      : steamId ? `steam:${steamId}`
      : atlasId ? `atlas:${atlasId}`
      : `${source}:title:${slug(title)}:${slug(creator)}`

  return {
    identityKey,
    source,
    atlasId,
    f95Id,
    lcId,
    steamId,
    title,
    creator,
    engine: normalizeText(entry.engine) || null,
    status: normalizeText(entry.status) || null,
    latestVersion: normalizeText(entry.latestVersion ?? entry.latest_version ?? entry.version) || null,
    category: normalizeText(entry.category) || null,
    genre: normalizeText(entry.genre) || null,
    rating: normalizeText(entry.rating) || null,
    tags: normalizeText(entry.f95_tags ?? entry.lewdcornerTags ?? entry.tags) || null,
    overview: normalizeText(entry.overview ?? entry.description) || null,
    externalIds: stringifyExternalIds(entry.external_ids),
    steamUrl: normalizeText(entry.steamUrl ?? entry.steam_url ?? entry.storeUrl) || steamStoreUrl(steamId),
    previewUrls: Array.isArray(entry.preview_urls)
      ? entry.preview_urls.filter(Boolean).join(',')
      : normalizeText(entry.preview_urls ?? entry.previewUrls) || null,
    siteUrl: normalizeText(entry.lewdCornerSiteUrl ?? entry.lewdcornerSiteUrl ?? entry.siteUrl ?? entry.site_url) || null,
    bannerUrl: normalizeText(entry.lewdCornerBannerUrl ?? entry.lewdcornerBannerUrl ?? entry.banner_url ?? entry.bannerUrl) || null,
    note: normalizeText(entry.note) || null,
  }
}

const normalizeWishlistIdentity = (identity = {}) => {
  if (typeof identity === 'string' && identity.trim()) {
    return { identityKey: identity.trim() }
  }
  if (identity?.identity_key) {
    return { identityKey: String(identity.identity_key).trim() }
  }
  return normalizeWishlistEntry(identity)
}

const mapWishlistRow = (row = {}) => {
  const atlasId = normalizeId(row.atlas_id ?? row.current_atlas_id)
  const f95Id = normalizeId(row.f95_id ?? row.current_f95_id)
  const lcId = normalizeId(row.lc_id ?? row.current_lc_id)
  const steamId = normalizeId(row.steam_id ?? row.current_steam_id)
  const externalIds = mergeExternalIds(
    firstText(row.current_external_ids, row.external_ids),
    {
      steam_appid: steamId,
    },
  )
  const tags = firstText(row.current_f95_tags, row.current_lewdcorner_tags, row.tags, row.current_atlas_tags, row.current_steam_tags)
  const overview = firstText(row.current_overview, row.overview)
  const latestVersion = firstText(row.current_latest_version, row.latest_version)
  const bannerUrl = firstText(row.banner_url, row.current_f95_banner, row.current_lewdcorner_banner, row.current_steam_header, row.current_steam_hero, row.current_atlas_banner_wide, row.current_atlas_banner)
  const source = firstText(
    row.source,
    f95Id ? 'f95' : '',
    lcId ? 'lewdcorner' : '',
    steamId ? 'steam' : '',
    atlasId ? 'atlas' : '',
  ) || 'atlas'

  return {
    wishlist_id: row.wishlist_id,
    record_id: `wishlist:${row.wishlist_id}`,
    identity_key: row.identity_key,
    source,
    atlas_id: atlasId,
    f95_id: f95Id,
    lc_id: lcId,
    lcId,
    lewdCornerId: lcId,
    steam_id: steamId,
    title: firstText(row.current_title, row.title, row.current_short_name, 'Untitled'),
    creator: firstText(row.current_creator, row.creator, row.current_developer, 'Unknown'),
    developer: firstText(row.current_developer, row.current_steam_developer, row.creator),
    publisher: firstText(row.current_steam_publisher),
    engine: firstText(row.current_engine, row.engine) || null,
    status: firstText(row.current_status, row.status) || null,
    latestVersion,
    latest_version: latestVersion,
    category: firstText(row.current_category, row.category) || null,
    genre: firstText(row.current_genre, row.genre) || null,
    rating: firstText(row.current_rating, row.rating) || null,
    language: firstText(row.current_language) || null,
    release_date: firstText(row.current_release_date, row.current_steam_release_date) || null,
    overview,
    description: overview,
    f95_tags: tags,
    tags,
    external_ids: externalIds,
    siteUrl: firstText(row.current_site_url, row.current_lewdcorner_site_url, row.site_url) || null,
    site_url: firstText(row.current_site_url, row.current_lewdcorner_site_url, row.site_url) || null,
    lewdCornerSiteUrl: firstText(row.current_lewdcorner_site_url) || null,
    steamUrl: firstText(row.steam_url, steamStoreUrl(steamId)) || null,
    steam_url: firstText(row.steam_url, steamStoreUrl(steamId)) || null,
    banner_url: bannerUrl || null,
    banner_source: bannerUrl ? 'stream' : '',
    f95_banner: firstText(row.current_f95_banner) || null,
    lewdcorner_banner: firstText(row.current_lewdcorner_banner) || null,
    lewdCornerBannerUrl: firstText(row.current_lewdcorner_banner) || null,
    steam_header: firstText(row.current_steam_header) || null,
    steam_library_hero: firstText(row.current_steam_hero) || null,
    steam_library_capsule: firstText(row.current_steam_cover) || null,
    steam_logo: firstText(row.current_steam_logo) || null,
    atlas_banner_wide: firstText(row.current_atlas_banner_wide) || null,
    atlas_banner: firstText(row.current_atlas_banner) || null,
    atlas_logo: firstText(row.current_atlas_logo) || null,
    preview_urls: firstText(row.preview_urls, row.current_atlas_previews, row.current_f95_screens, row.current_lewdcorner_screens) || null,
    flagged_at: row.flagged_at,
    note: row.note,
    versions: [],
    versionCount: 0,
    installedVersionCount: 0,
    totalVersionCount: 0,
    hasInstalledVersion: false,
    isUpdateAvailable: false,
    isCatalogEntry: true,
    isMetadataOnly: true,
    isWishlistEntry: true,
    isWishlisted: true,
  }
}

const wishlistHydratedSelect = `
  SELECT
    wishlist_entries.*,
    COALESCE(wishlist_entries.atlas_id, f95_zone_data.atlas_id, lewdcorner_data.atlas_id, steam_data.atlas_id) AS current_atlas_id,
    COALESCE(wishlist_entries.f95_id, f95_zone_data.f95_id) AS current_f95_id,
    COALESCE(wishlist_entries.lc_id, lewdcorner_data.lc_id) AS current_lc_id,
    COALESCE(wishlist_entries.steam_id, steam_data.steam_id) AS current_steam_id,
    atlas_data.title AS current_title,
    atlas_data.short_name AS current_short_name,
    COALESCE(NULLIF(atlas_data.creator, ''), atlas_data.developer) AS current_creator,
    COALESCE(NULLIF(atlas_data.developer, ''), steam_data.developer) AS current_developer,
    steam_data.developer AS current_steam_developer,
    steam_data.publisher AS current_steam_publisher,
    COALESCE(NULLIF(atlas_data.engine, ''), steam_data.engine) AS current_engine,
    COALESCE(NULLIF(atlas_data.status, ''), steam_data.release_state) AS current_status,
    atlas_data.version AS current_latest_version,
    COALESCE(NULLIF(atlas_data.category, ''), steam_data.category) AS current_category,
    COALESCE(NULLIF(atlas_data.genre, ''), steam_data.genre) AS current_genre,
    COALESCE(NULLIF(atlas_data.language, ''), steam_data.language) AS current_language,
    COALESCE(NULLIF(atlas_data.overview, ''), steam_data.overview) AS current_overview,
    atlas_data.release_date AS current_release_date,
    steam_data.release_date AS current_steam_release_date,
    atlas_data.tags AS current_atlas_tags,
    steam_data.tags AS current_steam_tags,
    atlas_data.external_ids AS current_external_ids,
    atlas_data.banner AS current_atlas_banner,
    atlas_data.banner_wide AS current_atlas_banner_wide,
    atlas_data.logo AS current_atlas_logo,
    atlas_data.previews AS current_atlas_previews,
    f95_zone_data.site_url AS current_site_url,
    f95_zone_data.tags AS current_f95_tags,
    COALESCE(f95_zone_data.rating, lewdcorner_data.rating) AS current_rating,
    f95_zone_data.banner_url AS current_f95_banner,
    f95_zone_data.screens AS current_f95_screens,
    lewdcorner_data.site_url AS current_lewdcorner_site_url,
    lewdcorner_data.tags AS current_lewdcorner_tags,
    lewdcorner_data.rating AS current_lewdcorner_rating,
    lewdcorner_data.banner_url AS current_lewdcorner_banner,
    lewdcorner_data.screens AS current_lewdcorner_screens,
    steam_data.header AS current_steam_header,
    steam_data.library_hero AS current_steam_hero,
    steam_data.library_capsule AS current_steam_cover,
    steam_data.logo AS current_steam_logo
  FROM wishlist_entries
  LEFT JOIN f95_zone_data ON f95_zone_data.f95_id = COALESCE(
    wishlist_entries.f95_id,
    (
      SELECT f95_lookup.f95_id
      FROM f95_zone_data f95_lookup
      WHERE f95_lookup.atlas_id = wishlist_entries.atlas_id
      LIMIT 1
    )
  )
  LEFT JOIN steam_data ON steam_data.steam_id = COALESCE(
    wishlist_entries.steam_id,
    (
      SELECT MIN(steam_lookup.steam_id)
      FROM steam_data steam_lookup
      WHERE steam_lookup.atlas_id = wishlist_entries.atlas_id
    )
  )
  LEFT JOIN lewdcorner_data ON lewdcorner_data.lc_id = COALESCE(
    wishlist_entries.lc_id,
    (
      SELECT lc_lookup.lc_id
      FROM lewdcorner_data lc_lookup
      WHERE lc_lookup.atlas_id = wishlist_entries.atlas_id
      LIMIT 1
    )
  )
  LEFT JOIN atlas_data ON atlas_data.atlas_id = COALESCE(wishlist_entries.atlas_id, f95_zone_data.atlas_id, lewdcorner_data.atlas_id, steam_data.atlas_id)
`

const findInstalledRecord = (entry = {}) => {
  const normalized = normalizeWishlistEntry(entry)
  const clauses = []
  const params = []

  if (normalized.atlasId) {
    clauses.push('SELECT record_id FROM atlas_mappings WHERE atlas_id = ?')
    params.push(normalized.atlasId)
  }
  if (normalized.f95Id) {
    clauses.push('SELECT record_id FROM f95_zone_mappings WHERE f95_id = ?')
    params.push(normalized.f95Id)
  }
  if (normalized.lcId) {
    clauses.push('SELECT record_id FROM lewdcorner_mappings WHERE lc_id = ?')
    params.push(normalized.lcId)
    clauses.push(`SELECT am.record_id
                 FROM lewdcorner_data lc
                 JOIN atlas_mappings am ON lc.atlas_id = am.atlas_id
                 WHERE lc.lc_id = ?`)
    params.push(normalized.lcId)
  }
  if (normalized.steamId) {
    clauses.push('SELECT record_id FROM steam_mappings WHERE steam_id = ?')
    params.push(normalized.steamId)
  }

  if (clauses.length === 0) return Promise.resolve(null)

  return new Promise((resolve, reject) => {
    getDb().get(
      `${clauses.join(' UNION ')} LIMIT 1`,
      params,
      (err, row) => {
        if (err) reject(err)
        else resolve(row?.record_id || null)
      },
    )
  })
}

const addWishlistEntry = async (entry = {}) => {
  const normalized = normalizeWishlistEntry(entry)
  const installedRecordId = await findInstalledRecord(normalized)
  if (installedRecordId) {
    return {
      success: false,
      inLibrary: true,
      recordId: installedRecordId,
      identityKey: normalized.identityKey,
    }
  }

  const flaggedAt = Math.floor(Date.now() / 1000)
  return new Promise((resolve, reject) => {
    getDb().run(
      `INSERT INTO wishlist_entries
       (identity_key, source, atlas_id, f95_id, lc_id, steam_id, title, creator, engine, status,
        latest_version, category, genre, rating, tags, overview, external_ids, steam_url,
        preview_urls, site_url, banner_url, flagged_at, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(identity_key) DO UPDATE SET
        source = excluded.source,
        atlas_id = excluded.atlas_id,
        f95_id = excluded.f95_id,
        lc_id = excluded.lc_id,
        steam_id = excluded.steam_id,
        title = excluded.title,
        creator = excluded.creator,
        engine = COALESCE(excluded.engine, wishlist_entries.engine),
        status = COALESCE(excluded.status, wishlist_entries.status),
        latest_version = COALESCE(excluded.latest_version, wishlist_entries.latest_version),
        category = COALESCE(excluded.category, wishlist_entries.category),
        genre = COALESCE(excluded.genre, wishlist_entries.genre),
        rating = COALESCE(excluded.rating, wishlist_entries.rating),
        tags = COALESCE(excluded.tags, wishlist_entries.tags),
        overview = COALESCE(excluded.overview, wishlist_entries.overview),
        external_ids = COALESCE(excluded.external_ids, wishlist_entries.external_ids),
        steam_url = COALESCE(excluded.steam_url, wishlist_entries.steam_url),
        preview_urls = COALESCE(excluded.preview_urls, wishlist_entries.preview_urls),
        site_url = COALESCE(excluded.site_url, wishlist_entries.site_url),
        banner_url = COALESCE(excluded.banner_url, wishlist_entries.banner_url),
        note = COALESCE(excluded.note, wishlist_entries.note)`,
      [
        normalized.identityKey,
        normalized.source,
        normalized.atlasId,
        normalized.f95Id,
        normalized.lcId,
        normalized.steamId,
        normalized.title,
        normalized.creator,
        normalized.engine,
        normalized.status,
        normalized.latestVersion,
        normalized.category,
        normalized.genre,
        normalized.rating,
        normalized.tags,
        normalized.overview,
        normalized.externalIds,
        normalized.steamUrl,
        normalized.previewUrls,
        normalized.siteUrl,
        normalized.bannerUrl,
        flaggedAt,
        normalized.note,
      ],
      (err) => {
        if (err) {
          reject(err)
          return
        }
        getWishlistEntry(normalized).then((row) => {
          resolve({
            success: true,
            isWishlisted: true,
            identityKey: normalized.identityKey,
            entry: row,
          })
        }).catch(reject)
      },
    )
  })
}

const getWishlistEntry = (identity = {}) => {
  const normalized = normalizeWishlistIdentity(identity)
  return new Promise((resolve, reject) => {
    getDb().get(
      `${wishlistHydratedSelect}
       WHERE wishlist_entries.identity_key = ?
       LIMIT 1`,
      [normalized.identityKey],
      (err, row) => {
        if (err) reject(err)
        else resolve(row ? mapWishlistRow(row) : null)
      },
    )
  })
}

const removeWishlistEntry = (identity = {}) => {
  const normalized = normalizeWishlistIdentity(identity)
  return new Promise((resolve, reject) => {
    getDb().run(
      `DELETE FROM wishlist_entries WHERE identity_key = ?`,
      [normalized.identityKey],
      function (err) {
        if (err) reject(err)
        else resolve({
          success: true,
          removed: this.changes > 0,
          isWishlisted: false,
          identityKey: normalized.identityKey,
        })
      },
    )
  })
}

const isWishlistEntry = async (identity = {}) => {
  const row = await getWishlistEntry(identity)
  return !!row
}

const toggleWishlistEntry = async (entry = {}) => {
  const existing = await getWishlistEntry(entry)
  if (existing) return removeWishlistEntry(existing)
  return addWishlistEntry(entry)
}

const getWishlistEntries = () => {
  return new Promise((resolve, reject) => {
    getDb().all(
      `${wishlistHydratedSelect}
       ORDER BY wishlist_entries.flagged_at DESC, wishlist_entries.title COLLATE NOCASE ASC`,
      [],
      (err, rows) => {
        if (err) reject(err)
        else resolve((rows || []).map(mapWishlistRow))
      },
    )
  })
}

const getWishlistEntryIdentities = () => {
  return new Promise((resolve, reject) => {
    getDb().all(
      `SELECT identity_key FROM wishlist_entries ORDER BY identity_key ASC`,
      [],
      (err, rows) => {
        if (err) reject(err)
        else resolve((rows || []).map((row) => row.identity_key).filter(Boolean))
      },
    )
  })
}

module.exports = {
  addWishlistEntry,
  removeWishlistEntry,
  toggleWishlistEntry,
  isWishlistEntry,
  getWishlistEntries,
  getWishlistEntryIdentities,
  normalizeWishlistEntry,
}
