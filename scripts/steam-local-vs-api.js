'use strict'

// Reconciles what the Steam CLIENT thinks is in your library against what the
// Web API reports as owned, and names the difference.
//
// This exists because GetOwnedGames returning 191 for every possible parameter
// combination rules out response filtering as the cause of a missing title. If
// no flag changes the answer, the account genuinely does not hold an *owned*
// license for that app — yet it is in the library and has been played. Only a few
// license types behave that way, and the client records them locally even though
// the Web API does not report them:
//
//   Family Sharing / Steam Families
//       Someone else's license. Appears in your library UI, accrues playtime on
//       your account, and is never returned by GetOwnedGames. This is by far the
//       most common cause and is invisible from the API side alone — the API
//       cannot report what the account does not own.
//   Playtest access
//       A separate app id granted for a limited playtest. In the library, has
//       playtime, not owned.
//   Free weekend / timed free access
//       A temporary grant. Present while active, never "owned".
//   Demos
//       Own app id, type 'demo'. GetOwnedGames only returns type 'game'.
//
// localconfig.vdf holds per-app playtime for THIS account, so anything played
// appears there regardless of who owns the license. sharedconfig.vdf holds the
// library's category/hidden assignments, which covers apps in the library that
// were never launched. Together they are a superset of the library, and anything
// in that superset but absent from the API's owned list is the answer.
//
// Usage (from the repo root):
//   node scripts/steam-local-vs-api.js <apiKey> <steamId64>
//   STEAM_API_KEY=… STEAM_ID=… node scripts/steam-local-vs-api.js
//
// Optional:
//   --appid N     Also report on this specific app id, even if it is not in the
//                 local files. Repeatable.
//   --all         List every local-only app, not just the played ones.
//
// Reads Steam's own config files and nothing of Atlas's. Writes nothing. Never
// prints the API key.

const fs = require('fs')
const path = require('path')

const OWNED_URL = 'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/'
const STEAMCMD_URL = 'https://api.steamcmd.net/v1/info'

const argv = process.argv.slice(2)
const VALUE_FLAGS = new Set(['--appid'])
const positional = argv.filter((arg, i) => {
  if (arg.startsWith('--')) return false
  if (i > 0 && VALUE_FLAGS.has(argv[i - 1])) return false
  return true
})
const apiKey = (positional[0] || process.env.STEAM_API_KEY || '').trim()
const steamId = (positional[1] || process.env.STEAM_ID || '').trim()
const showAll = argv.includes('--all')
const extraAppIds = []
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--appid' && argv[i + 1]) extraAppIds.push(String(argv[i + 1]).trim())
}

if (!/^[0-9A-Fa-f]{32}$/.test(apiKey) || !/^\d{17}$/.test(steamId)) {
  console.error('Usage: node scripts/steam-local-vs-api.js <32-hex apiKey> <17-digit steamId64> [--appid N] [--all]')
  process.exit(1)
}

// SteamID64 -> the 32-bit account id used for the userdata folder name.
const STEAMID64_BASE = 76561197960265728n
const accountId = String(BigInt(steamId) - STEAMID64_BASE)

// ── Locating Steam ──────────────────────────────────────────────────────────

function steamRoots() {
  const candidates = []
  if (process.env['ProgramFiles(x86)']) candidates.push(path.join(process.env['ProgramFiles(x86)'], 'Steam'))
  if (process.env.ProgramFiles) candidates.push(path.join(process.env.ProgramFiles, 'Steam'))
  candidates.push('C:\\Steam')
  if (process.env.HOME) {
    candidates.push(path.join(process.env.HOME, '.steam', 'steam'))
    candidates.push(path.join(process.env.HOME, '.local', 'share', 'Steam'))
  }
  return candidates.filter((root) => {
    try { return fs.existsSync(path.join(root, 'userdata')) } catch { return false }
  })
}

// ── Minimal VDF traversal ───────────────────────────────────────────────────
//
// Only two things are needed from these files, so this walks braces rather than
// building a real parser: find a named block, then read the immediate child keys
// inside it. Robust enough for the shapes involved and avoids a dependency.

