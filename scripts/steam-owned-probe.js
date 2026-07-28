'use strict'

// Standalone diagnostic for GetOwnedGames filtering.
//
// GetOwnedGames does not return a full library by default — it applies several
// filters, and the flags that disable them are protobuf fields that are not in
// the older published docs. Whether a given form is honoured is not something
// worth guessing at, so this probe asks Steam directly: it runs the same request
// with several parameter permutations and diffs the returned appid sets.
//
// Usage (from the repo root):
//   node scripts/steam-owned-probe.js <apiKey> <steamId64>
//   STEAM_API_KEY=… STEAM_ID=… node scripts/steam-owned-probe.js
//
// Extra modes, for tracking down a specific missing title when it is NOT
// installed (so there is no local appmanifest to resolve its name from):
//
//   --nameless          After the permutation table, take the fullest owned list,
//                       find every entry Steam returned WITHOUT a name, and
//                       resolve each one through Steam's appinfo. Delisted and
//                       mature-gated apps arrive nameless because their name
//                       lives in store data they have no store page for — so a
//                       game can be present in the response and still be
//                       unrecognisable in a list of 191. This names them.
//   --search "<name>"   Resolve a title to an appid through the storefront search
//                       with mature-content cookies set. Works for age-gated
//                       titles; will NOT find anything fully delisted, which has
//                       no store page to search.
//   --dump <file.json>  Write the full normalised list to disk, so a title can be
//                       grepped for directly instead of eyeballed in a terminal.
//
// Reads nothing, writes nothing, touches no Atlas state. Safe to run any time.
// The API key is never printed.

const OWNED_GAMES_URL = 'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/'

const argv = process.argv.slice(2)

// Flags that consume the following argument. Their VALUES must not be mistaken
// for positional args — otherwise `--search "come home"` with the key supplied
// via STEAM_API_KEY would treat "come home" as the API key and reject it.
const VALUE_FLAGS = new Set(['--search', '--dump'])
const positional = argv.filter((arg, i) => {
  if (arg.startsWith('--')) return false
  if (i > 0 && VALUE_FLAGS.has(argv[i - 1])) return false
  return true
})

const apiKey = (positional[0] || process.env.STEAM_API_KEY || '').trim()
const steamId = (positional[1] || process.env.STEAM_ID || '').trim()

const wantNameless = argv.includes('--nameless')
const searchTerms = []
let dumpPath = null
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--search' && argv[i + 1]) searchTerms.push(String(argv[i + 1]).trim())
  if (argv[i] === '--dump' && argv[i + 1]) dumpPath = String(argv[i + 1]).trim()
}

const fs = require('fs')

// Community mirror of Steam's own appinfo. Unlike the storefront it answers for
// delisted and mature-gated apps, which is the entire point here.
const STEAMCMD_URL = 'https://api.steamcmd.net/v1/info'
const STORESEARCH_URL = 'https://store.steampowered.com/api/storesearch/'
// Unix timestamp for an adult date of birth; without it the storefront hides
// mature-gated titles from search results entirely.
const AGE_GATE_COOKIE = 'birthtime=568022401; mature_content=1; wants_mature_content=1'

async function steamcmdName(appid) {
  try {
    const res = await fetch(`${STEAMCMD_URL}/${appid}`)
    if (!res.ok) return { error: `HTTP ${res.status}` }
    const json = await res.json()
    const common = ((json && json.data && json.data[appid]) || {}).common || {}
    return {
      name: common.name || '',
      type: (common.type || '').toLowerCase(),
      releaseState: common.releasestate || '',
    }
  } catch (err) {
    return { error: err.message }
  }
}

async function storeSearch(term) {
  try {
    const url = `${STORESEARCH_URL}?term=${encodeURIComponent(term)}&l=english&cc=us`
    const res = await fetch(url, { headers: { Cookie: AGE_GATE_COOKIE } })
    if (!res.ok) return { error: `HTTP ${res.status}` }
    const json = await res.json()
    return { items: Array.isArray(json.items) ? json.items : [] }
  } catch (err) {
    return { error: err.message }
  }
}

