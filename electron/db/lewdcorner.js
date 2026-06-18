'use strict'

const dbModule = require('./index')
const getDb = () => dbModule.db

const normalizeId = (value) => {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

const parseLewdCornerIdFromUrl = (value) => {
  const text = String(value || '').trim()
  if (!text || !/lewdcorner\.com/i.test(text)) return null
  const withoutHash = text.split('#')[0].split('?')[0].replace(/\/+$/, '')
  const match = withoutHash.match(/(?:^|[/.])(\d+)$/)
  return match ? normalizeId(match[1]) : null
}

const getLewdCornerIDbyRecord = (recordId) => {
  return new Promise((resolve, reject) => {
    getDb().get(
      `SELECT COALESCE(direct_lc.lc_id, atlas_lc.lc_id) AS lc_id
       FROM games
       LEFT JOIN lewdcorner_mappings lcm ON games.record_id = lcm.record_id
       LEFT JOIN lewdcorner_data direct_lc ON lcm.lc_id = direct_lc.lc_id
       LEFT JOIN atlas_mappings am ON games.record_id = am.record_id
       LEFT JOIN lewdcorner_data atlas_lc ON direct_lc.lc_id IS NULL AND am.atlas_id = atlas_lc.atlas_id
       WHERE games.record_id = ?
       LIMIT 1`,
      [recordId],
      (err, row) => {
        if (err) reject(err)
        else resolve(row?.lc_id || null)
      },
    )
  })
}

const addLewdCornerMapping = (recordId, lcId) => {
  const normalizedLcId = normalizeId(lcId)
  return new Promise((resolve, reject) => {
    if (!recordId || !normalizedLcId) {
      reject(new Error(`Invalid LewdCorner mapping: recordId=${recordId}, lcId=${lcId}`))
      return
    }
    getDb().run(
      `INSERT OR IGNORE INTO lewdcorner_mappings (record_id, lc_id) VALUES (?, ?)`,
      [recordId, normalizedLcId],
      (err) => {
        if (err) reject(err)
        else resolve()
      },
    )
  })
}

const findRecordByLewdCornerId = (lcId) => {
  const normalizedLcId = normalizeId(lcId)
  return new Promise((resolve, reject) => {
    if (!normalizedLcId) {
      resolve(null)
      return
    }
    getDb().get(
      `SELECT record_id FROM lewdcorner_mappings WHERE lc_id = ? LIMIT 1`,
      [normalizedLcId],
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
           FROM lewdcorner_data lc
           JOIN atlas_mappings am ON lc.atlas_id = am.atlas_id
           WHERE lc.lc_id = ?
           LIMIT 1`,
          [normalizedLcId],
          (err2, row2) => {
            if (err2) reject(err2)
            else resolve(row2?.record_id || null)
          },
        )
      },
    )
  })
}

const getLewdCornerBannerUrl = (lcId) => {
  return new Promise((resolve, reject) => {
    getDb().get(
      `SELECT banner_url FROM lewdcorner_data WHERE lc_id = ?`,
      [lcId],
      (err, row) => {
        if (err) reject(err)
        else resolve(row?.banner_url || null)
      },
    )
  })
}

const getLewdCornerScreensUrlList = (lcId) => {
  return new Promise((resolve, reject) => {
    getDb().get(
      `SELECT screens FROM lewdcorner_data WHERE lc_id = ?`,
      [lcId],
      (err, row) => {
        if (err) {
          reject(err)
          return
        }
        resolve(
          String(row?.screens || '')
            .split(',')
            .map((url) => url.trim())
            .filter(Boolean),
        )
      },
    )
  })
}

const searchAtlasByLewdCornerId = (lcId) => {
  return new Promise((resolve, reject) => {
    getDb().all(
      `SELECT
        a.atlas_id,
        lc.lc_id,
        lc.site_url as lewdCornerSiteUrl,
        a.title,
        a.creator,
        a.engine,
        a.version as latestVersion
       FROM lewdcorner_data lc
       LEFT JOIN atlas_data a ON lc.atlas_id = a.atlas_id
       WHERE lc.lc_id = ?`,
      [lcId],
      (err, rows) => {
        if (err) reject(err)
        else resolve(rows || [])
      },
    )
  })
}

module.exports = {
  parseLewdCornerIdFromUrl,
  getLewdCornerIDbyRecord,
  addLewdCornerMapping,
  findRecordByLewdCornerId,
  getLewdCornerBannerUrl,
  getLewdCornerScreensUrlList,
  searchAtlasByLewdCornerId,
}
