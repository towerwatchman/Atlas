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
}