if (!/^[0-9A-Fa-f]{32}$/.test(apiKey) || !/^\d{17}$/.test(steamId)) {
  console.error('Usage: node scripts/steam-owned-probe.js <apiKey> <steamId64> [flags]')
  console.error('   or: STEAM_API_KEY=… STEAM_ID=… node scripts/steam-owned-probe.js [flags]')
  console.error('')
  console.error('  apiKey    32 hex characters, from https://steamcommunity.com/dev/apikey')
  console.error('  steamId64 17 digits, starting 7656119…  (Steam profile -> the long numeric id)')
  console.error('')
  console.error('  Flags: --nameless  --dump <file.json>  --search "<title>"')
  console.error('')
  console.error(`  Got apiKey=${apiKey ? `${apiKey.length} chars` : '(none)'}, steamId=${steamId ? `${steamId.length} digits` : '(none)'}`)
  process.exit(1)
}

// Each variant layers one more filter-disabling flag onto the baseline, so the
// output attributes any gain to a specific parameter rather than to the set as a
// whole. Both the 0/1 and true/false spellings are tried because Steam's WebAPI
// bool coercion is not documented, and an unrecognised parameter is silently
// ignored rather than rejected — a wrong spelling looks exactly like a flag that
// does not work.
const BASE = {
  include_appinfo: '1',
  include_played_free_games: '1',
  format: 'json',
}

const VARIANTS = [
  { label: 'baseline (what Atlas sent before)', params: {} },
  { label: '+ include_free_sub=1', params: { include_free_sub: '1' } },
  { label: '+ include_free_sub=true', params: { include_free_sub: 'true' } },
  { label: '+ skip_unvetted_apps=0', params: { skip_unvetted_apps: '0' } },
  { label: '+ skip_unvetted_apps=false', params: { skip_unvetted_apps: 'false' } },
  {
    label: '+ both (0/1 form) — what Atlas sends now',
    params: { include_free_sub: '1', skip_unvetted_apps: '0' },
  },
  {
    label: '+ both (true/false form)',
    params: { include_free_sub: 'true', skip_unvetted_apps: 'false' },
  },
  {
    label: '+ both, via input_json',
    inputJson: {
      steamid: steamId,
      include_appinfo: true,
      include_played_free_games: true,
      include_free_sub: true,
      skip_unvetted_apps: false,
    },
  },
]

async function fetchVariant(variant) {
  let url
  if (variant.inputJson) {
    // The protobuf-native form. If the query-string spellings are being dropped
    // but this one works, that is the answer.
    const params = new URLSearchParams({
      key: apiKey,
      input_json: JSON.stringify(variant.inputJson),
      format: 'json',
    })
    url = `${OWNED_GAMES_URL}?${params.toString()}`
  } else {
    const params = new URLSearchParams({
      key: apiKey,
      steamid: steamId,
      ...BASE,
      ...variant.params,
    })
    url = `${OWNED_GAMES_URL}?${params.toString()}`
  }

  const res = await fetch(url)
  if (!res.ok) return { error: `HTTP ${res.status}` }
  const json = await res.json()
  const response = (json && json.response) || {}
  const games = Array.isArray(response.games) ? response.games : []
  return {
    reportedCount: response.game_count,
    games: games.map((g) => ({
      appid: String(g.appid),
      name: typeof g.name === 'string' ? g.name.trim() : '',
      playtime: g.playtime_forever || 0,
    })),
  }
}

const pad = (value, width) => String(value).padEnd(width)

