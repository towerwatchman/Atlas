import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { applyTheme } from './applyTheme.js'
import {
  DEFAULT_THEME,
  DEFAULT_LAYOUT,
  DEFAULT_NAV_DISPLAY_MODE,
  getThemeById,
  normalizeLayout,
  normalizeNavDisplayMode,
} from './themes.js'

const ThemeContext = createContext(null)

// DEFAULT_THEME plus whatever external theme files electronAPI.getAvailableThemes()
// found in templates/theme/. DEFAULT_THEME is always first and always present,
// even if the IPC call fails — it's the one theme that doesn't depend on disk.
const fetchAvailableThemes = async () => {
  try {
    const externalThemes = await window.electronAPI.getAvailableThemes?.()
    return [DEFAULT_THEME, ...(Array.isArray(externalThemes) ? externalThemes : [])]
  } catch (err) {
    console.error('Failed to load external theme files:', err)
    return [DEFAULT_THEME]
  }
}

// navDisplayMode/accentBarEnabled fall back to the THEME's own nav defaults
// (not a hardcoded constant) whenever config.ini doesn't already have an
// explicit value of its own — i.e. the first time a theme is ever selected,
// or on a fresh install. Once a value exists in config, it's used as-is
// (independent of the active theme) until either the user changes it
// directly or picks a different theme — see setTheme below, which writes
// the new theme's nav defaults into config explicitly rather than relying
// on this fallback.
const parseAppearance = (appearance = {}, themeList) => {
  const customTheme = appearance.customTheme
    ? (() => {
        try {
          return JSON.parse(appearance.customTheme)
        } catch {
          return null
        }
      })()
    : null
  const theme = customTheme || getThemeById(appearance.themeId, themeList)
  return {
    theme,
    layout: appearance.layout !== undefined && appearance.layout !== ''
      ? normalizeLayout(appearance.layout)
      : normalizeLayout(theme?.nav?.layout),
    navDisplayMode: appearance.navDisplayMode !== undefined && appearance.navDisplayMode !== ''
      ? normalizeNavDisplayMode(appearance.navDisplayMode)
      : normalizeNavDisplayMode(theme?.nav?.displayMode),
    accentBarEnabled: appearance.accentBarEnabled !== undefined && appearance.accentBarEnabled !== ''
      ? appearance.accentBarEnabled !== false && appearance.accentBarEnabled !== 'false'
      : theme?.nav?.accentBarEnabled !== false,
  }
}

/**
 * Wrap each window's top-level component (App.jsx, the settings window
 * root, the importer window root, GameDetailsWindow.jsx) in this provider.
 * It owns the "what theme/layout/nav-display/accent-bar is currently
 * active" state for that window and keeps it in sync with:
 *   1. The saved config + the list of available themes on disk (read once
 *      on mount)
 *   2. Live broadcasts from other windows (appearance-changed IPC event)
 *
 * Components that only use Tailwind classes (bg-primary, text-text, ...)
 * don't need this provider at all — the CSS variables it sets affect them
 * automatically. Only reach for useTheme() when a component needs to
 * branch in JS on the current theme/layout/nav settings (e.g. rendering
 * Sidebar vs. TopNav, or the Appearance settings picker itself).
 */
