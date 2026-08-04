'use strict'

const http = require('http')
let dbModule = null
try {
  dbModule = require('../db/index')
} catch {
  dbModule = null
}
const getDb = () => dbModule?.db || null

let electronModule = null
try {
  electronModule = require('electron')
} catch {
  electronModule = null
}
const getBrowserWindow = () => electronModule?.BrowserWindow || null

let server = null
let activePort = 57096
let getConfigFn = null

const THREAD_ID_PATTERNS = {
  f95: /(?:^|\/\/|\.)f95zone\.to\/threads\/(?:([^/?#]*)[.-])?(\d+)/i,
  lewdcorner: /(?:^|\/\/|\.)lewdcorner\.com\/threads\/(?:([^/?#]*)[.-])?(\d+)/i,
}

function extractThreadInfo(rawUrl) {
  const text = String(rawUrl || '').trim()
  for (const [forum, pattern] of Object.entries(THREAD_ID_PATTERNS)) {
    const match = pattern.exec(text)
    if (match) {
      const slugRaw = match[1] || ''
      const idRaw = match[2]
      const id = Number.parseInt(idRaw, 10)
      if (Number.isInteger(id) && id > 0) {
        const slugTitle = slugRaw ? slugRaw.replace(/[-_]+/g, ' ').trim() : ''
        return { forum, id: String(id), numericId: id, slugTitle }
      }
    }
  }
  return null
}

function sendResponse(res, code, contentType, body, extraHeaders = {}) {
  res.writeHead(code, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
    'Access-Control-Allow-Private-Network': 'true',
    'Content-Type': contentType,
    ...extraHeaders,
  })
  res.end(body)
}

function sendJson(res, code, data) {
  sendResponse(res, code, 'application/json', JSON.stringify(data))
}

function handleOptions(req, res) {
  res.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Max-Age': '86400',
  })
  res.end()
}

function queryDbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = getDb()
    if (!db) {
      resolve([])
      return
    }
    db.all(sql, params, (err, rows) => {
      if (err) reject(err)
      else resolve(rows || [])
    })
  })
}

function queryDbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = getDb()
    if (!db) {
      resolve(null)
      return
    }
    db.get(sql, params, (err, row) => {
      if (err) reject(err)
      else resolve(row || null)
    })
  })
}

function queryDbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = getDb()
    if (!db) {
      resolve({ lastID: 0, changes: 0 })
      return
    }
    db.run(sql, params, function (err) {
      if (err) reject(err)
      else resolve(this)
    })
  })
}

