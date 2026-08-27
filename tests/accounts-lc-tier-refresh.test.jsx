// @vitest-environment jsdom
import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import Accounts from '../src/components/settings/Accounts.jsx'

// ── Immediate tier display on LC connect ────────────────────────────────────
//
// When a user connects a LewdCorner account, the tier should be scraped
// immediately (forceRefresh: true) so the badge shows without requiring a
// navigate-away-and-back. This tests that the handleAdd flow calls getLcUserTier
// with forceRefresh after a successful save, and that the resulting tier badge
// actually renders.

const mockAPI = (overrides = {}) => {
  // Track accounts so that after a successful save the account list reflects
  // the newly added one — otherwise the badge (which only renders for a
  // connected lewdcorner account) could never appear.
  let accounts = overrides.accounts || []
  const api = {
    listAccounts: async () => accounts,
    getLcUserTier: async () => ({ tier: overrides.tier || null }),
    saveAccount: async ({ site }) => {
      if (site === 'lewdcorner') {
        accounts = [...accounts, { site, connected: true, username: 'testuser' }]
      }
      return { ok: true }
    },
    removeAccount: async () => ({ ok: true }),
    verifyAccount: async () => ({ ok: true }),
    verifyAccountBrowser: async () => ({ ok: true }),
    steamStatus: async () => ({ connected: false }),
    hostsList: async () => [],
    ...overrides,
  }
  vi.stubGlobal('window', Object.assign(globalThis.window, { electronAPI: api }))
  return api
}

beforeEach(() => {
  vi.restoreAllMocks()
})

// Find the Connect button inside the LewdCorner row (second site card).
function lcConnectButton() {
  // Each site renders its label ("F95Zone" / "LewdCorner") and a Connect
  // button. Grab all Connect buttons; LC is the second site.
  const buttons = screen.getAllByText('Connect')
  return buttons[buttons.length - 1]
}

test('LC connect calls getLcUserTier with forceRefresh: true after save', async () => {
  const api = mockAPI({ tier: 'VIP' })
  const getLcUserTierSpy = vi.spyOn(api, 'getLcUserTier')

  await act(async () => { render(<Accounts />) })

  await act(async () => { fireEvent.click(lcConnectButton()) })

  const usernameInput = screen.getByLabelText('Username')
  const passwordInput = screen.getByLabelText('Password')
  await act(async () => {
    fireEvent.change(usernameInput, { target: { value: 'testuser' } })
    fireEvent.change(passwordInput, { target: { value: 'testpass' } })
  })
  await act(async () => { fireEvent.click(screen.getByText('Verify')) })

  await waitFor(() => { expect(screen.getByText('Login verified.')).toBeTruthy() })

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add account' })) })

  await waitFor(() => {
    expect(getLcUserTierSpy).toHaveBeenCalledWith(
      expect.objectContaining({ forceRefresh: true }),
    )
  })

  // The freshly scraped tier should produce a visible "Plus" badge.
  await screen.findByText('Plus')
})

test('non-LC connect does NOT call getLcUserTier with forceRefresh', async () => {
  const api = mockAPI({ tier: null })
  const getLcUserTierSpy = vi.spyOn(api, 'getLcUserTier')

  await act(async () => { render(<Accounts />) })

  // First Connect button is F95 (first site in the list).
  const buttons = screen.getAllByText('Connect')
  await act(async () => { fireEvent.click(buttons[0]) })

  const siteSelect = screen.getByLabelText('Site')
  await act(async () => { fireEvent.change(siteSelect, { target: { value: 'f95' } }) })

  const usernameInput = screen.getByLabelText('Username')
  const passwordInput = screen.getByLabelText('Password')
  await act(async () => {
    fireEvent.change(usernameInput, { target: { value: 'testuser' } })
    fireEvent.change(passwordInput, { target: { value: 'testpass' } })
  })
  await act(async () => { fireEvent.click(screen.getByText('Verify')) })

  await waitFor(() => { expect(screen.getByText('Login verified.')).toBeTruthy() })

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add account' })) })

  await waitFor(() => {
    const forceCall = getLcUserTierSpy.mock.calls.find(
      (c) => c[0]?.forceRefresh === true,
    )
    expect(forceCall).toBeUndefined()
  })
})