async function main() {
  console.log(`\nProbing GetOwnedGames for ${steamId}\n`)

  const results = []
  for (const variant of VARIANTS) {
    let result
    try {
      result = await fetchVariant(variant)
    } catch (err) {
      result = { error: err.message }
    }
    results.push({ variant, result })

    if (result.error) {
      console.log(`${pad(variant.label, 44)} ERROR: ${result.error}`)
    } else {
      console.log(
        `${pad(variant.label, 44)} games=${pad(result.games.length, 5)}` +
        `game_count=${pad(result.reportedCount ?? '-', 6)}` +
        `nameless=${result.games.filter((g) => !g.name).length}`,
      )
    }
    // Courtesy delay; the endpoint is rate limited per key.
    await new Promise((resolve) => setTimeout(resolve, 400))
  }

  const baseline = results[0]
  if (baseline.result.error) {
    console.log('\nBaseline failed, so there is nothing to diff against.')
    return
  }
  const baselineIds = new Set(baseline.result.games.map((g) => g.appid))

  // The interesting output: which apps a variant returns that the baseline did
  // not. 'nameless' entries are the delisted / mature-gated ones — they have no
  // store page, so appinfo has no name to give.
  for (const { variant, result } of results.slice(1)) {
    if (result.error) continue
    const gained = result.games.filter((g) => !baselineIds.has(g.appid))
    if (gained.length === 0) continue
    console.log(`\n── ${variant.label}: +${gained.length} app(s) over baseline ──`)
    for (const g of gained) {
      const label = g.name || '(no name — delisted or mature-gated)'
      console.log(`   ${pad(g.appid, 9)} ${pad(label, 52)} ${g.playtime}min`)
    }
  }

  // The fullest list any variant produced is the best available picture of the
  // library, so the analysis below uses that rather than the baseline.
  const best = results
    .filter((r) => !r.result.error)
    .sort((a, b) => b.result.games.length - a.result.games.length)[0]

  if (dumpPath && best) {
    try {
      fs.writeFileSync(dumpPath, JSON.stringify(best.result.games, null, 2))
      console.log(`\nWrote ${best.result.games.length} entries to ${dumpPath} (from: ${best.variant.label}).`)
      console.log(`Grep it directly, e.g.:  findstr /i "bloodlines" ${dumpPath}`)
    } catch (err) {
      console.log(`\nCould not write ${dumpPath}: ${err.message}`)
    }
  }

  if (wantNameless && best) {
    const nameless = best.result.games.filter((g) => !g.name)
    console.log(`\n── Nameless entries in the fullest list (${best.variant.label}) ──`)
    if (nameless.length === 0) {
      console.log('   None. Every app Steam returned came with a name, so a missing title is')
      console.log('   genuinely absent from the response rather than present-but-unrecognisable.')
    } else {
      console.log(`   ${nameless.length} app(s) returned without a name. Resolving via appinfo:\n`)
      for (const g of nameless) {
        const info = await steamcmdName(g.appid)
        const label = info.error
          ? `appinfo error: ${info.error}`
          : `${info.name || '(appinfo has no name either)'}  [type=${info.type || '?'}${info.releaseState ? `, ${info.releaseState}` : ''}]`
        console.log(`   ${String(g.appid).padEnd(9)} ${label}   ${g.playtime}min`)
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
    }
  }

  for (const term of searchTerms) {
    const found = await storeSearch(term)
    console.log(`\n── Store search for "${term}" (mature cookies set) ──`)
    if (found.error) {
      console.log(`   error: ${found.error}`)
    } else if (found.items.length === 0) {
      console.log('   No store results. Consistent with a fully delisted title, which has no')
      console.log('   store page to search. Get its App ID from the Steam client instead:')
      console.log('   right-click the game in your library -> Properties -> Updates.')
    } else {
      for (const item of found.items.slice(0, 8)) {
        const owned = best ? best.result.games.some((g) => String(g.appid) === String(item.id)) : null
        console.log(`   ${String(item.id).padEnd(9)} ${String(item.name).padEnd(46)} ` +
          `${owned === null ? '' : owned ? 'IN owned list' : 'NOT in owned list'}`)
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }

  console.log(
    '\nIf every variant reports the same count, the filters are not what is ' +
    'hiding those games — the remaining candidates are Family Sharing (never ' +
    'licensed to this account, so never returned) and non-game app types ' +
    '(soundtracks, tools, demos), neither of which any parameter can surface.\n',
  )
}

main().catch((err) => {
  console.error('Probe failed:', err.message)
  process.exit(1)
})
