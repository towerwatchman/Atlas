'use strict'

// Embedded login window. Opens the site's real login page in a dedicated,
// ephemeral session partition so the user can complete whatever the site
// throws at them — password, captcha, two-factor — like a normal browser
// login. Once the session goes live (data-logged-in="true"), Atlas harvests
// the cookies and hands them back; the caller stores them encrypted and feeds
// them into the same cookie pipeline the headless path uses.

const { BrowserWindow } = require('electron')
const { SITES } = require('./xenforoAuth')

function loginWithBrowser(site) {
  return new Promise((resolve) => {
    const cfg = SITES[site]
    if (!cfg) {
      resolve({ ok: false, error: `Unsupported site: ${site}` })
      return
    }

    // Ephemeral partition: the login cookies live only in this window's
    // session; we read them out, then the partition is discarded.
    const partition = `acct-login-${site}-${Date.now()}`
    const win = new BrowserWindow({
      width: 480,
      height: 760,
      title: `Log in to ${cfg.label}`,
      autoHideMenuBar: true,
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    const ses = win.webContents.session
    let settled = false

    const finish = (result) => {
      if (settled) return
      settled = true
      try {
        if (!win.isDestroyed()) win.destroy()
      } catch (err) {
        /* already gone */
      }
      resolve(result)
    }

    // Read the logged-in flag; when live, harvest cookies + best-effort
    // username, then resolve.
    const tryHarvest = async () => {
      if (settled || win.isDestroyed()) return
      let flag = null
      try {
        flag = await win.webContents.executeJavaScript(
          'document.documentElement && document.documentElement.getAttribute("data-logged-in")',
          true,
        )
      } catch (err) {
        return
      }
      if (flag !== 'true') return

      let username = null
      try {
        username = await win.webContents.executeJavaScript(
          `(function () {
             var el = document.querySelector('.p-navgroup-link--user .p-navgroup-linkText')
                   || document.querySelector('a[href*="/account"] .p-navgroup-linkText');
             return el ? el.textContent.trim() : null;
           })()`,
          true,
        )
      } catch (err) {
        /* leave username null */
      }

      let cookies = []
      try {
        const raw = await ses.cookies.get({ domain: cfg.domain })
        cookies = raw.map((c) => ({
          name: c.name,
          value: c.value,
          domain: (c.domain || cfg.domain).replace(/^\./, ''),
          path: c.path || '/',
        }))
      } catch (err) {
        finish({ ok: false, error: `Could not read session cookies (${err.message}).` })
        return
      }

      const hasSession = cookies.some(
        (c) => (c.name === 'xf_session' || c.name === 'xf_user') && c.value,
      )
      if (!hasSession) return // logged-in flag set but cookies not yet written; wait for next event

      finish({ ok: true, cookies, username })
    }

    // Tick "remember me" so the long-lived xf_user cookie is issued, then check.
    win.webContents.on('did-finish-load', async () => {
      try {
        await win.webContents.executeJavaScript(
          `(function () {
             var r = document.querySelector('input[name="remember"]');
             if (r) r.checked = true;
             return true;
           })()`,
          true,
        )
      } catch (err) {
        /* non-fatal */
      }
      tryHarvest()
    })
    win.webContents.on('did-navigate', tryHarvest)
    win.webContents.on('did-frame-navigate', tryHarvest)

    win.on('closed', () => {
      if (!settled) {
        settled = true
        resolve({ ok: false, error: 'Login window was closed before sign-in completed.' })
      }
    })

    win.loadURL(cfg.base + '/login/login')
  })
}

module.exports = { loginWithBrowser }
