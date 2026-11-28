// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider.jsx'
import ThemeBuilder from '../src/components/settings/ThemeBuilder.jsx'
import { DEFAULT_THEME } from '../src/theme/themes.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => readFileSync(resolve(root, relative), 'utf8')
const lines = (relative) => read(relative).split(/\r?\n/)
const provider = read('src/theme/ThemeProvider.jsx')
const sliceFrom = (source, start, end) => {
  const from = source.indexOf(start)
  return source.slice(from, source.indexOf(end, from))
}

const themeOn = { ...DEFAULT_THEME, id: 'strip-on', name: 'Strip On', nav: { ...DEFAULT_THEME.nav, accentBarEnabled: true } }
const themeOff = { ...DEFAULT_THEME, id: 'strip-off', name: 'Strip Off', nav: { ...DEFAULT_THEME.nav, accentBarEnabled: false } }

const Probe = ({ nextTheme }) => {
  const { accentBarEnabled, setTheme } = useTheme()
  return (
    <>
      <span data-testid="accent">{String(accentBarEnabled)}</span>
      {nextTheme && <button type="button" onClick={() => setTheme(nextTheme)}>switch</button>}
    </>
  )
}

const renderWithTheme = async (api, ui) => {
  vi.stubGlobal('window', Object.assign(globalThis.window, {
    electronAPI: { saveSettings: vi.fn(), ...api },
  }))
  let result
  await act(async () => { result = render(<ThemeProvider>{ui}</ThemeProvider>) })
  return result
}

describe('per-theme accent strip', () => {
  it('checkbox only updates the draft theme', () => {
    const checkbox = lines('src/components/settings/ThemeBuilder.jsx')
      .find((line) => line.includes('checked={draft.nav.accentBarEnabled}'))
    expect(checkbox).toBeDefined()
    expect(checkbox).toContain('updateNav({ accentBarEnabled: e.target.checked })')
    expect(checkbox).not.toContain('setAccentBarEnabled')
    expect(checkbox).not.toContain('saveSettings')
  })

  it('saves the checkbox state through the theme save path', async () => {
    const saveTheme = vi.fn(async () => ({ success: true }))
    const saveSettings = vi.fn()
    const result = await renderWithTheme({
      getConfig: async () => ({ Appearance: { themeId: themeOn.id, accentBarEnabled: false } }),
      getAvailableThemes: async () => [themeOn],
      getSystemFonts: async () => [],
      saveTheme,
      saveSettings,
      broadcastThemePreview: vi.fn(),
    }, <ThemeBuilder onClose={() => {}} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Navigation' })) })
    const checkbox = screen.getByLabelText('Show the accent-colored strip behind the logo')
    expect(checkbox.checked).toBe(true)
    await act(async () => { fireEvent.click(checkbox) })
    expect(checkbox.checked).toBe(false)
    expect(saveSettings).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Save Changes to/ })) })
    expect(saveTheme).toHaveBeenCalledTimes(1)
    expect(saveTheme.mock.calls[0][0].nav.accentBarEnabled).toBe(false)
    result.unmount()
  })

  it('resolver ignores the Appearance accent value', () => {
    const parser = sliceFrom(provider, 'const parseAppearance', 'Wrap each window')
    expect(parser).toContain('accentBarEnabled: theme?.nav?.accentBarEnabled !== false')
    expect(parser).not.toContain('appearance.accentBarEnabled')
  })

  it('themes-changed adopts the theme accent flag', () => {
    const listener = sliceFrom(provider, 'const removeThemesChangedListener', 'const persist')
    expect(listener).toContain('const nextAccentBarEnabled = refreshed?.nav?.accentBarEnabled !== false')
    expect(listener).toContain('setAccentBarEnabledState(nextAccentBarEnabled)')
    expect(listener).toContain('accentBarEnabled: nextAccentBarEnabled')
  })

  it('setTheme adopts the theme accent flag', () => {
    const setTheme = sliceFrom(provider, 'const setTheme', 'const setLayout')
    expect(setTheme).toContain('const nextAccentBarEnabled = nextTheme?.nav?.accentBarEnabled !== false')
    expect(setTheme).toContain('setAccentBarEnabledState(nextAccentBarEnabled)')
    expect(setTheme).toContain('accentBarEnabled: nextAccentBarEnabled')
  })

  it('boot applyTheme call has no Appearance accent override', () => {
    const boot = sliceFrom(read('src/theme/applyTheme.js'), 'export async function applyThemeOnLoad', '} catch (err)')
    expect(boot).not.toContain('appearance.accentBarEnabled')
  })

  it('renders the theme flag even when config says false', async () => {
    const result = await renderWithTheme({
      getConfig: async () => ({ Appearance: { themeId: themeOff.id, accentBarEnabled: true } }),
      getAvailableThemes: async () => [themeOff],
    }, <Probe />)
    expect(screen.getByTestId('accent').textContent).toBe('false')
    result.unmount()
  })

  it('flips the strip when the active theme changes', async () => {
    const result = await renderWithTheme({
      getConfig: async () => ({ Appearance: { themeId: themeOn.id, accentBarEnabled: false } }),
      getAvailableThemes: async () => [themeOn, themeOff],
    }, <Probe nextTheme={themeOff} />)
    expect(screen.getByTestId('accent').textContent).toBe('true')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'switch' })) })
    expect(screen.getByTestId('accent').textContent).toBe('false')
    result.unmount()
  })

  it('remount keeps honoring the active theme', async () => {
    const api = {
      getConfig: async () => ({ Appearance: { themeId: themeOff.id, accentBarEnabled: true } }),
      getAvailableThemes: async () => [themeOff],
    }
    const first = await renderWithTheme(api, <Probe />)
    expect(screen.getByTestId('accent').textContent).toBe('false')
    first.unmount()
    const second = await renderWithTheme(api, <Probe />)
    expect(screen.getByTestId('accent').textContent).toBe('false')
    second.unmount()
  })
})
