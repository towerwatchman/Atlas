// @vitest-environment jsdom
import { test, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'

import Accounts from '../src/components/settings/Accounts.jsx'

// The resolver serves both game sites, so the toggle lives in the Game sites
// section, below the site cards.

let saved
let storedConfig

const renderSettled = async (ui) => {
  let result
  await act(async () => { result = render(ui) })
  return result
}

beforeEach(() => {
  cleanup()
  saved = null
  storedConfig = { Resolve: { showWindow: true } }
  vi.stubGlobal('window', Object.assign(globalThis.window, {
    electronAPI: {
      listAccounts: async () => [],
      getLcUserTier: async () => null,
      steamStatus: async () => ({ connected: false }),
      getConfig: async () => storedConfig,
      saveSettings: async (config) => { saved = config },
    },
  }))
})

test('the resolve-window checkbox sits in Game sites, below the site cards', async () => {
  await renderSettled(<Accounts />)
  const checkbox = screen.getByLabelText(/do not hide resolve window/i)
  expect(checkbox).toBeDefined()
  const lcCard = screen.getByText('LewdCorner')
  const steamHeading = screen.getByText('Steam library')
  expect(lcCard.compareDocumentPosition(checkbox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(checkbox.compareDocumentPosition(steamHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

test('the checkbox reflects the stored value on load', async () => {
  await renderSettled(<Accounts />)
  expect(screen.getByLabelText(/do not hide resolve window/i).checked).toBe(true)
})

test('toggling the checkbox saves Resolve.showWindow', async () => {
  await renderSettled(<Accounts />)
  await act(async () => {
    fireEvent.click(screen.getByLabelText(/do not hide resolve window/i))
  })
  expect(saved).not.toBeNull()
  expect(saved.Resolve.showWindow).toBe(false)
})

test('the auto-resolve checkbox sits under the resolve-window one', async () => {
  await renderSettled(<Accounts />)
  const hideFrame = screen.getByLabelText(/do not hide resolve window/i)
  const autoResolve = screen.getByLabelText(/do not auto-resolve masked link/i)
  expect(hideFrame.compareDocumentPosition(autoResolve) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

test('the auto-resolve box is clear on a fresh install, so it keeps auto-resolving', async () => {
  await renderSettled(<Accounts />)
  expect(screen.getByLabelText(/do not auto-resolve masked link/i).checked).toBe(false)
})

test('the auto-resolve box is ticked when manual resolve is stored on', async () => {
  storedConfig = { Resolve: { manualResolve: true } }
  await renderSettled(<Accounts />)
  expect(screen.getByLabelText(/do not auto-resolve masked link/i).checked).toBe(true)
})

test('ticking it saves Resolve.manualResolve: true without losing showWindow', async () => {
  await renderSettled(<Accounts />)
  await act(async () => {
    fireEvent.click(screen.getByLabelText(/do not auto-resolve masked link/i))
  })
  expect(saved?.Resolve.manualResolve).toBe(true)
  expect(saved?.Resolve.showWindow).toBe(true)
})
