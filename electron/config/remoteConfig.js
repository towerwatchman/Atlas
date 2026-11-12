'use strict'

// Fetches site-scraping config from the atlas-client-configs branch, keyed by
// build channel (stable/nightly). Falls back to the bundled file on failure.

const axios = require('axios')

// Current source. Moves to towerwatchman/Atlas when the branch is upstreamed.
const CONFIG_REPO = 'codeon89/Atlas-Patched'
const CONFIG_BRANCH = 'atlas-client-configs'

// In-memory cache for the session. filename → parsed JSON object.
const remoteConfigs = {}

async function fetchRemoteConfig(channel, filename) {
  const url = `https://raw.githubusercontent.com/${CONFIG_REPO}/${CONFIG_BRANCH}/${channel}/${filename}`
  try {
    const { data } = await axios.get(url, { timeout: 10000 })
    // Only a plain object is usable; a JSON scalar, array, or error page
    // would otherwise be cached and shadow the bundled file for the session.
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('remote config is not an object')
    }
    remoteConfigs[filename] = data
    console.log(`[remote-config] ${filename}: using remote (${channel})`)
  } catch {
    console.log(`[remote-config] ${filename}: fetch failed, using bundled`)
  }
}

function getRemoteConfig(filename) {
  return remoteConfigs[filename] || null
}

// Test hook: drop the session cache.
function clearRemoteConfigs() {
  for (const key of Object.keys(remoteConfigs)) delete remoteConfigs[key]
}

module.exports = { fetchRemoteConfig, getRemoteConfig, clearRemoteConfigs }