async function getGamesList() {
  const db = getDb()
  if (!db) return []

  try {
    const rows = await queryDbAll(`
      SELECT 
        g.record_id,
        COALESCE(
          fm.f95_id,
          (SELECT f95_data.f95_id FROM f95_zone_data f95_data WHERE f95_data.atlas_id = am.atlas_id LIMIT 1),
          (SELECT f95_data2.f95_id FROM f95_zone_data f95_data2 JOIN atlas_data a2 ON a2.atlas_id = f95_data2.atlas_id WHERE LOWER(a2.title) = LOWER(g.title) LIMIT 1)
        ) AS f95_id,
        COALESCE(
          lm.lc_id,
          (SELECT lc_data.lc_id FROM lewdcorner_data lc_data WHERE lc_data.atlas_id = am.atlas_id LIMIT 1)
        ) AS lc_id,
        g.title,
        g.creator,
        g.notes,
        NULL AS rating,
        v.version AS installed_version,
        CASE WHEN v.version IS NOT NULL AND v.version != '' THEN 1 ELSE 0 END AS installed,
        CASE WHEN g.playstate = 'completed' THEN 1 ELSE 0 END AS installed_finished,
        0 AS is_wishlist
      FROM games g
      LEFT JOIN f95_zone_mappings fm ON fm.record_id = g.record_id
      LEFT JOIN atlas_mappings am ON am.record_id = g.record_id
      LEFT JOIN lewdcorner_mappings lm ON lm.record_id = g.record_id
      LEFT JOIN versions v ON v.record_id = g.record_id

      UNION ALL

      SELECT 
        w.wishlist_id AS record_id,
        COALESCE(
          w.f95_id,
          (SELECT f95_data.f95_id FROM f95_zone_data f95_data WHERE f95_data.atlas_id = w.atlas_id LIMIT 1)
        ) AS f95_id,
        COALESCE(
          w.lc_id,
          (SELECT lc_data.lc_id FROM lewdcorner_data lc_data WHERE lc_data.atlas_id = w.atlas_id LIMIT 1)
        ) AS lc_id,
        w.title,
        w.creator,
        w.note AS notes,
        w.rating,
        w.latest_version AS installed_version,
        0 AS installed,
        0 AS installed_finished,
        1 AS is_wishlist
      FROM wishlist_entries w
    `)

    return rows.map((r) => {
      const numericF95 = r.f95_id ? Number.parseInt(r.f95_id, 10) : null
      const numericLC = r.lc_id ? Number.parseInt(r.lc_id, 10) : null
      const id = numericF95 || numericLC || r.record_id

      return {
        id,
        f95Id: r.f95_id ? String(r.f95_id) : null,
        lcId: r.lc_id ? String(r.lc_id) : null,
        recordId: r.record_id,
        title: r.title || 'Untitled',
        creator: r.creator || 'Unknown',
        notes: r.notes || '',
        rating: r.rating || null,
        installed: Boolean(r.installed),
        installedVersion: r.installed_version || '',
        isFinished: Boolean(r.installed_finished),
        isWishlist: Boolean(r.is_wishlist),
        color: r.installed ? '#22c55e' : r.is_wishlist ? '#a855f7' : '#3b82f6',
        icon: r.installed ? 'installed' : r.is_wishlist ? 'wishlist' : 'tracked',
      }
    })
  } catch (err) {
    console.error('[ExtensionServer] Error fetching games list:', err)
    return []
  }
}

async function addGameUrl(rawUrl) {
  const info = extractThreadInfo(rawUrl)
  if (!info) return { success: false, reason: 'Invalid or unsupported forum thread URL' }

  const { forum, id, numericId, slugTitle } = info
  const db = getDb()
  if (!db) return { success: false, reason: 'Database uninitialized' }

  try {
    if (forum === 'f95') {
      const existingMapping = await queryDbGet(
        `SELECT record_id FROM f95_zone_mappings WHERE f95_id = ?`,
        [id],
      )
      if (existingMapping) {
        return { success: true, status: 'already_exists', recordId: existingMapping.record_id, f95Id: id }
      }
    } else if (forum === 'lewdcorner') {
      const existingLC = await queryDbGet(
        `SELECT record_id FROM lewdcorner_mappings WHERE lc_id = ?`,
        [id],
      )
      if (existingLC) {
        return { success: true, status: 'already_exists', recordId: existingLC.record_id, lcId: id }
      }
    }

    if (slugTitle) {
      const titleMatch = await queryDbGet(
        `SELECT record_id, title FROM games WHERE LOWER(title) = LOWER(?) LIMIT 1`,
        [slugTitle],
      )
      if (titleMatch) {
        if (forum === 'f95') {
          await queryDbRun(
            `INSERT OR REPLACE INTO f95_zone_mappings (record_id, f95_id) VALUES (?, ?)`,
            [titleMatch.record_id, id],
          )
        } else if (forum === 'lewdcorner') {
          await queryDbRun(
            `INSERT OR REPLACE INTO lewdcorner_mappings (record_id, lc_id) VALUES (?, ?)`,
            [titleMatch.record_id, id],
          )
        }
        return { success: true, status: 'linked_existing', recordId: titleMatch.record_id, f95Id: forum === 'f95' ? id : null, lcId: forum === 'lewdcorner' ? id : null }
      }
    }

    const formattedTitle = slugTitle
      ? slugTitle.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
      : `${forum.toUpperCase()} Thread ${id}`

    const wishlistModule = require('../db/wishlist')
    const wishlistRes = await wishlistModule.addWishlistEntry({
      source: forum,
      title: formattedTitle,
      creator: 'Unknown',
      siteUrl: rawUrl,
      f95_id: forum === 'f95' ? numericId : null,
      lc_id: forum === 'lewdcorner' ? numericId : null,
    })

    const BW = getBrowserWindow()
    if (BW) {
      BW.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) win.webContents.send('wishlist-updated')
      })
    }

    return {
      success: true,
      status: wishlistRes?.inLibrary ? 'linked_existing' : 'added_wishlist',
      recordId: wishlistRes?.recordId || wishlistRes?.identityKey,
      f95Id: id,
    }
  } catch (err) {
    console.error('[ExtensionServer] Error adding game URL:', err)
    return { success: false, reason: err.message }
  }
}

