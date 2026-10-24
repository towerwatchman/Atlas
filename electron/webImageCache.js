'use strict'

// Chromium does not expose its HTTP disk cache size or entry count via API —
// the only source of truth is the Cache_Data folder on disk. The default
// session's cache lives at <userData>/Cache/Cache_Data in current Electron;
// other layouts keep the same folder name at a nearby depth, so known shapes
// are tried in order. Used by the Settings -> Metadata "Clear image cache"
// row to show an approximate size (a count of entries is unobtainable: the
// cache is a blockfile, so file counts would be meaningless).

const path = require('path')
const fsp = require('fs/promises')
const { calculatePathSize } = require('./pathSize')

// Relative shapes under the userData root, tried in order.
const DEFAULT_SHAPES = ['Cache/Cache_Data', 'Cache_Data', 'Media Cache/Cache_Data']

/** First candidate that exists on disk, or null when the cache isn't there. */
async function resolveWebImageCacheDir(userDataDir, shapes) {
  for (const shape of shapes || DEFAULT_SHAPES) {
    const dir = path.join(userDataDir, shape)
    try {
      const stat = await fsp.stat(dir)
      if (stat.isDirectory()) return dir
    } catch {
      // Try the next shape.
    }
  }
  return null
}

/**
 * { dir, exists, sizeBytes } for the default session's HTTP cache.
 * The size is approximate: Chromium flushes writes asynchronously, so the
 * folder can lag what's actually resident by a few seconds.
 */
async function webImageCacheInfo(userDataDir) {
  const dir = await resolveWebImageCacheDir(userDataDir)
  if (!dir) return { dir: null, exists: false, sizeBytes: 0 }
  const result = await calculatePathSize(dir)
  return { dir, exists: result?.missing !== true, sizeBytes: result?.sizeBytes ?? 0 }
}

module.exports = { resolveWebImageCacheDir, webImageCacheInfo }
