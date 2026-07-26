'use strict'

// Per-app diagnostic for "this game is in my Steam library but Atlas never sees it".
//
// steam-owned-probe.js answers "which parameter set returns the most games".
// This answers the more useful question for a specific title: does Steam admit
// the account owns it, what app TYPE does Steam think it is, and does the store
// serve details for it. Those three facts together identify the cause, because
// each has a different and non-overlapping fix:
//
//   owned=no                  → not licensed to this account (Family Sharing, or
//                               a free-weekend/temporary grant). No parameter can
//                               surface it; nothing to fix in Atlas.
//   owned=yes, type != game   → GetOwnedGames only returns apps of type 'game'.
//                               Demos, soundtracks, tools, applications and
//                               videos are excluded no matter what flags are set.
//                               Needs a different endpoint, not a different flag.
//   owned=yes, type=game,     → the app is real, licensed and a game, and was
//   but absent from the           filtered out of the response. That is the
//   unfiltered list               unvetted/mature bucket, and it means the
//                               skip_unvetted_apps spelling Atlas uses is being
//                               ignored — compare against the input_json result
//                               printed below.
//   store success=false but   → mature-gated. Expected; the scanner's
//   ok with age cookies          birthtime/mature_content cookies handle it once
//                               the app is in the library at all.
//
// Usage (from the repo root):
//   node scripts/steam-appid-probe.js <apiKey> <steamId64> --appid 1234560
//   node scripts/steam-appid-probe.js <apiKey> <steamId64> --find "come home"
//
// --find resolves a name to an appid by reading the local Steam appmanifest
// files, which works for anything installed and does not depend on the app
// having a store page (delisted and mature-gated titles have manifests like
// anything else). Repeat either flag to check several apps in one run.
//
// Reads nothing of Atlas's, writes nothing, never prints the API key.

const fs = require('fs')
const path = require('path')

const OWNED_URL = 'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/'
const APPDETAILS_URL = 'https://store.steampowered.com/api/appdetails'
// Community mirror of Steam's own appinfo. Unlike the storefront it answers for
// delisted and mature-gated apps, which is exactly the case being diagnosed.
const STEAMCMD_URL = 'https://api.steamcmd.net/v1/info'

// A unix timestamp for an adult date of birth. Without these the storefront
// silently omits data (or refuses outright) for mature-gated apps.
const AGE_GATE_COOKIE = 'birthtime=568022401; mature_content=1; wants_mature_content=1'

// ── Args ────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const positional = argv.filter((a) => !a.startsWith('--'))
const apiKey = (positional[0] || process.env.STEAM_API_KEY || '').trim()
const steamId = (positional[1] || process.env.STEAM_ID || '').trim()

const appIds = []
const findNames = []
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--appid' && argv[i + 1]) appIds.push(String(argv[i + 1]).trim())
  if (argv[i] === '--find' && argv[i + 1]) findNames.push(String(argv[i + 1]).trim())
}

if (!/^[0-9A-Fa-f]{32}$/.test(apiKey) || !/^\d{17}$/.test(steamId)) {
  console.error('Usage: node scripts/steam-appid-probe.js <32-hex apiKey> <17-digit steamId64> [--appid N] [--find "name"]')
  process.exit(1)
}
if (appIds.length === 0 && findNames.length === 0) {
  console.error('Give at least one --appid or --find.')
  process.exit(1)
}

// ── Local appmanifest scan (name -> appid) ──────────────────────────────────

function steamRootCandidates() {
  const roots = []
  if (process.env.ProgramFiles) roots.push(path.join(process.env.ProgramFiles, 'Steam'))
  if (process.env['ProgramFiles(x86)']) roots.push(path.join(process.env['ProgramFiles(x86)'], 'Steam'))
  roots.push('C:\\Steam', 'C:\\Program Files (x86)\\Steam')
  if (process.env.HOME) {
    roots.push(path.join(process.env.HOME, '.steam', 'steam'))
    roots.push(path.join(process.env.HOME, '.local', 'share', 'Steam'))
  }
  return roots.filter((root) => {
    try { return fs.existsSync(path.join(root, 'steamapps')) } catch { return false }
  })
}