function handleRequest(req, res) {
  if (req.method === 'OPTIONS') {
    handleOptions(req, res)
    return
  }

  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`)
  const pathname = reqUrl.pathname

  if (req.method === 'GET') {
    if (pathname === '/games' || pathname === '/api/games') {
      getGamesList().then((games) => sendJson(res, 200, games))
      return
    }
    if (pathname === '/settings' || pathname === '/api/settings') {
      const config = getConfigFn ? getConfigFn() : {}
      const extConfig = config.Extension || {}
      sendJson(res, 200, {
        icon_glow: extConfig.iconGlow ?? true,
        highlight_tags: extConfig.highlightTags ?? false,
        tags_highlights: extConfig.tagHighlights ?? {},
        background_add: extConfig.backgroundAdd ?? true,
        rpc_port: activePort,
      })
      return
    }
    if (pathname === '/status' || pathname === '/api/status') {
      sendJson(res, 200, { status: 'ok', app: 'Atlas', version: '0.9.8' })
      return
    }
    sendResponse(res, 404, 'text/plain', 'Not Found')
    return
  }

  if (req.method === 'POST') {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', async () => {
      try {
        if (pathname === '/window/show' || pathname === '/api/window/show') {
          const BW = getBrowserWindow()
          const windows = BW ? BW.getAllWindows() : []
          if (windows.length > 0) {
            const mainWin = windows[0]
            if (mainWin.isMinimized()) mainWin.restore()
            mainWin.show()
            mainWin.focus()
          }
          sendJson(res, 200, { success: true })
          return
        }

        if (pathname === '/games/add' || pathname === '/api/games/add') {
          let urls = []
          try {
            const parsed = JSON.parse(body || '[]')
            urls = Array.isArray(parsed) ? parsed : [parsed]
          } catch {
            urls = [body]
          }

          const results = []
          for (const itemUrl of urls) {
            if (itemUrl) {
              const resObj = await addGameUrl(itemUrl)
              results.push(resObj)
            }
          }
          sendJson(res, 200, results.length === 1 ? results[0] : results)
          return
        }

        sendResponse(res, 404, 'text/plain', 'Not Found')
      } catch (err) {
        sendJson(res, 500, { error: err.message })
      }
    })
    return
  }

  sendResponse(res, 405, 'text/plain', 'Method Not Allowed')
}

function startExtensionServer(options = {}) {
  const port = options.port || activePort
  getConfigFn = options.getConfig || null

  if (server) {
    stopExtensionServer()
  }

  activePort = port
  server = http.createServer(handleRequest)

  server.on('error', (err) => {
    console.warn(`[ExtensionServer] Server error on localhost:${port}:`, err.message)
    if (err.code === 'EADDRINUSE') {
      console.warn(`[ExtensionServer] Port ${port} is already in use by another process.`)
    }
    server = null
  })

  try {
    server.listen(port, '127.0.0.1', () => {
      console.log(`[ExtensionServer] Atlas RPC server listening on http://127.0.0.1:${port}`)
    })
  } catch (err) {
    console.warn(`[ExtensionServer] Failed to listen on 127.0.0.1:${port}:`, err.message)
    server = null
  }
}

function stopExtensionServer() {
  if (server) {
    try {
      server.close()
    } catch {
      // Ignore cleanup error
    }
    server = null
  }
}

async function isExtensionServerRunning() {
  if (server !== null) return true
  try {
    return await new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${activePort}/api/status`, (res) => {
        resolve(res.statusCode === 200)
      })
      req.on('error', () => resolve(false))
      req.setTimeout(300, () => {
        req.destroy()
        resolve(false)
      })
    })
  } catch {
    return false
  }
}

module.exports = {
  startExtensionServer,
  stopExtensionServer,
  isExtensionServerRunning,
  extractThreadInfo,
}
