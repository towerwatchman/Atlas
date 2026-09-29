// @vitest-environment jsdom
import { test, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'

import BlacklistSettings from '../src/components/settings/BlacklistSettings.jsx'
import { settingsIcons } from '../src/components/settings/settingsIcons.js'

// Settings > Blacklist is the only way back for a blacklisted title: Browse no
// longer shows it, so there is nothing there to un-blacklist it from.

let stored
let removed
let blacklistListener

const renderSettled = async (ui) => {
  let result
  await act(async () => { result = render(ui) })
  return result
}

beforeEach(() => {
  cleanup()
  removed = []
  blacklistListener = null
  stored = [
    { identity_key: 'f95:321', title: 'Unwanted', creator: 'Dev', source: 'f95', blacklisted_at: 1700000000 },
    { identity_key: 'gog:77', title: 'Store Game', creator: 'Studio', source: 'gog', blacklisted_at: 1690000000 },
  ]
  vi.stubGlobal('window', Object.assign(globalThis.window, {
    electronAPI: {
      getBlacklistEntries: async () => stored,
      removeBlacklistEntry: async (entry) => {
        removed.push(entry)
        stored = stored.filter((row) => row.identity_key !== entry.identity_key)
        return { success: true, removed: true }
      },
      onBlacklistUpdated: (callback) => {
        blacklistListener = callback
        return () => { blacklistListener = null }
      },
    },
  }))
})

test('the Blacklist section is a visible settings tab', () => {
  const tab = settingsIcons.find((item) => item.name === 'Blacklist')
  expect(tab).toBeDefined()
  expect(tab.hidden).not.toBe(true)
})

test('lists every blacklisted title with its source', async () => {
  await renderSettled(<BlacklistSettings />)
  expect(screen.getByText('Unwanted')).toBeTruthy()
  expect(screen.getByText('Store Game')).toBeTruthy()
  expect(screen.getByText(/Dev · F95Zone/)).toBeTruthy()
  expect(screen.getByText(/Studio · GOG/)).toBeTruthy()
})

test('Remove sends the stored row back and the list re-reads', async () => {
  await renderSettled(<BlacklistSettings />)
  const [firstRemove] = screen.getAllByRole('button', { name: 'Remove' })
  await act(async () => { fireEvent.click(firstRemove) })

  expect(removed).toHaveLength(1)
  expect(removed[0].identity_key).toBe('f95:321')
  expect(screen.queryByText('Unwanted')).toBeNull()
  expect(screen.getByText('Store Game')).toBeTruthy()
})

test('an empty blacklist says so', async () => {
  stored = []
  await renderSettled(<BlacklistSettings />)
  expect(screen.getByText('No blacklisted games.')).toBeTruthy()
})

// Blacklisting from the main window while Settings is open must show up here
// without reopening the window.
test('a blacklist change in another window refreshes the list', async () => {
  stored = []
  await renderSettled(<BlacklistSettings />)
  expect(screen.getByText('No blacklisted games.')).toBeTruthy()

  stored = [{ identity_key: 'atlas:9', title: 'Just Hidden', source: 'atlas', blacklisted_at: 1700000000 }]
  await act(async () => { blacklistListener({ removedFromWishlist: false }) })
  expect(screen.getByText('Just Hidden')).toBeTruthy()
})
