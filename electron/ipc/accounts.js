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

  // Test credentials without saving. Returns { ok, error? }.
  ipcMain.handle('accounts-verify', async (event, { site, username, password } = {}) => {
    return accountStore.verifyAccount(site, username, password)
  })

  // Log in and persist (encrypted). Returns { ok, error? }.
  ipcMain.handle('accounts-save', async (event, { site, username, password } = {}) => {
    return accountStore.saveAccount(site, username, password)
  })

  ipcMain.handle('accounts-remove', async (event, { site } = {}) => {
    return accountStore.removeAccount(site)
  })
}
