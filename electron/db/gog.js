'use strict'

// GOG equivalent of db/steam.js. Mirrors the same mapping / lookup helpers so
// the importer and scanner can treat GOG as a first-class metadata source.
//
// GOG product ids are numeric (e.g. 1207658930). They come to us either from a
// real gog_mapping (record_id -> gog_id), from an Atlas/f95 record's
// external_ids blob (under gog_id / gog_appid), or freshly from a local scan.

const dbModule = require('./index')
const getDb = () => dbModule.db

const parseGogIdFromExternalIds = (raw) => {
  if (!raw) return null
  try {
    const parsed = typeof raw === 'object' ? raw : JSON.parse(raw)
    return parsed?.gog_id || parsed?.gog_appid || parsed?.gogId || parsed?.gogAppId || null
  } catch {
    const match = String(raw).match(/"gog_(?:id|appid)"\s*:\s*"?(\d+)/i)
    return match?.[1] || null
  }
}

const getGogIDbyRecord = (recordId) => {
  return new Promise((resolve, reject) => {
    getDb().get(
      `SELECT
         gog_mappings.gog_id AS mapped_gog_id,
         gog_data.gog_id AS atlas_gog_id,
         atlas_data.external_ids
       FROM games
       LEFT JOIN gog_mappings ON games.record_id = gog_mappings.record_id
       LEFT JOIN atlas_mappings ON games.record_id = atlas_mappings.record_id
       LEFT JOIN atlas_data ON atlas_mappings.atlas_id = atlas_data.atlas_id
       LEFT JOIN gog_data ON atlas_data.atlas_id = gog_data.atlas_id
       WHERE games.record_id = ?
       LIMIT 1`,
      [recordId],
      (err, row) => {
        if (err) reject(err)
        else resolve(row?.mapped_gog_id || row?.atlas_gog_id || parseGogIdFromExternalIds(row?.external_ids))
      },
    )
  })
}

const addGogMapping = (recordId, gogId) => {
  return new Promise((resolve, reject) => {
    getDb().run(
      `INSERT OR IGNORE INTO gog_mappings (record_id, gog_id) VALUES (?, ?)`,
      [recordId, gogId],
      (err) => {
        if (err) reject(err)
        else resolve()
      },
    )
  })
}

const getGogBannerUrl = (gogId) => {
  return new Promise((resolve, reject) => {
    getDb().get(
      `SELECT header FROM gog_data WHERE gog_id = ?`,
      [gogId],
      (err, row) => {
        if (err) reject(err)
        else resolve(row ? row.header : null)
      },
    )
  })
}

const getGogScreensUrlList = (gogId) => {
  return new Promise((resolve, reject) => {
    getDb().all(
      `SELECT screen_url FROM gog_screens WHERE gog_id = ?`,
      [gogId],
      (err, rows) => {
        if (err) reject(err)
        else resolve(rows.map((row) => row.screen_url))
      },
    )
  })
}

// Find an existing library record that already owns a given GOG product id,
// either through a direct gog_mapping or because an Atlas/f95 record lists the
// id in its external_ids. Used to merge a scanned GOG install into the existing
// title as another version instead of creating a duplicate.
const findRecordByGogId = (gogId) => {
  return new Promise((resolve, reject) => {
    if (!gogId) {
      resolve(null)
      return
    }
    const id = String(gogId)
    getDb().get(
      `SELECT record_id FROM gog_mappings WHERE gog_id = ? LIMIT 1`,
      [gogId],
      (err, row) => {
        if (err) {
          reject(err)
          return
        }
        if (row?.record_id) {
          resolve(row.record_id)
          return
        }
        getDb().get(
          `SELECT am.record_id
           FROM atlas_mappings am
           JOIN atlas_data a ON am.atlas_id = a.atlas_id
           WHERE a.external_ids LIKE '%"gog_id":"' || ? || '"%'
              OR a.external_ids LIKE '%"gog_id": "' || ? || '"%'
              OR a.external_ids LIKE '%"gog_id":' || ? || '%'
              OR a.external_ids LIKE '%"gog_appid":"' || ? || '"%'
           LIMIT 1`,
          [id, id, id, id],
          (err2, row2) => {
            if (err2) reject(err2)
            else resolve(row2?.record_id || null)
          },
        )
      },
    )
  })
}

module.exports = {
  getGogIDbyRecord,
  addGogMapping,
  getGogBannerUrl,
  getGogScreensUrlList,
  findRecordByGogId,
}
