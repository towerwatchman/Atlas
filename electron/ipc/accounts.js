'use strict'

const { ipcMain } = require('electron')
const accountStore = require('../accounts/accountStore')
const steamStore = require('../accounts/steamStore')
const { getInstalledSteamGames } = require('../scanners/steamscanner')

module.exports = function registerAccountsHandlers(ctx) {
  ipcMain.handle('accounts-list', async () => {
    try {
      return accountStore.listAccounts()
    } catch (err) {
      console.error('accounts-list error:', err)
      return []
    }
  })

  // Test credentials without saving; on success the verified session is held
  // server-side. Returns { ok, error? }.
  ipcMain.handle('accounts-verify', async (event, { site, username, password } = {}) => {
    return accountStore.verifyAccount(site, username, password)
  })

  // Open the embedded browser login (captcha / 2FA). Returns { ok, username?, error? }.
  ipcMain.handle('accounts-verify-browser', async (event, { site } = {}) => {
    return accountStore.verifyAccountBrowser(site)
  })

  // Persist the already-verified session without re-authenticating.
  ipcMain.handle('accounts-save', async (event, { site } = {}) => {
    return accountStore.commitAccount(site)
  })

  ipcMain.handle('accounts-remove', async (event, { site } = {}) => {
    return accountStore.removeAccount(site)
  })

  // ── Steam (owned-library) ──────────────────────────────────────────────────
  // Kept under the accounts IPC surface but backed by the separate steamStore.

  ipcMain.handle('steam-status', async () => {
    try {
      return steamStore.status()
    } catch (err) {
      console.error('steam-status error:', err)
      return { connected: false, steamId: null, hasApiKey: false }
    }
  })

  // Run the OpenID sign-in window; on success the SteamID is remembered.
  ipcMain.handle('steam-signin', async () => {
    try {
      return await steamStore.signIn()
    } catch (err) {
      console.error('steam-signin error:', err)
      return { ok: false, error: err.message || 'Steam sign-in failed.' }
    }
  })

  // Validate + persist the user's Web API key (requires a prior sign-in).
  ipcMain.handle('steam-set-key', async (event, { apiKey } = {}) => {
    try {
      return await steamStore.setApiKey(apiKey)
    } catch (err) {
      console.error('steam-set-key error:', err)
      return { ok: false, error: err.message || 'Could not save API key.' }
    }
  })

  ipcMain.handle('steam-disconnect', async () => {
    try {
      return steamStore.disconnect()
    } catch (err) {
      console.error('steam-disconnect error:', err)
      return { ok: false, error: err.message }
    }
  })

  // Owned library, reconciled against locally-installed Steam games. The disk
  // scan can fail (Steam not installed / no libraries) — that's non-fatal here,
  // we just report zero installed and still return the owned list.
  ipcMain.handle('steam-owned-games', async (event, { forceRefresh = false } = {}) => {
    let installedGames = []
    try {
      installedGames = await getInstalledSteamGames()
    } catch (err) {
      console.warn('steam-owned-games: installed scan failed (non-fatal):', err.message)
    }
    try {
      return await steamStore.getOwnedGames({ installedGames, forceRefresh })
    } catch (err) {
      console.error('steam-owned-games error:', err)
      return { ok: false, error: err.message || 'Could not load Steam library.' }
    }
  })
}
