'use strict'

// Node port of the scraper's XenForo 2.x authenticated session (see the
// Python scraper's auth.py). Both F95zone and LewdCorner run XenForo, so the
// login flow is identical: GET /login/login for the _xfToken CSRF, POST the
// credentials, then confirm the session via the data-logged-in="true" flag on
// the root <html>. Session state is just cookies (xf_user + xf_session are the
// ones that keep you logged in).
//
// No cookie-jar dependency: this manages the two-request login by hand, which
// keeps the surface small and avoids adding tough-cookie/axios-cookiejar.

const axios = require('axios')

const SITES = {
  f95: { base: 'https://f95zone.to', domain: 'f95zone.to', label: 'F95zone' },
  lewdcorner: { base: 'https://lewdcorner.com', domain: 'lewdcorner.com', label: 'LewdCorner' },
}

// A real desktop UA avoids tripping bot heuristics; the cookie is what actually
// authenticates, but a plausible UA keeps the sites from gating us as a bot.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const DEFAULT_HEADERS = {
  'User-Agent': USER_AGENT,
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

// Minimal cookie jar keyed by cookie name -> { value, domain, path }.
class CookieJar {
  constructor() {
    this.cookies = new Map()
  }

  setFromResponse(res) {
    const setCookie = res && res.headers && res.headers['set-cookie']
    if (!Array.isArray(setCookie)) return
    for (const line of setCookie) {
      const firstPart = String(line).split(';')[0]
      const eq = firstPart.indexOf('=')
      if (eq < 0) continue
      const name = firstPart.slice(0, eq).trim()
      const value = firstPart.slice(eq + 1).trim()
      if (!name) continue
      // A cleared cookie (deleted=... / expired) — drop it from the jar.
      if (value === '' || /^deleted$/i.test(value)) {
        this.cookies.delete(name)
        continue
      }
      const domMatch = /domain=([^;]+)/i.exec(line)
      const pathMatch = /path=([^;]+)/i.exec(line)
      this.cookies.set(name, {
        value,
        domain: domMatch ? domMatch[1].trim().replace(/^\./, '') : undefined,
        path: pathMatch ? pathMatch[1].trim() : '/',
      })
    }
  }

  header() {
    return Array.from(this.cookies.entries())
      .map(([name, c]) => `${name}=${c.value}`)
      .join('; ')
  }

  toArray(defaultDomain) {
    return Array.from(this.cookies.entries()).map(([name, c]) => ({
      name,
      value: c.value,
      domain: c.domain || defaultDomain,
      path: c.path || '/',
    }))
  }

  loadArray(arr) {
    for (const c of arr || []) {
      if (c && c.name) {
        this.cookies.set(c.name, {
          value: c.value,
          domain: c.domain,
          path: c.path || '/',
        })
      }
    }
  }

  get size() {
    return this.cookies.size
  }
}

function isLoggedInHtml(html) {
  const text = String(html || '')
  const head = text.slice(0, 4000)
  if (head.includes('data-logged-in="true"')) return true
  if (head.includes('data-logged-in="false"')) return false
  // Fall back to scanning the whole body in case the attribute moved.
  return /data-logged-in="true"/.test(text)
}

// Build a cookie header string from a stored cookie array (used by callers that
// only persisted the array form).
function cookieHeaderFromArray(arr) {
  const jar = new CookieJar()
  jar.loadArray(arr)
  return jar.header()
}

// Verify a stored cookie set is still a live session.
async function checkCookiesLive(site, cookieArray) {
  const cfg = SITES[site]
  if (!cfg) return false
  const jar = new CookieJar()
  jar.loadArray(cookieArray)
  if (jar.size === 0) return false
  try {
    const r = await axios.get(cfg.base + '/account/', {
      headers: { ...DEFAULT_HEADERS, Cookie: jar.header() },
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: () => true,
    })
    return r.status === 200 && isLoggedInHtml(r.data)
  } catch (err) {
    return false
  }
}

// Escape a literal string so it can be used inside a RegExp constructor.
// Used to fold a config-supplied CSS class name into the shop-page regex.
function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Rank data-item-id values that grant member+ / Plus access. UwU (18) is
// cosmetic-only and does not count.
const LC_RANK_IDS = new Set([2, 6, 7, 8, 12, 13])

// Default endpoints + selectors for LewdCorner tier detection. Mirrors the
// configSchema [LewdCorner] section; a config value that is blank/empty falls
// back to these. Kept here so the module runs standalone (and unit-tests pass)
// without config plumbing, and so a markup change can be handled by config.
const LC_TIER_DEFAULTS = {
  lcProbeThreadId: 14057,
  lcUserTierPath: '/shop/index.php#user-ranks',
  lcUserPrestigePath: '/shop/index.php?rank_bundle=prestige',
  lcStatusPillClass: 'statusPill',
  lcStatusPillOwnedToken: 'owned',
  lcStatusPillOwnedText: 'owned',
}

