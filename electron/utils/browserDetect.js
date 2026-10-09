'use strict'

// Browser detection for Settings → Interface → Browser.
//
// Windows subkey names are opaque handles, sometimes hash-suffixed after an
// update (seen: Brave.<hash>, Vivaldi.<hash>). Mapping uses the exe basename
// plus the Capabilities ApplicationName, deduped by stable id, and every
// entry is existence-gated: uninstall hides it, reinstall brings it back.

const fs = require('fs')
const path = require('path')
const cp = require('child_process')

const KNOWN_BROWSERS = [
  { id: 'safari', name: 'Safari', macAppNames: ['Safari.app'], macBundleIds: ['com.apple.Safari'] },
  {
    id: 'chrome', name: 'Google Chrome',
    macAppNames: ['Google Chrome.app'], macBundleIds: ['com.google.Chrome'],
    winExeNames: ['chrome.exe'], winStartMenuNames: ['Google Chrome'],
    linuxBins: ['google-chrome', 'google-chrome-stable'],
  },
  {
    id: 'brave', name: 'Brave',
    macAppNames: ['Brave Browser.app'], macBundleIds: ['com.brave.Browser'],
    winExeNames: ['brave.exe'], winStartMenuNames: ['Brave'],
    linuxBins: ['brave-browser', 'brave'],
  },
  {
    id: 'edge', name: 'Microsoft Edge',
    macAppNames: ['Microsoft Edge.app'], macBundleIds: ['com.microsoft.edgemac'],
    winExeNames: ['msedge.exe'], winStartMenuNames: ['Microsoft Edge'],
    linuxBins: ['microsoft-edge'],
  },
  {
    id: 'firefox', name: 'Firefox',
    macAppNames: ['Firefox.app'], macBundleIds: ['org.mozilla.firefox'],
    winExeNames: ['firefox.exe'], winStartMenuNames: ['Firefox'],
    linuxBins: ['firefox'],
  },
  {
    id: 'vivaldi', name: 'Vivaldi',
    macAppNames: ['Vivaldi.app'], macBundleIds: ['com.vivaldi.Vivaldi'],
    winExeNames: ['vivaldi.exe'], winStartMenuNames: ['Vivaldi'],
    linuxBins: ['vivaldi', 'vivaldi-stable'],
  },
  {
    id: 'zen', name: 'Zen Browser',
    macAppNames: ['Zen.app', 'Zen Browser.app'], macBundleIds: ['app.zen-browser.zen'],
    winExeNames: ['zen.exe'], winStartMenuNames: ['Zen'],
    linuxBins: ['zen', 'zen-browser'],
  },
  {
    id: 'duckduckgo', name: 'DuckDuckGo',
    macAppNames: ['DuckDuckGo.app'], macBundleIds: ['com.duckduckgo.macos.browser'],
    winExeNames: ['duckduckgo.exe'], winStartMenuNames: ['DuckDuckGo'],
  },
  {
    id: 'helium', name: 'Helium',
    macAppNames: ['Helium.app'], macBundleIds: ['net.imput.helium'],
    winExeNames: ['helium.exe'], winStartMenuNames: ['Helium'],
  },
  {
    id: 'opera', name: 'Opera',
    macAppNames: ['Opera.app'], macBundleIds: ['com.operasoftware.Opera'],
    winExeNames: ['opera.exe'], winStartMenuNames: ['Opera'],
    linuxBins: ['opera', 'opera-stable'],
  },
  {
    id: 'arc', name: 'Arc',
    macAppNames: ['Arc.app'], macBundleIds: ['company.thebrowser.Arc'],
    winExeNames: ['arc.exe'], winStartMenuNames: ['Arc'],
  },
  {
    id: 'finicky', name: 'Finicky',
    macAppNames: ['Finicky.app'], macBundleIds: ['se.johnste.finicky'],
  },
]

// Per-machine installs live under HKLM, per-user ones under HKCU, so check both.
// Both bitness views too: 32-bit entries hide from the default view on 64-bit hosts.
const WINDOWS_START_MENU_INTERNET_KEYS = [
  'HKLM\\SOFTWARE\\Clients\\StartMenuInternet',
  'HKCU\\SOFTWARE\\Clients\\StartMenuInternet',
]

function defaultRunRegQuery(key, extraArgs = []) {
  const result = cp.spawnSync(
    'reg.exe',
    ['query', key, '/s', ...extraArgs],
    { encoding: 'utf8', windowsHide: true, timeout: 5000 },
  )
  if (result.error || result.status !== 0) return ''
  return result.stdout || ''
}

function defaultRunCommand(appPath) {
  try {
    const result = cp.spawnSync(
      'mdls',
      ['-raw', '-name', 'kMDItemCFBundleIdentifier', String(appPath)],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 },
    )
    if (result.error || result.status !== 0) return ''
    return result.stdout || ''
  } catch {
    return ''
  }
}

