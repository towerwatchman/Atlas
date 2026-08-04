// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

import DownloadAccounts from '../src/components/settings/DownloadAccounts.jsx'

// The host account form is a centred modal, matching the site accounts in
// Accounts.jsx. It used to expand inline inside the card, which pushed every
// card below it down the page and read as part of the list rather than as a task.
//
// Mounting also catches what a bundle cannot: the inline block referenced
// `expanded`, and lifting it into a modal renamed that state.

const plugins = [
  {
    id: 'mega',
    label: 'MEGA',
    supportsAnonymous: true,
    hasAccount: false,
    credentialFields: [
      { key: 'email', label: 'Email', type: 'text', help: 'The email on your account.' },
      { key: 'password', label: 'Password', type: 'password', help: 'Never stored.' },
    ],
  },
]

beforeEach(() => {
  window.electronAPI = {
    hostsList: vi.fn().mockResolvedValue({ ok: true, available: true, plugins, accounts: [] }),
    hostsQuota: vi.fn().mockResolvedValue({ ok: false }),
    hostsSaveAccount: vi.fn().mockResolvedValue({ ok: true, validated: { username: 'a@b.c' } }),
    hostsRemoveAccount: vi.fn().mockResolvedValue({ ok: true }),
  }
})
afterEach(() => { cleanup(); delete window.electronAPI })

const openModal = async () => {
  render(<DownloadAccounts />)
  const button = await screen.findByRole('button', { name: 'Add account' })
  fireEvent.click(button)
}

describe('DownloadAccounts host form', () => {
  it('shows no form until the button is pressed', async () => {
    render(<DownloadAccounts />)
    await screen.findByRole('button', { name: 'Add account' })
    expect(screen.queryByLabelText('Email')).toBeNull()
  })

  it('opens a centred modal naming the host', async () => {
    await openModal()
    const heading = await screen.findByRole('heading', { name: /Add MEGA account/ })
    expect(heading).toBeTruthy()
    // Same shell as AddAccountModal: a fixed, centred overlay rather than a panel
    // inside the card.
    const overlay = heading.closest('.fixed')
    expect(overlay).toBeTruthy()
    expect(overlay.className).toContain('items-center')
    expect(overlay.className).toContain('justify-center')
  })

  it('renders a field per credentialField, with its help text', async () => {
    await openModal()
    expect(await screen.findByLabelText(/Email/)).toBeTruthy()
    expect(screen.getByLabelText(/Password/)).toBeTruthy()
    expect(screen.getByText('Never stored.')).toBeTruthy()
  })

  it('masks a password field', async () => {
    await openModal()
    expect((await screen.findByLabelText(/Password/)).getAttribute('type')).toBe('password')
  })

  it('keeps submit disabled until something is entered', async () => {
    await openModal()
    const submit = await screen.findByRole('button', { name: /Verify and save/ })
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'a@b.c' } })
    expect(submit.disabled).toBe(false)
  })

  it('closes on Cancel and discards what was typed', async () => {
    await openModal()
    fireEvent.change(await screen.findByLabelText(/Email/), { target: { value: 'typed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByLabelText(/Email/)).toBeNull())
    // Reopening must not show the abandoned value: these are credentials.
    fireEvent.click(screen.getByRole('button', { name: 'Add account' }))
    expect((await screen.findByLabelText(/Email/)).value).toBe('')
  })

  it('closes on a click outside the panel', async () => {
    await openModal()
    const heading = await screen.findByRole('heading', { name: /Add MEGA account/ })
    fireEvent.click(heading.closest('.fixed'))
    await waitFor(() => expect(screen.queryByLabelText(/Email/)).toBeNull())
  })

  it('does not close on a click inside the panel', async () => {
    await openModal()
    const email = await screen.findByLabelText(/Email/)
    fireEvent.click(email)
    expect(screen.getByLabelText(/Email/)).toBeTruthy()
  })

  it('saves, closes, and reports the signed-in user on the card', async () => {
    await openModal()
    fireEvent.change(await screen.findByLabelText(/Email/), { target: { value: 'a@b.c' } })
    fireEvent.click(screen.getByRole('button', { name: /Verify and save/ }))
    await waitFor(() => expect(screen.queryByLabelText(/Email/)).toBeNull())
    expect(window.electronAPI.hostsSaveAccount).toHaveBeenCalledWith({
      hostId: 'mega',
      secrets: { email: 'a@b.c' },
    })
    expect(await screen.findByText(/Signed in as a@b.c/)).toBeTruthy()
  })

  it('stays open and shows the error when the host rejects it', async () => {
    // The modal owns the error while open, which is why the card no longer
    // renders one: a failed save keeps the modal up.
    window.electronAPI.hostsSaveAccount = vi.fn().mockResolvedValue({
      ok: false, error: 'MEGA rejected that password.',
    })
    await openModal()
    fireEvent.change(await screen.findByLabelText(/Email/), { target: { value: 'a@b.c' } })
    fireEvent.click(screen.getByRole('button', { name: /Verify and save/ }))
    expect(await screen.findByText('MEGA rejected that password.')).toBeTruthy()
    expect(screen.getByLabelText(/Email/)).toBeTruthy()
  })
})