function findBlock(text, keyName, fromIndex = 0) {
  const needle = `"${keyName}"`
  let at = text.indexOf(needle, fromIndex)
  while (at !== -1) {
    const open = text.indexOf('{', at)
    if (open === -1) return null
    // Only accept it if the brace follows the key with nothing but whitespace,
    // otherwise this is a key/value pair that happens to share the name.
    if (/^\s*$/.test(text.slice(at + needle.length, open))) {
      let depth = 0
      for (let i = open; i < text.length; i += 1) {
        if (text[i] === '{') depth += 1
        else if (text[i] === '}') {
          depth -= 1
          if (depth === 0) return { body: text.slice(open + 1, i), end: i }
        }
      }
      return null
    }
    at = text.indexOf(needle, at + needle.length)
  }
  return null
}

// Immediate child blocks keyed by a numeric id, with their scalar fields.
function numericChildBlocks(body) {
  const out = new Map()
  const re = /"(\d+)"\s*\{/g
  let match
  while ((match = re.exec(body)) !== null) {
    const appid = match[1]
    let depth = 1
    let i = match.index + match[0].length
    const start = i
    for (; i < body.length && depth > 0; i += 1) {
      if (body[i] === '{') depth += 1
      else if (body[i] === '}') depth -= 1
    }
    const inner = body.slice(start, i - 1)
    const fields = {}
    const fre = /"([^"]+)"\s*"([^"]*)"/g
    let f
    while ((f = fre.exec(inner)) !== null) fields[f[1].toLowerCase()] = f[2]
    out.set(appid, fields)
    re.lastIndex = i
  }
  return out
}

function readLocalApps() {
  const found = new Map() // appid -> { playtime, lastPlayed, sources:Set }
  const note = (appid, data, source) => {
    const entry = found.get(appid) || { playtime: 0, lastPlayed: 0, sources: new Set() }
    entry.playtime = Math.max(entry.playtime, Number(data.playtime || 0) || 0)
    entry.lastPlayed = Math.max(entry.lastPlayed, Number(data.lastplayed || 0) || 0)
    entry.sources.add(source)
    found.set(appid, entry)
  }

  for (const root of steamRoots()) {
    const userDir = path.join(root, 'userdata', accountId)
    if (!fs.existsSync(userDir)) continue

    // Per-app playtime for this account. Anything ever launched is here.
    const localConfig = path.join(userDir, 'config', 'localconfig.vdf')
    try {
      const text = fs.readFileSync(localConfig, 'utf-8')
      const apps = findBlock(text, 'apps')
      if (apps) {
        for (const [appid, fields] of numericChildBlocks(apps.body)) {
          note(appid, fields, 'localconfig')
        }
      }
    } catch { /* not readable */ }

    // Library categories / hidden flags. Covers library entries never launched.
    const sharedConfig = path.join(userDir, '7', 'remote', 'sharedconfig.vdf')
    try {
      const text = fs.readFileSync(sharedConfig, 'utf-8')
      const apps = findBlock(text, 'Apps') || findBlock(text, 'apps')
      if (apps) {
        for (const [appid, fields] of numericChildBlocks(apps.body)) {
          note(appid, fields, 'sharedconfig')
        }
      }
    } catch { /* not readable */ }
  }
  return found
}

// ── Steam calls ─────────────────────────────────────────────────────────────

async function ownedAppIds() {
  const params = new URLSearchParams({
    key: apiKey,
    input_json: JSON.stringify({
      steamid: steamId,
      include_appinfo: true,
      include_played_free_games: true,
      include_free_sub: true,
      skip_unvetted_apps: false,
    }),
    format: 'json',
  })
  const res = await fetch(`${OWNED_URL}?${params.toString()}`)
  if (!res.ok) throw new Error(`GetOwnedGames HTTP ${res.status}`)
  const json = await res.json()
  const games = (json && json.response && json.response.games) || []
  return new Map(games.map((g) => [String(g.appid), g.name || '']))
}

async function appInfo(appid) {
  try {
    const res = await fetch(`${STEAMCMD_URL}/${appid}`)
    if (!res.ok) return { error: `HTTP ${res.status}` }
    const json = await res.json()
    const app = (json && json.data && json.data[appid]) || {}
    const common = app.common || {}
    const extended = app.extended || {}
    return {
      name: common.name || '',
      type: (common.type || '').toLowerCase(),
      releaseState: common.releasestate || '',
      // Present on playtest apps and on apps that gate access.
      parent: extended.dependantonapp || common.parent || '',
    }
  } catch (err) {
    return { error: err.message }
  }
}

// ── Report ──────────────────────────────────────────────────────────────────

function explain(info, entry) {
  if (info.error) return 'could not resolve appinfo'
  if (info.type === 'demo') return 'DEMO — separate app id, never returned as owned'
  if (info.type && info.type !== 'game') return `type '${info.type}' — GetOwnedGames only returns type 'game'`
  if (info.parent) return `playtest//dependent app (parent ${info.parent}) — access grant, not a license`
  if (entry && entry.playtime > 0) {
    return 'type game, played on this account, but NOT owned by it — this is the Family '
      + 'Sharing / Steam Families signature, or a timed free-access grant'
  }
  return 'type game, in the library, not owned by this account'
}

const fmtMinutes = (m) => (m >= 60 ? `${Math.round(m / 60)}h` : `${m}m`)

async function main() {
  const roots = steamRoots()
  console.log(`\nSteam install(s): ${roots.length ? roots.join(', ') : '(none found)'}`)
  console.log(`Account id (from SteamID64): ${accountId}`)

  const local = readLocalApps()
  console.log(`Local records: ${local.size} app(s) across localconfig/sharedconfig`)

  if (local.size === 0) {
    console.log('\nNo local records found. Either the userdata folder for this account id does')
    console.log('not exist (wrong SteamID64?), or Steam is installed somewhere unusual.')
    return
  }

  let owned
  try {
    owned = await ownedAppIds()
  } catch (err) {
    console.log(`\nCould not fetch the owned list: ${err.message}`)
    return
  }
  console.log(`API reports owned: ${owned.size} app(s)\n`)

  const localOnly = [...local.entries()]
    .filter(([appid]) => !owned.has(appid))
    .map(([appid, entry]) => ({ appid, ...entry }))
    .sort((a, b) => b.playtime - a.playtime)

  const shortlist = showAll ? localOnly : localOnly.filter((e) => e.playtime > 0)

  console.log(`${'='.repeat(78)}`)
  console.log(`IN LIBRARY LOCALLY, NOT REPORTED OWNED BY THE API: ${localOnly.length}`)
  console.log(`  (showing ${shortlist.length}${showAll ? '' : ' with playtime > 0; pass --all for the rest'})`)
  console.log(`${'='.repeat(78)}\n`)

  const targets = [...shortlist.map((e) => e.appid), ...extraAppIds.filter((id) => !local.has(id))]

  for (const appid of targets) {
    const entry = local.get(appid) || null
    const info = await appInfo(appid)
    const name = info.name || '(unknown)'
    console.log(`  ${String(appid).padEnd(9)} ${name}`)
    console.log(`  ${' '.repeat(9)} playtime=${entry ? fmtMinutes(entry.playtime) : 'n/a'}` +
      `  seen in: ${entry ? [...entry.sources].join('+') : 'not in local files'}`)
    console.log(`  ${' '.repeat(9)} -> ${explain(info, entry)}\n`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  console.log('Anything reported as the Family Sharing signature cannot be fixed in Atlas: the')
  console.log('Web API has no endpoint that lists games shared TO you, because your account')
  console.log('does not hold the license. Adding those to Atlas means adding them by hand, or')
  console.log('reading these same local files at import time.\n')
}

main().catch((err) => {
  console.error('Failed:', err.message)
  process.exit(1)
})