function defaultIsExecutableFile(candidate) {
  try {
    if (!candidate) return false
    const stats = fs.statSync(candidate)
    if (!stats.isFile()) return false
    if (process.platform !== 'win32') fs.accessSync(candidate, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Pull the exe out of a `shell\open\command` default value. Values look like:
 *
 *     (Default)    REG_SZ    "C:\...\brave.exe"
 *     (Default)    REG_SZ    C:\Program Files\Internet Explorer\iexplore.exe
 *
 * Quoted form first (it may carry args after the closing quote), then a bare
 * path; a trailing `,0` suffix is stripped either way.
 */
function extractExePath(commandValue) {
  if (!commandValue) return ''
  const text = String(commandValue).trim()
  const quoted = /"([^"]+\.exe)"/i.exec(text)
  if (quoted) return quoted[1].trim()
  const bare = /^(.+?\.exe)/i.exec(text)
  if (!bare) return ''
  return bare[1].replace(/,\d+\s*$/, '').trim()
}

/**
 * Parse `reg.exe query ... /s` output over StartMenuInternet into
 * [{ exe, appName }]. Subkey names are opaque handles (hash-suffixed after
 * updates), so each entry is keyed by its exe path: the `shell\open\command`
 * default value gives the exe, the sibling `Capabilities` ApplicationName the
 * display-name hint.
 *
 * Keyed by full subkey path (hive + subkey name). HKLM and HKCU, and the
 * default vs /reg:32 views, concatenate into one dump, and one subkey name
 * can point at different exes per hive. Keying by name alone would let a
 * stale HKLM entry mask a valid HKCU install; real duplicates merge later
 * in the stable-id dedupe.
 */
function parseStartMenuInternetOutput(output) {
  const byInstall = new Map()
  const lines = String(output || '').split(/\r?\n/)
  let currentKey = ''
  const entryFor = (installKey) => {
    let entry = byInstall.get(installKey)
    if (!entry) {
      entry = { command: '', appName: '' }
      byInstall.set(installKey, entry)
    }
    return entry
  }
  for (const line of lines) {
    if (/^HKEY_/i.test(line)) {
      currentKey = line.trim()
      continue
    }
    if (!currentKey) continue
    const match = /^\s*(\(Default\)|[A-Za-z0-9]+)\s+REG_[A-Z_]+\s+(.+?)\s*$/.exec(line)
    if (!match) continue
    const subkeyMatch = /^(HKEY_[^\\]+)\\SOFTWARE\\Clients\\StartMenuInternet\\([^\\]+)(\\(.*))?$/i.exec(currentKey)
    if (!subkeyMatch) continue
    const entry = entryFor(`${subkeyMatch[1].toUpperCase()}\\${subkeyMatch[2].toLowerCase()}`)
    const rest = (subkeyMatch[4] || '').toLowerCase()
    if (match[1] === '(Default)' && rest === 'shell\\open\\command') {
      if (!entry.command) entry.command = match[2]
    } else if (match[1] === 'ApplicationName' && rest === 'capabilities') {
      if (!entry.appName) entry.appName = match[2]
    }
  }
  const entries = []
  for (const { command, appName } of byInstall.values()) {
    const exe = extractExePath(command)
    if (exe) entries.push({ exe, appName })
  }
  return entries
}

// Match on whole words only: a Capabilities ApplicationName like
// 'Research Center' contains 'arc' but is not Arc. Exact match first, then
// whole-word match either way.
function startMenuNameMatches(appName, candidate) {
  const hint = String(appName || '').toLowerCase().trim()
  const name = String(candidate || '').toLowerCase().trim()
  if (!hint || !name) return false
  if (hint === name) return true
  const hintTokens = hint.split(/[^a-z0-9]+/).filter(Boolean)
  if (hintTokens.includes(name)) return true
  return name.split(/[^a-z0-9]+/).filter(Boolean).includes(hint)
}

/**
 * Map an exe + display-name hint to a stable browser id. Exe basename first
 * (it survives key renames); the Capabilities ApplicationName only as a
 * fallback for an exe that was itself renamed. Unknown exes get a derived id
 * from their own basename so they still list.
 */
function mapToBrowserId(exe, appName) {
  const base = path.win32.basename(exe).toLowerCase()
  for (const browser of KNOWN_BROWSERS) {
    if ((browser.winExeNames || []).some((name) => name.toLowerCase() === base)) {
      return { id: browser.id, name: browser.name }
    }
  }
  const hint = String(appName || '').toLowerCase()
  if (hint) {
    for (const browser of KNOWN_BROWSERS) {
      if ((browser.winStartMenuNames || []).some((name) => startMenuNameMatches(appName, name))) {
        return { id: browser.id, name: browser.name }
      }
    }
  }
  return { id: base.replace(/\.exe$/, ''), name: appName || base.replace(/\.exe$/, '') }
}

// IEXPLORE.EXE still registers on some boxes but cannot open modern links,
// so it is denied by exe basename in collectWindowsEntries: the one
// enumeration behind both list and resolve, so there is no second site to
// keep in sync.
const WINDOWS_DENYLIST_EXE = new Set(['iexplore.exe'])

// One shared scan behind both list and single-id resolve: all hives and
// bitness views concatenated, then parsed. Each caller checks only the
// entries it needs.
function collectWindowsEntries(runRegQuery) {
  let output = ''
  for (const key of WINDOWS_START_MENU_INTERNET_KEYS) {
    for (const extraArgs of [[], ['/reg:32']]) {
      try {
        output += `\r\n${runRegQuery(key, extraArgs) || ''}`
      } catch {
        continue
      }
    }
  }
  const parsed = parseStartMenuInternetOutput(output)
  return parsed.filter(({ exe }) => !WINDOWS_DENYLIST_EXE.has(path.win32.basename(exe).toLowerCase()))
}

function listWindowsBrowsers({ runRegQuery = defaultRunRegQuery, isExecutableFile = defaultIsExecutableFile } = {}) {
  const parsed = collectWindowsEntries(runRegQuery)
  const seen = new Set()
  const browsers = []
  for (const { exe, appName } of parsed) {
    let exists = false
    try {
      exists = isExecutableFile(exe)
    } catch {
      continue
    }
    if (!exists) continue
    const { id, name } = mapToBrowserId(exe, appName)
    if (seen.has(id)) continue
    seen.add(id)
    browsers.push({ id, name })
  }
  return browsers
}

function listMacBrowsers({ env = process.env, fs: fsImpl = fs, runCommand = defaultRunCommand } = {}) {
  const home = (env && env.HOME) || ''
  const browsers = []
  for (const browser of KNOWN_BROWSERS) {
    if (!browser.macAppNames) continue
    let found = ''
    for (const appName of browser.macAppNames) {
      const candidates = [`/Applications/${appName}`]
      if (home) candidates.push(`${home}/Applications/${appName}`)
      for (const candidate of candidates) {
        let exists = false
        try {
          exists = fsImpl.existsSync(candidate)
        } catch {
          continue
        }
        if (exists) {
          found = candidate
          break
        }
      }
      if (found) break
    }
    if (!found) continue
    // Bundle-identifier confirmation is advisory: launch is path-exact, so a
    // renamed app still works and a failed mdls must never hide an entry.
    try {
      runCommand(found)
    } catch {
      // Advisory only; existence above is what lists the browser.
    }
    browsers.push({ id: browser.id, name: browser.name })
  }
  return browsers
}

// Linux has no registry: a browser counts when one of its binaries is an
// executable file somewhere on PATH. Flatpak installs have no PATH binary
// and are out of scope; those links open through the OS default handler
// as before.
function listLinuxBrowsers({ env = process.env, isExecutableFile = defaultIsExecutableFile } = {}) {
  const browsers = []
  const seen = new Set()
  const pathValue = (env && env.PATH) || ''
  for (const dir of String(pathValue).split(':')) {
    if (!dir || !path.isAbsolute(dir)) continue
    for (const browser of KNOWN_BROWSERS) {
      if (seen.has(browser.id) || !browser.linuxBins) continue
      for (const bin of browser.linuxBins) {
        let ok = false
        try {
          ok = isExecutableFile(`${dir}/${bin}`)
        } catch {
          continue
        }
        if (!ok) continue
        seen.add(browser.id)
        browsers.push({ id: browser.id, name: browser.name })
        break
      }
    }
  }
  return browsers
}

function detectBrowserEntries(options = {}) {
  const platform = options.platform || process.platform
  const result =
    platform === 'win32' ? listWindowsBrowsers(options)
    : platform === 'darwin' ? listMacBrowsers(options)
    : platform === 'linux' ? listLinuxBrowsers(options)
    : []
  // The dropdown lists alphabetically by display name, so sort here instead
  // of trusting registry order or table order.
  const byName = (a, b) => String(a.name).localeCompare(String(b.name))
  return [...result].sort(byName)
}

/**
 * Installed browsers as stable { id, name } pairs. Never throws: a
 * locked-down reg.exe falls through to [], and the caller shows a
 * default-only list.
 */
function listInstalledBrowsers(options = {}) {
  try {
    return detectBrowserEntries(options)
  } catch {
    return []
  }
}

/**
 * Launch path for a stored browser id. Re-probed at call time, never read
 * from a stored path, so an uninstall falls back instead of opening a dead
 * file. Only the chosen browser is checked per click. Returns null for
 * `default`/unknown/unresolvable ids; the caller then uses the OS default.
 */
function resolveBrowserLaunch(browserId, url, options = {}) {
  void url
  if (!browserId || browserId === 'default') return null
  const id = String(browserId).toLowerCase()
  try {
    const platform = options.platform || process.platform
    if (id === 'custom' || id.startsWith('custom:')) return resolveCustomBrowserPath(platform, options, id)
    if (platform === 'darwin') return resolveMacBrowserPath(id, options)
    if (platform === 'win32') return resolveWindowsBrowserPath(id, options)
    if (platform === 'linux') return resolveLinuxBrowserPath(id, options)
    return null
  } catch {
    return null
  }
}

// Each `custom:<i>` id points into the saved path list. The path is
// re-checked on every click, never served from memory: a portable exe moves,
// and a deleted file must fall back to the OS default instead of opening a
// dead path. Missing, out-of-range, or wrong-kind paths read as null.
function resolveCustomBrowserPath(platform, { customBrowserPaths, isExecutableFile = defaultIsExecutableFile, fs: fsImpl = fs } = {}, customId = '') {
  const match = /^custom:(\d+)$/.exec(String(customId))
  const list = Array.isArray(customBrowserPaths) ? customBrowserPaths : []
  const stored = match ? String(list[Number(match[1])] || '').trim() : ''
  if (!stored) return null
  if (platform === 'darwin') {
    if (!/\.app\/?$/i.test(stored)) return null
    const candidate = stored.replace(/\/+$/, '')
    let exists = false
    try {
      exists = fsImpl.existsSync(candidate)
    } catch {
      return null
    }
    if (!exists) return null
    // A plain file renamed to .app cannot open via `open -a`; the save check
    // requires a folder, this guards a path replaced since.
    try {
      if (typeof fsImpl.statSync === 'function') {
        const stats = fsImpl.statSync(candidate)
        if (stats && typeof stats.isDirectory === 'function' && !stats.isDirectory()) return null
      }
    } catch {
      // Existence above is what counts; a stat failure must not hide a live bundle.
    }
    return { appPath: candidate }
  }
  // Linux binaries carry no extension; Windows ones must end .exe. Either
  // way the executable check below is the whole gate.
  if (platform === 'win32' || platform === 'linux') {
    if (platform === 'win32' && !/\.exe$/i.test(stored)) return null
    let ok = false
    try {
      ok = isExecutableFile(stored)
    } catch {
      return null
    }
    return ok ? { appPath: stored } : null
  }
  return null
}

// Same source as the lister, narrowed to one id: the first PATH binary in
// directory order wins.
function resolveLinuxBrowserPath(id, { env = process.env, isExecutableFile = defaultIsExecutableFile } = {}) {
  const browser = KNOWN_BROWSERS.find((entry) => entry.id === id)
  if (!browser) return null
  const pathValue = (env && env.PATH) || ''
  for (const dir of String(pathValue).split(':')) {
    if (!dir || !path.isAbsolute(dir)) continue
    for (const bin of browser.linuxBins || []) {
      let ok = false
      try {
        ok = isExecutableFile(`${dir}/${bin}`)
      } catch {
        continue
      }
      if (ok) return { appPath: `${dir}/${bin}` }
    }
  }
  return null
}

// Check only the requested macOS entry, in lister order (/Applications then
// ~/Applications).
function resolveMacBrowserPath(id, { env = process.env, fs: fsImpl = fs } = {}) {
  const browser = KNOWN_BROWSERS.find((entry) => entry.id === id)
  if (!browser || !browser.macAppNames) return null
  const home = (env && env.HOME) || ''
  for (const appName of browser.macAppNames) {
    const candidates = [`/Applications/${appName}`]
    if (home) candidates.push(`${home}/Applications/${appName}`)
    for (const candidate of candidates) {
      let exists = false
      try {
        exists = fsImpl.existsSync(candidate)
      } catch {
        continue
      }
      if (exists) return { appPath: candidate }
    }
  }
  return null
}

// The registry still enumerates (opaque subkey names cannot be queried
// directly), but only entries for the requested id are existence-checked.
function resolveWindowsBrowserPath(id, { runRegQuery = defaultRunRegQuery, isExecutableFile = defaultIsExecutableFile } = {}) {
  const parsed = collectWindowsEntries(runRegQuery)
  for (const { exe, appName } of parsed) {
    if (mapToBrowserId(exe, appName).id !== id) continue
    let exists = false
    try {
      exists = isExecutableFile(exe)
    } catch {
      continue
    }
    if (exists) return { appPath: exe }
  }
  return null
}

module.exports = {
  KNOWN_BROWSERS,
  listInstalledBrowsers,
  resolveBrowserLaunch,
}