export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(DEFAULT_THEME)
  const [layout, setLayoutState] = useState(DEFAULT_LAYOUT)
  const [navDisplayMode, setNavDisplayModeState] = useState(DEFAULT_NAV_DISPLAY_MODE)
  const [accentBarEnabled, setAccentBarEnabledState] = useState(true)
  const [availableThemes, setAvailableThemes] = useState([DEFAULT_THEME])
  const [isLoaded, setIsLoaded] = useState(false)

  // Load the available theme list AND the saved appearance once on mount.
  // Both are needed together: parseAppearance needs the theme list to
  // resolve a saved themeId to an actual theme object (an external theme
  // file can't be looked up before we know it exists). applyThemeOnLoad
  // (called earlier, before React even mounted — see windows/*.jsx) already
  // painted the correct CSS variables from this same data, so this is just
  // catching React's own state up to what's already on screen; it does not
  // cause a visual change itself.
  useEffect(() => {
    let cancelled = false
    Promise.all([fetchAvailableThemes(), window.electronAPI.getConfig()])
      .then(([themeList, config]) => {
        if (cancelled) return
        setAvailableThemes(themeList)
        const parsed = parseAppearance(config?.Appearance, themeList)
        setThemeState(parsed.theme)
        setLayoutState(parsed.layout)
        setNavDisplayModeState(parsed.navDisplayMode)
        setAccentBarEnabledState(parsed.accentBarEnabled)
        setIsLoaded(true)
      })
      .catch((err) => {
        console.error('ThemeProvider: failed to load Appearance config:', err)
        setIsLoaded(true)
      })
    return () => { cancelled = true }
  }, [])

  // Stay in sync with theme/layout/nav-display/accent-bar changes made in
  // *other* windows. Uses whatever availableThemes this window already has
  // loaded — if someone adds a brand new theme file and picks it in
  // another window while this window is open, this window won't know that
  // id until it next reloads its own theme list (e.g. next time Settings
  // is opened). That's an acceptable gap: file-system changes aren't
  // watched live, only the resulting selection is broadcast.
  useEffect(() => {
    const removeListener = window.electronAPI.onAppearanceChanged?.((appearance) => {
      const parsed = parseAppearance(appearance, availableThemes)
      setThemeState(parsed.theme)
      setLayoutState(parsed.layout)
      setNavDisplayModeState(parsed.navDisplayMode)
      setAccentBarEnabledState(parsed.accentBarEnabled)
      applyTheme(parsed.theme, parsed.layout, {
        navDisplayMode: parsed.navDisplayMode,
        accentBarEnabled: parsed.accentBarEnabled,
      })
    })
    return () => {
      if (typeof removeListener === 'function') removeListener()
    }
  }, [availableThemes])

  // Re-apply CSS variables whenever this window's own state changes (covers
  // both the initial load above and any local setTheme/setLayout/etc call).
  useEffect(() => {
    applyTheme(theme, layout, { navDisplayMode, accentBarEnabled })
  }, [theme, layout, navDisplayMode, accentBarEnabled])

  const persist = useCallback((nextAppearance) => {
    window.electronAPI.getConfig().then((config) => {
      window.electronAPI.saveSettings({
        ...config,
        Appearance: { ...config.Appearance, ...nextAppearance },
      })
    })
  }, [])

  // Anything found by getAvailableThemes() — Default or an external file —
  // gets persisted as just an id; the file (or code, for Default) is the
  // durable source of truth, so re-reading it on next launch picks up any
  // edits automatically. customTheme JSON storage is reserved for a theme
  // object that ISN'T in availableThemes at persist time (there's no UI
  // path that produces this today, but keeping it means a future
  // "duplicate and tweak this theme" feature has somewhere to write its
  // result without a new config field).
  const setTheme = useCallback((nextTheme) => {
    // Picking a theme adopts ITS nav defaults (layout, displayMode,
    // accentBarEnabled — glow is read directly off theme.nav.glow wherever
    // it's painted, not duplicated into Appearance), overriding whatever
    // was set before. This is intentional — see the note on LAYOUT_OPTIONS
    // in themes.js.
    const nextLayout = normalizeLayout(nextTheme?.nav?.layout)
    const nextNavDisplayMode = normalizeNavDisplayMode(nextTheme?.nav?.displayMode)
    const nextAccentBarEnabled = nextTheme?.nav?.accentBarEnabled !== false
    setThemeState(nextTheme)
    setLayoutState(nextLayout)
    setNavDisplayModeState(nextNavDisplayMode)
    setAccentBarEnabledState(nextAccentBarEnabled)
    const isKnownTheme = availableThemes.some((t) => t.id === nextTheme.id)
    persist({
      themeId: isKnownTheme ? nextTheme.id : 'custom',
      layout: nextLayout,
      navDisplayMode: nextNavDisplayMode,
      accentBarEnabled: nextAccentBarEnabled,
      customTheme: isKnownTheme ? '' : JSON.stringify(nextTheme),
    })
  }, [availableThemes, persist])

  const setLayout = useCallback((nextLayout) => {
    const safeLayout = normalizeLayout(nextLayout)
    setLayoutState(safeLayout)
    persist({ layout: safeLayout })
  }, [persist])

  const setNavDisplayMode = useCallback((nextMode) => {
    const safeMode = normalizeNavDisplayMode(nextMode)
    setNavDisplayModeState(safeMode)
    persist({ navDisplayMode: safeMode })
  }, [persist])

  const setAccentBarEnabled = useCallback((nextEnabled) => {
    const safeEnabled = nextEnabled !== false
    setAccentBarEnabledState(safeEnabled)
    persist({ accentBarEnabled: safeEnabled })
  }, [persist])

  const value = {
    theme, layout, navDisplayMode, accentBarEnabled,
    setTheme, setLayout, setNavDisplayMode, setAccentBarEnabled,
    isLoaded, availableThemes,
  }

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

/**
 * Read/update the active theme, layout, nav display mode, and accent bar
 * visibility. Must be called from within a <ThemeProvider>. Returns
 * { theme, layout, navDisplayMode, accentBarEnabled, setTheme, setLayout,
 * setNavDisplayMode, setAccentBarEnabled, isLoaded, availableThemes }.
 */
export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useTheme() must be called within a <ThemeProvider>')
  }
  return ctx
}

