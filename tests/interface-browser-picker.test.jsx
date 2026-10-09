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
  stubApi(true, false)
})

const stubApi = (isWindows, isLinux) => {
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
      isWindows: () => isWindows,
      isLinux: () => isLinux,
    },
  }))
}

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

const stubLinuxApi = () => stubApi(false, true)

test('linux pick with no extension saves through the executable bit', async () => {
  stubLinuxApi()
  checkPath.mockResolvedValue({ exists: true, isFile: true, isExecutable: true })
  selectCustomBrowser.mockResolvedValue('/opt/browsers/nightly')
  await renderSettled(<Interface />)
  const select = screen.getByDisplayValue('Brave')
  await act(async () => { fireEvent.change(select, { target: { value: 'add-custom' } }) })
  expect(saved).toHaveLength(1)
  expect(saved[0].Interface.browserId).toBe('custom:0')
  expect(saved[0].Interface.customBrowserPaths).toEqual(['/opt/browsers/nightly'])
})

test('linux pick without the executable bit is rejected and saves nothing', async () => {
  stubLinuxApi()
  checkPath.mockResolvedValue({ exists: true, isFile: true, isExecutable: false })
  selectCustomBrowser.mockResolvedValue('/opt/browsers/nightly')
  await renderSettled(<Interface />)
  const select = screen.getByDisplayValue('Brave')
  await act(async () => { fireEvent.change(select, { target: { value: 'add-custom' } }) })
  expect(screen.getByDisplayValue('Brave')).toBeTruthy()
  expect(saved).toHaveLength(0)
})

test('a rejecting browsers-list still loads the rest of Settings', async () => {
  // The browser lookup shares one Promise.all with the config load, so a
  // failure there must stay in the browser row instead of blanking the pane.
  // The stubbed config flips two checkboxes away from their initial state,
  // which only the population callback can do: [debug, nsfw, updates].
  window.electronAPI.getConfig = async () => ({
    Interface: { browserId: 'default', customBrowserPaths: [], showDebugConsole: true, checkForAppUpdatesOnStartup: false },
  })
  window.electronAPI.listBrowsers = async () => { throw new Error('ipc failure') }
  const { container } = await renderSettled(<Interface />)
  // Labels are unlinked siblings of their boxes, so resolve through the DOM:
  // the stubbed config flips both boxes away from their initial state, which
  // only the population callback can do.
  const boxFor = (text) => {
    const label = [...container.querySelectorAll('label')].find((l) => l.textContent === text)
    return label.parentElement.querySelector('input[type="checkbox"]')
  }
  expect(boxFor('Show debug console window').checked).toBe(true)
  expect(boxFor('Check for Atlas updates on startup').checked).toBe(false)
})
