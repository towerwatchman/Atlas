'use strict'

const { ipcMain } = require('electron')
const accountStore = require('../accounts/accountStore')

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
}