// Fold an optional per-site config object over the LC defaults, dropping any
// blank value so a cleared config key falls back to the built-in default.
function lcConfigWithDefaults(cfg) {
  if (!cfg || typeof cfg !== 'object') return { ...LC_TIER_DEFAULTS }
  const out = { ...LC_TIER_DEFAULTS }
  for (const key of Object.keys(LC_TIER_DEFAULTS)) {
    const v = cfg[key]
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v
    else if (typeof v === 'string' && v.trim() !== '') out[key] = v
  }
  return out
}

// Scrape the LewdCorner profile page to determine which ranks the user owns.
// Returns 'VIP' if any Plus-granting rank is owned, 'Free' if the page loads
// but no Plus rank is found, and null if no page loads at all (so the caller
// can fall back to the thread probe).
// An owned rank shows a green "Owned" pill and an "Owned" button; otherwise
// the pill is absent and the button says "Purchase Rank". Matching on the
// pill is the authoritative signal. The pill class/token/text are config-driven
// so a rename is a settings edit. Never throws.
async function scrapeLcTierFromProfile(cookieArray, lcConfig) {
  const jar = new CookieJar()
  jar.loadArray(cookieArray)
  if (jar.size === 0) return null

  const lc = lcConfigWithDefaults(lcConfig)

  // Build the full shop URLs from the configured paths + LewdCorner base.
  const lcUserTierUrls = [
    SITES.lewdcorner.base + lc.lcUserTierPath,
    SITES.lewdcorner.base + lc.lcUserPrestigePath,
  ]

  let anyPageLoaded = false

  // Build the regex from the configured container class so a container rename
  // is honored without code changes. The owned-token/text are checked against
  // the pill's class fragment and inner text respectively.
  const lcPillClass = escapeRegExp(lc.lcStatusPillClass)
  const lcPillRegex = new RegExp(
    'data-item-id="(\\d+)"[\\s\\S]*?<span[^>]*class="[^"]*' + lcPillClass + '([^"]*)"[^>]*>([^<]*)</span>',
    'gi',
  )
  const lcOwnedToken = lc.lcStatusPillOwnedToken ? lc.lcStatusPillOwnedToken.toLowerCase() : ''
  const lcOwnedText = lc.lcStatusPillOwnedText

  for (const url of lcUserTierUrls) {
    try {
      const r = await axios.get(url, {
        headers: { ...DEFAULT_HEADERS, Cookie: jar.header() },
        timeout: 30000,
        maxRedirects: 5,
        validateStatus: () => true,
      })
      if (r.status !== 200) continue
      anyPageLoaded = true
      const html = String(r.data || '')

      // Each rank card carries data-item-id and an ownership pill. A card is
      // owned when the pill's class contains the owned token (LC styles it
      // green) or its text matches the owned text (kept as a fallback in case
      // the class token ever changes).
      let match
      const lcLowerOwnedText = lcOwnedText.toLowerCase()
      while ((match = lcPillRegex.exec(html)) !== null) {
        const rankId = Number(match[1])
        const cls = match[2]
        const text = match[3].trim().toLowerCase()
        if (!LC_RANK_IDS.has(rankId)) continue
        if (
          (lcOwnedToken && cls.split(/\s+/).some((c) => c.toLowerCase().includes(lcOwnedToken))) ||
          (lcLowerOwnedText && text === lcLowerOwnedText)
        ) {
          return 'VIP'
        }
      }
    } catch (err) {
      // Network or parse failure on one URL — try the next.
      continue
    }
  }

  // Shop page loaded but no Plus rank found → Free. If no page loaded at
  // all, return null (inconclusive) so the caller falls back to thread probing.
  return anyPageLoaded ? 'Free' : null
}

// Probe a known member-gated thread. If the attachment-hide message is present,
// the user cannot see attachments (Standard). If it's absent, they can (Plus).
async function probeLcTierFromThread(cookieArray, lcConfig) {
  const lc = lcConfigWithDefaults(lcConfig)
  if (!lc.lcProbeThreadId) return null
  const configuredUrl = `${SITES.lewdcorner.base}/threads/${lc.lcProbeThreadId}/`
  const jar = new CookieJar()
  jar.loadArray(cookieArray)
  if (jar.size === 0) return null

  try {
    const r = await axios.get(configuredUrl, {
      headers: { ...DEFAULT_HEADERS, Cookie: jar.header() },
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: () => true,
    })
    if (r.status !== 200) return null
    const html = String(r.data || '')

    // XenForo hides attachments behind this block for non-authorized users.
    if (html.includes('messageHide messageHide--attach')) {
      return 'Free'
    }
    // If the thread loaded and there's no hide block, user can see attachments.
    // But only conclude Plus if we also see actual attachment content — the hide
    // block might just have been removed site-wide. Check for the attachment
    // wrapper that appears when images are visible.
    if (html.includes('message-attachment') || html.includes('bbImage')) {
      return 'VIP'
    }
    // Thread loaded but we can't determine attachment visibility — inconclusive.
    return null
  } catch (err) {
    return null
  }
}

