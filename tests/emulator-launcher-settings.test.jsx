// @vitest-environment jsdom
import { test, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'

import EmulatorLauncher from '../src/components/settings/EmulatorLauncher.jsx'

// The settings side of the same feature. Rendering it is the only way to catch
// the failure this replaced: the form could express one kind of mapping, so a
// user who wanted "game.sh" had no control to say so and typing it into the
// extension field produced a mapping that never matched anything.

let saved
let removed
let stored

const renderSettled = async (ui) => {
  let result
  await act(async () => { result = render(ui) })
  return result
}

beforeEach(() => {
  cleanup()
  saved = []
  removed = []
  stored = []
  vi.stubGlobal('window', Object.assign(globalThis.window, {
    electronAPI: {
      getEmulatorConfig: async () => stored,
      saveEmulatorConfig: async (config) => { saved.push(config) },
      removeEmulatorConfig: async (key, matchType) => { removed.push([key, matchType]) },
      selectFile: async () => '/usr/bin/bash',
    },
  }))
})

const fill = async (container, { matchType, matchValue }) => {
  await act(async () => {
    fireEvent.click(container.querySelector(`input[value="${matchType}"]`))
  })
  await act(async () => {
    fireEvent.change(container.querySelector('input[type="text"]'), {
      target: { value: matchValue },
    })
  })
  // Program path is read-only by design, so it has to come from the picker.
  await act(async () => { fireEvent.click(screen.getByText('Browse')) })
  await act(async () => { fireEvent.click(screen.getByText('Add Emulator/Launcher')) })
}

test('an extension mapping is still what the form produces by default', async () => {
  const { container } = await renderSettled(<EmulatorLauncher />)
  await fill(container, { matchType: 'extension', matchValue: 'sh' })

  expect(saved).toHaveLength(1)
  expect(saved[0]).toMatchObject({ extension: 'sh', match_type: 'extension', program_path: '/usr/bin/bash' })
})

test('choosing File name sends a file-name mapping instead', async () => {
  const { container } = await renderSettled(<EmulatorLauncher />)
  await fill(container, { matchType: 'filename', matchValue: 'game.sh' })

  expect(saved).toHaveLength(1)
  expect(saved[0]).toMatchObject({ extension: 'game.sh', match_type: 'filename' })
})

test('the file picker fills the name field with the base name only', async () => {
  const { container } = await renderSettled(<EmulatorLauncher />)
  await act(async () => {
    fireEvent.click(container.querySelector('input[value="filename"]'))
  })
  await act(async () => { fireEvent.click(screen.getByText('Pick file')) })

  expect(container.querySelector('input[type="text"]').value).toBe('bash')
})

test('configured mappings say which kind they are', async () => {
  stored = [
    { extension: 'sh', program_path: '/usr/bin/bash', parameters: '', match_type: 'extension' },
    { extension: 'game.sh', program_path: '/opt/special/run', parameters: '', match_type: 'filename' },
  ]
  await renderSettled(<EmulatorLauncher />)

  // The dot is the tell: an extension mapping reads ".sh", a file-name mapping
  // reads "game.sh". Without the label they would be indistinguishable rows.
  expect(screen.getByText('.sh')).toBeTruthy()
  expect(screen.getByText('game.sh')).toBeTruthy()
  expect(screen.getAllByText('File extension').length).toBeGreaterThan(0)
  expect(screen.getAllByText('File name').length).toBeGreaterThan(0)
})

test('removing a mapping tells the main process which kind it was', async () => {
  stored = [{ extension: 'sh', program_path: '/usr/bin/zsh', parameters: '', match_type: 'filename' }]
  await renderSettled(<EmulatorLauncher />)
  await act(async () => { fireEvent.click(screen.getByText('Remove')) })

  // Passing the key alone would delete whichever row sqlite reached first.
  expect(removed).toEqual([['sh', 'filename']])
})