// libraryfolders.vdf lists every drive Steam installs to. Parsed by regex rather
// than a real VDF parser because the only field needed is "path".
function libraryPaths() {
  const libs = new Set()
  for (const root of steamRootCandidates()) {
    const steamapps = path.join(root, 'steamapps')
    libs.add(steamapps)
    const vdf = path.join(steamapps, 'libraryfolders.vdf')
    try {
      const text = fs.readFileSync(vdf, 'utf-8')
      const re = /"path"\s*"([^"]+)"/g
      let match
      while ((match = re.exec(text)) !== null) {
        libs.add(path.join(match[1].replace(/\\\\/g, '\\'), 'steamapps'))
      }
    } catch { /* no vdf on this root */ }
  }
  return [...libs]
}

function scanManifests() {
  const found = []
  for (const lib of libraryPaths()) {
    let entries = []
    try { entries = fs.readdirSync(lib) } catch { continue }
    for (const entry of entries) {
      if (!/^appmanifest_\d+\.acf$/i.test(entry)) continue
      try {
        const text = fs.readFileSync(path.join(lib, entry), 'utf-8')
        const appid = (text.match(/"appid"\s*"(\d+)"/) || [])[1]
        const name = (text.match(/"name"\s*"([^"]*)"/) || [])[1]
        if (appid) found.push({ appid, name: name || '', manifest: path.join(lib, entry) })
      } catch { /* unreadable manifest */ }
    }
  }
  return found
}

// ── Steam calls ─────────────────────────────────────────────────────────────

async function ownedFilter(appid, useInputJson) {
  // appids_filter is a repeated protobuf field. input_json is the reliable way to
  // send it; the bracket form is tried too so the two can be compared, since a
  // difference between them is itself the finding.
  const params = useInputJson
    ? new URLSearchParams({
      key: apiKey,
      input_json: JSON.stringify({
        steamid: steamId,
        appids_filter: [Number(appid)],
        include_appinfo: true,
        include_played_free_games: true,
        include_free_sub: true,
        skip_unvetted_apps: false,
      }),
      format: 'json',
    })
    : new URLSearchParams({
      key: apiKey,
      steamid: steamId,
      'appids_filter[0]': appid,
      include_appinfo: '1',
      include_played_free_games: '1',
      include_free_sub: '1',
      skip_unvetted_apps: '0',
      format: 'json',
    })

  try {
    const res = await fetch(`${OWNED_URL}?${params.toString()}`)
    if (!res.ok) return { error: `HTTP ${res.status}` }
    const json = await res.json()
    const games = (json && json.response && json.response.games) || []
    const hit = games.find((g) => String(g.appid) === String(appid))
    return { owned: Boolean(hit), name: hit ? (hit.name || '') : '', playtime: hit ? hit.playtime_forever || 0 : 0 }
  } catch (err) {
    return { error: err.message }
  }
}

async function storeDetails(appid, withAgeGate) {
  try {
    const res = await fetch(`${APPDETAILS_URL}?appids=${appid}&l=english&cc=us`, {
      headers: withAgeGate ? { Cookie: AGE_GATE_COOKIE } : {},
    })
    if (!res.ok) return { error: `HTTP ${res.status}` }
    const json = await res.json()
    const entry = json && json[appid]
    if (!entry) return { success: false }
    return {
      success: entry.success === true,
      name: entry.data ? entry.data.name : '',
      type: entry.data ? entry.data.type : '',
      isFree: entry.data ? entry.data.is_free : null,
    }
  } catch (err) {
    return { error: err.message }
  }
}

async function steamcmdInfo(appid) {
  try {
    const res = await fetch(`${STEAMCMD_URL}/${appid}`)
    if (!res.ok) return { error: `HTTP ${res.status}` }
    const json = await res.json()
    const app = json && json.data && json.data[appid]
    const common = (app && app.common) || {}
    return {
      name: common.name || '',
      type: (common.type || '').toLowerCase(),
      // Steam marks store-hidden apps here; the exact keys vary by app.
      releaseState: common.releasestate || '',
      contentDescriptors: common.content_descriptors
        ? Object.values(common.content_descriptors).join(',')
        : '',
    }
  } catch (err) {
    return { error: err.message }
  }
}

// ── Report ──────────────────────────────────────────────────────────────────