// Determine the logged-in user's LewdCorner tier. Tries the shop page first
// (definitive), falls back to a thread probe. Returns
// { tier: 'Free' | 'VIP' | null, lcTierMismatch: boolean } where 'Free'≈Standard
// and 'VIP'≈Plus.
//
// `lcTierMismatch` is the stale-parser signal: it is true only when the
// LewdCorner shop page concluded 'Free' (no Plus rank parsed) yet the thread
// probe — which reflects actual content access — concluded 'VIP'. That
// mismatch is the reliable indicator that the shop's selector/container has
// drifted, because it cannot fire for a genuinely Free user (whose probe is
// also Free) or when the shop page simply failed to load (shop === null, an
// outage rather than a parser bug). Consumers gate a developer warning on this
// flag.
async function scrapeLcUserTier(cookieArray, lcConfig) {
  const lcTierResult = await scrapeLcTierFromProfile(cookieArray, lcConfig)
  if (lcTierResult === 'VIP') return { tier: 'VIP', lcTierMismatch: false }
  if (lcTierResult === 'Free') {
    // Shop says Standard — confirm with thread probe to guard against a false
    // Standard from a broken shop page parse.
    const probeResult = await probeLcTierFromThread(cookieArray, lcConfig)
    if (probeResult === 'VIP') return { tier: 'VIP', lcTierMismatch: true }
    return { tier: 'Free', lcTierMismatch: false }
  }
  // Shop failed entirely — rely on thread probe. A shop that will not load is
  // an outage, not a stale parser, so this is NOT a mismatch.
  const probeResult = await probeLcTierFromThread(cookieArray, lcConfig)
  return { tier: probeResult, lcTierMismatch: false }
}

// Full login. Returns a cookie array ({name,value,domain,path}) on success,
// throws AuthError-style Error on failure (bad creds / captcha / 2FA).
async function login(site, username, password) {
  const cfg = SITES[site]
  if (!cfg) throw new Error(`Unsupported site: ${site}`)
  if (!username || !password) throw new Error('Username and password are required.')

  const jar = new CookieJar()

  // 1. GET the login form for the CSRF token (and initial xf_csrf cookie).
  let g
  try {
    g = await axios.get(cfg.base + '/login/login', {
      headers: DEFAULT_HEADERS,
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: () => true,
    })
  } catch (err) {
    throw new Error(`Could not reach ${cfg.label} (${err.message}).`)
  }
  if (g.status !== 200) {
    throw new Error(`Could not load ${cfg.label} login page (HTTP ${g.status}).`)
  }
  jar.setFromResponse(g)
  const tokenMatch =
    /name="_xfToken"\s+value="([^"]*)"/.exec(String(g.data)) ||
    /"_xfToken"\s*:\s*"([^"]*)"/.exec(String(g.data))
  const token = tokenMatch ? tokenMatch[1] : ''

  // 2. POST credentials. XenForo replies with a 303 redirect + Set-Cookie for
  //    xf_user/xf_session on success, so don't auto-follow — capture cookies
  //    off the redirect response, then confirm liveness with a fresh request.
  const form = new URLSearchParams({
    login: username,
    password,
    remember: '1',
    _xfRedirect: cfg.base + '/',
    _xfToken: token,
  })
  let p
  try {
    p = await axios.post(cfg.base + '/login/login', form.toString(), {
      headers: {
        ...DEFAULT_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: cfg.base + '/login/login',
        Origin: cfg.base,
        Cookie: jar.header(),
      },
      timeout: 30000,
      maxRedirects: 0,
      validateStatus: () => true,
    })
  } catch (err) {
    throw new Error(`Login request to ${cfg.label} failed (${err.message}).`)
  }
  jar.setFromResponse(p)

  const cookieArray = jar.toArray(cfg.domain)
  const live = isLoggedInHtml(p.data) || (await checkCookiesLive(site, cookieArray))
  if (!live) {
    throw new Error(
      `Login failed for ${cfg.label}. Check the username and password — the ` +
        'account may also be blocked by a captcha or two-factor prompt, which ' +
        'this client cannot solve automatically.',
    )
  }
  return cookieArray
}

module.exports = {
  SITES,
  login,
  checkCookiesLive,
  cookieHeaderFromArray,
  isLoggedInHtml,
  scrapeLcUserTier,
  scrapeLcTierFromProfile,
  probeLcTierFromThread,
  LC_RANK_IDS,
}
