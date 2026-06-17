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

const slug = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/\s+/g, ' ')

const normalizeSource = (entry = {}) => {
  const source = normalizeText(entry.source).toLowerCase()
  if (source === 'f95' || source === 'steam' || source === 'atlas') return source
  if (normalizeId(entry.f95_id ?? entry.f95Id)) return 'f95'
  if (normalizeId(entry.steam_id ?? entry.steamId ?? entry.steam_appid)) return 'steam'
  return 'atlas'
}

const normalizeWishlistEntry = (entry = {}) => {
  const source = normalizeSource(entry)
  const atlasId = normalizeId(entry.atlas_id ?? entry.atlasId)
  const f95Id = normalizeId(entry.f95_id ?? entry.f95Id)
  const steamId = normalizeId(entry.steam_id ?? entry.steamId ?? entry.steam_appid)
  const title = normalizeText(entry.title || entry.name || entry.short_name, 'Untitled')
  const creator = normalizeText(entry.creator || entry.developer, 'Unknown')
  const identityKey =
    f95Id ? `f95:${f95Id}`
      : steamId ? `steam:${steamId}`
      : atlasId ? `atlas:${atlasId}`
      : `${source}:title:${slug(title)}:${slug(creator)}`

  return {
    identityKey,
    source,
    atlasId,
    f95Id,
    steamId,
    title,
    creator,
    engine: normalizeText(entry.engine) || null,
    status: normalizeText(entry.status) || null,
    latestVersion: normalizeText(entry.latestVersion ?? entry.latest_version ?? entry.version) || null,
    siteUrl: normalizeText(entry.siteUrl ?? entry.site_url) || null,
    bannerUrl: normalizeText(entry.banner_url ?? entry.bannerUrl) || null,
    note: normalizeText(entry.note) || null,
  }
}

const normalizeWishlistIdentity = (identity = {}) => {
  if (typeof identity === 'string' && identity.trim()) {
    return { identityKey: identity.trim() }
  }
  return normalizeWishlistEntry(identity)
}

const mapWishlistRow = (row = {}) => ({
  wishlist_id: row.wishlist_id,
  record_id: `wishlist:${row.wishlist_id}`,
  identity_key: row.identity_key,
  source: row.source,
  atlas_id: row.atlas_id,
  f95_id: row.f95_id,
  steam_id: row.steam_id,
  title: row.title,
  creator: row.creator,
  engine: row.engine,
  status: row.status,
  latestVersion: row.latest_version,
  latest_version: row.latest_version,
  siteUrl: row.site_url,
  site_url: row.site_url,
  banner_url: row.banner_url,
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
})

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
       (identity_key, source, atlas_id, f95_id, steam_id, title, creator, engine, status,
        latest_version, site_url, banner_url, flagged_at, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(identity_key) DO UPDATE SET
        source = excluded.source,
        atlas_id = excluded.atlas_id,
        f95_id = excluded.f95_id,
        steam_id = excluded.steam_id,
        title = excluded.title,
        creator = excluded.creator,
        engine = COALESCE(excluded.engine, wishlist_entries.engine),
        status = COALESCE(excluded.status, wishlist_entries.status),
        latest_version = COALESCE(excluded.latest_version, wishlist_entries.latest_version),
        site_url = COALESCE(excluded.site_url, wishlist_entries.site_url),
        banner_url = COALESCE(excluded.banner_url, wishlist_entries.banner_url),
        note = COALESCE(excluded.note, wishlist_entries.note)`,
      [
        normalized.identityKey,
        normalized.source,
        normalized.atlasId,
        normalized.f95Id,
        normalized.steamId,
        normalized.title,
        normalized.creator,
        normalized.engine,
        normalized.status,
        normalized.latestVersion,
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
      `SELECT * FROM wishlist_entries WHERE identity_key = ? LIMIT 1`,
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
      `SELECT * FROM wishlist_entries ORDER BY flagged_at DESC, title COLLATE NOCASE ASC`,
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