function verdict({ ownedJson, ownedQuery, cmd, storeBare, storeAged }) {
  const type = (cmd && cmd.type) || (storeAged && storeAged.type) || 'unknown'

  if (!ownedJson.owned && !ownedQuery.owned) {
    return 'NOT LICENSED to this account. GetOwnedGames does not report it owned under any '
      + 'parameter form, so no Atlas change can surface it. Family Sharing and expired '
      + 'free-weekend grants both look like this.'
  }
  if (type && type !== 'game' && type !== 'unknown') {
    return `OWNED, but Steam types it as '${type}', and GetOwnedGames only returns type 'game'. `
      + 'No flag changes that — it would need a separate endpoint or a local appmanifest read.'
  }
  if (ownedJson.owned && !ownedQuery.owned) {
    return 'OWNED, and returned ONLY by the input_json form. The query-string spelling Atlas '
      + 'currently uses is being ignored, so fetchOwnedGames should be switched to input_json.'
  }
  if (ownedJson.owned && ownedQuery.owned) {
    return 'OWNED and returned by both forms. If Atlas still does not list it, the request is '
      + 'reaching Steam correctly and the gap is downstream — check for a stale ownedCache or '
      + 'a filter in the importer UI, not in the API call.'
  }
  return 'Inconclusive; see the raw rows above.'
}

async function main() {
  const targets = [...appIds.map((appid) => ({ appid, from: 'flag' }))]

  if (findNames.length > 0) {
    const manifests = scanManifests()
    console.log(`\nScanned ${manifests.length} local appmanifest file(s).`)
    for (const wanted of findNames) {
      const needle = wanted.toLowerCase()
      const matches = manifests.filter((m) => m.name.toLowerCase().includes(needle))
      if (matches.length === 0) {
        console.log(`  --find "${wanted}": no installed match. Not installed, or installed to a `
          + 'library folder this script could not locate. Get the App ID from the Steam client '
          + '(right-click the game -> Properties -> Updates) and pass --appid instead.')
        continue
      }
      for (const m of matches) {
        console.log(`  --find "${wanted}" -> ${m.appid}  ${m.name}`)
        targets.push({ appid: m.appid, from: m.name })
      }
    }
  }

  if (targets.length === 0) {
    console.log('\nNothing to probe.')
    return
  }

  for (const target of targets) {
    const { appid } = target
    console.log(`\n${'='.repeat(72)}\nAppID ${appid}${target.from !== 'flag' ? `  (${target.from})` : ''}\n${'='.repeat(72)}`)

    const ownedJson = await ownedFilter(appid, true)
    const ownedQuery = await ownedFilter(appid, false)
    const cmd = await steamcmdInfo(appid)
    const storeBare = await storeDetails(appid, false)
    const storeAged = await storeDetails(appid, true)

    const show = (label, value) => console.log(`  ${label.padEnd(34)} ${value}`)

    show('owned (input_json form)', ownedJson.error ? `error: ${ownedJson.error}`
      : `${ownedJson.owned ? 'YES' : 'no'}${ownedJson.owned ? `  name="${ownedJson.name || '(none)'}"  ${ownedJson.playtime}min` : ''}`)
    show('owned (query-string form)', ownedQuery.error ? `error: ${ownedQuery.error}`
      : `${ownedQuery.owned ? 'YES' : 'no'}${ownedQuery.owned ? `  name="${ownedQuery.name || '(none)'}"  ${ownedQuery.playtime}min` : ''}`)
    show('appinfo type (steamcmd)', cmd.error ? `error: ${cmd.error}` : `${cmd.type || '(unknown)'}  name="${cmd.name}"`)
    show('appinfo releaseState', cmd.error ? '-' : (cmd.releaseState || '(none)'))
    show('content descriptors', cmd.error ? '-' : (cmd.contentDescriptors || '(none)'))
    show('store appdetails (no cookie)', storeBare.error ? `error: ${storeBare.error}`
      : `success=${storeBare.success}${storeBare.success ? `  type=${storeBare.type}  free=${storeBare.isFree}` : ''}`)
    show('store appdetails (age cookie)', storeAged.error ? `error: ${storeAged.error}`
      : `success=${storeAged.success}${storeAged.success ? `  type=${storeAged.type}  free=${storeAged.isFree}` : ''}`)

    console.log(`\n  VERDICT: ${verdict({ ownedJson, ownedQuery, cmd, storeBare, storeAged })}`)
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  console.log('')
}

main().catch((err) => {
  console.error('Probe failed:', err.message)
  process.exit(1)
})
