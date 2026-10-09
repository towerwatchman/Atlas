// @vitest-environment jsdom
import { test, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'

import Interface from '../src/components/settings/Interface.jsx'

// The Browser row is a controlled select, so what the row SHOWS is what React
// last rendered. These tests drive the real component through the Add custom
// flow instead of asserting against the source text.

let selectCustomBrowser
let checkPath
let saved

const renderSettled = async (ui) => {
  let result
  await act(async () => { result = render(ui) })
  return result
}

beforeEach(() => {
  cleanup()
  saved = []
  selectCustomBrowser = vi.fn(async () => null)
  checkPath = vi.fn(async () => ({ exists: true, isFile: true }))
  vi.stubGlobal('window', Object.assign(globalThis.window, {
    electronAPI: {
      getConfig: async () => ({ Interface: { browserId: 'brave', customBrowserPaths: [] } }),
      saveSettings: async (config) => { saved.push(config) },
      listBrowsers: async () => [
        { id: 'brave', name: 'Brave' },
        { id: 'chrome', name: 'Google Chrome' },
      ],
      selectCustomBrowser,
      checkPath,
      isWindows: () => true,
      isLinux: () => false,
    },
  }))
})

test('cancelling Add custom snaps the row back instead of stranding it', async () => {
  selectCustomBrowser.mockResolvedValue(null)
  await renderSettled(<Interface />)
  const select = screen.getByDisplayValue('Brave')
  await act(async () => { fireEvent.change(select, { target: { value: 'add-custom' } }) })
  expect(screen.getByDisplayValue('Brave')).toBeTruthy()
  expect(saved).toHaveLength(0)
})

test('picking a custom exe appends, selects, and saves it', async () => {
  selectCustomBrowser.mockResolvedValue('C:\\Tools\\x.exe')
  await renderSettled(<Interface />)
  const select = screen.getByDisplayValue('Brave')
  await act(async () => { fireEvent.change(select, { target: { value: 'add-custom' } }) })
  expect(screen.getByDisplayValue('Custom (x.exe)')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Clear' })).toBeTruthy()
  expect(saved).toHaveLength(1)
  expect(saved[0].Interface.browserId).toBe('custom:0')
  expect(saved[0].Interface.customBrowserPaths).toEqual(['C:\\Tools\\x.exe'])
})

test('choosing a listed browser saves without opening the picker', async () => {
  await renderSettled(<Interface />)
  const select = screen.getByDisplayValue('Brave')
  await act(async () => { fireEvent.change(select, { target: { value: 'chrome' } }) })
  expect(selectCustomBrowser).not.toHaveBeenCalled()
  expect(saved).toHaveLength(1)
  expect(saved[0].Interface.browserId).toBe('chrome')
})
