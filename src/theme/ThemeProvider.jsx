import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { applyTheme } from './applyTheme.js'
import {
  DEFAULT_THEME,
  DEFAULT_LAYOUT,
  getThemeById,
  normalizeLayout,
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
  return {
    theme: customTheme || getThemeById(appearance.themeId, themeList),
    layout: normalizeLayout(appearance.layout),
  }
}

/**
 * Wrap each window's top-level component (App.jsx, the settings window
 * root, the importer window root, GameDetailsWindow.jsx) in this provider.
 * It owns the "what theme/layout is currently active" state for that
 * window and keeps it in sync with:
 *   1. The saved config + the list of available themes on disk (read once
 *      on mount)
 *   2. Live broadcasts from other windows (appearance-changed IPC event)
 *
 * Components that only use Tailwind classes (bg-primary, text-text, ...)
 * don't need this provider at all — the CSS variables it sets affect them
 * automatically. Only reach for useTheme() when a component needs to
 * branch in JS on the current theme/layout (e.g. rendering Sidebar vs.
 * TopNav, or the Appearance settings picker itself).
 */
export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(DEFAULT_THEME)
  const [layout, setLayoutState] = useState(DEFAULT_LAYOUT)
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
        setIsLoaded(true)
      })
      .catch((err) => {
        console.error('ThemeProvider: failed to load Appearance config:', err)
        setIsLoaded(true)
      })
    return () => { cancelled = true }
  }, [])

  // Stay in sync with theme/layout changes made in *other* windows. Uses
  // whatever availableThemes this window already has loaded — if someone
  // adds a brand new theme file and picks it in another window while this
  // window is open, this window won't know that id until it next reloads
  // its own theme list (e.g. next time Settings is opened). That's an
  // acceptable gap: file-system changes aren't watched live, only the
  // resulting theme/layout selection is broadcast.
  useEffect(() => {
    const removeListener = window.electronAPI.onAppearanceChanged?.((appearance) => {
      const parsed = parseAppearance(appearance, availableThemes)
      setThemeState(parsed.theme)
      setLayoutState(parsed.layout)
      applyTheme(parsed.theme, parsed.layout)
    })
    return () => {
      if (typeof removeListener === 'function') removeListener()
    }
  }, [availableThemes])

  // Re-apply CSS variables whenever this window's own state changes (covers
  // both the initial load above and any local setTheme/setLayout call).
  useEffect(() => {
    applyTheme(theme, layout)
  }, [theme, layout])

  const persist = useCallback((nextTheme, nextLayout) => {
    window.electronAPI.getConfig().then((config) => {
      // Anything found by getAvailableThemes() — Default or an external
      // file — gets persisted as just an id; the file (or code, for
      // Default) is the durable source of truth, so re-reading it on next
      // launch picks up any edits automatically. customTheme JSON storage
      // is reserved for a theme object that ISN'T in availableThemes at
      // persist time (there's no UI path that produces this today, but
      // keeping it means a future "duplicate and tweak this theme" feature
      // has somewhere to write its result without a new config field).
      const isKnownTheme = availableThemes.some((t) => t.id === nextTheme.id)
      window.electronAPI.saveSettings({
        ...config,
        Appearance: {
          themeId: isKnownTheme ? nextTheme.id : 'custom',
          layout: nextLayout,
          customTheme: isKnownTheme ? '' : JSON.stringify(nextTheme),
        },
      })
    })
  }, [availableThemes])

  const setTheme = useCallback((nextTheme) => {
    setThemeState(nextTheme)
    persist(nextTheme, layout)
  }, [layout, persist])

  const setLayout = useCallback((nextLayout) => {
    const safeLayout = normalizeLayout(nextLayout)
    setLayoutState(safeLayout)
    persist(theme, safeLayout)
  }, [theme, persist])

  const value = { theme, layout, setTheme, setLayout, isLoaded, availableThemes }

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

/**
 * Read/update the active theme and layout. Must be called from within a
 * <ThemeProvider>. Returns { theme, layout, setTheme, setLayout, isLoaded,
 * availableThemes }.
 */
export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useTheme() must be called within a <ThemeProvider>')
  }
  return ctx
}

