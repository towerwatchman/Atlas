import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { applyTheme } from './applyTheme.js'
import {
  DEFAULT_THEME,
  DEFAULT_LAYOUT,
  DEFAULT_NAV_DISPLAY_MODE,
  DEFAULT_FILTER_SIDEBAR_SIDE,
  DEFAULT_FILTER_SIDEBAR_MODE,
  getThemeById,
  normalizeLayout,
  normalizeNavDisplayMode,
  normalizeFilterSidebarSide,
  normalizeFilterSidebarMode,
  normalizeLogoVariant,
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

// navDisplayMode/accentBarEnabled/filterSidebarSide/filterSidebarMode all
// fall back to the THEME's own nav defaults (not a hardcoded constant)
// whenever config.ini doesn't already have an explicit value of its own —
// i.e. the first time a theme is ever selected, or on a fresh install.
// Once a value exists in config, it's used as-is (independent of the
// active theme) until either the user changes it directly or picks a
// different theme — see setTheme below, which writes the new theme's nav
// defaults into config explicitly rather than relying on this fallback.
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
    filterSidebarSide: appearance.filterSidebarSide !== undefined && appearance.filterSidebarSide !== ''
      ? normalizeFilterSidebarSide(appearance.filterSidebarSide)
      : normalizeFilterSidebarSide(theme?.nav?.filterSidebar?.side),
    filterSidebarMode: appearance.filterSidebarMode !== undefined && appearance.filterSidebarMode !== ''
      ? normalizeFilterSidebarMode(appearance.filterSidebarMode)
      : normalizeFilterSidebarMode(theme?.nav?.filterSidebar?.mode),
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
  const [filterSidebarSide, setFilterSidebarSideState] = useState(DEFAULT_FILTER_SIDEBAR_SIDE)
  const [filterSidebarMode, setFilterSidebarModeState] = useState(DEFAULT_FILTER_SIDEBAR_MODE)
  const [availableThemes, setAvailableThemes] = useState([DEFAULT_THEME])
  const [isLoaded, setIsLoaded] = useState(false)

  // Theme Builder live preview (see ThemeBuilder.jsx + electron/ipc/
  // themes.js's broadcast-theme-preview handler). This holds the
  // in-progress DRAFT theme while a Theme Builder window is open
  // elsewhere, completely separate from the real theme/layout/etc. state
  // above — it's never persisted, and setting it never calls persist().
  // null whenever no preview is active (the normal case).
  //
  // Pure CSS variables (colors, radius, font, button/text effect colors)
  // already update live just from applyTheme() being called — no React
  // re-render needed for those. But anything React conditionally RENDERS
  // based on layout/navDisplayMode/accentBarEnabled (Sidebar vs. TopNav,
  // icon+text vs. icon-only nav buttons, the accent bar JSX block) needs
  // an actual state value to react to, which is exactly what this is for.
  const [previewTheme, setPreviewTheme] = useState(null)

  // Ref mirror of previewTheme so the once-mounted themes-changed listener
  // can tell whether a live builder preview is currently overriding this
  // window, without re-subscribing whenever the preview changes.
  const previewThemeRef = useRef(null)
  useEffect(() => {
    previewThemeRef.current = previewTheme
  }, [previewTheme])

  // The values every consumer of useTheme() actually reads. When a
  // preview is active, these resolve to the draft's own nav settings
  // instead of the real persisted ones — exactly mirroring how
  // applyTheme(draftTheme, draftTheme.nav.layout, {...}) already resolves
  // CSS variables during a preview, so JS-rendered and CSS-rendered
  // aspects of the UI stay consistent with each other while previewing.
  const effectiveTheme = previewTheme || theme
  const effectiveLayout = previewTheme ? normalizeLayout(previewTheme.nav?.layout) : layout
  const effectiveNavDisplayMode = previewTheme ? normalizeNavDisplayMode(previewTheme.nav?.displayMode) : navDisplayMode
  const effectiveAccentBarEnabled = previewTheme ? previewTheme.nav?.accentBarEnabled !== false : accentBarEnabled
  const effectiveFilterSidebarSide = previewTheme
    ? normalizeFilterSidebarSide(previewTheme.nav?.filterSidebar?.side)
    : filterSidebarSide
  const effectiveFilterSidebarMode = previewTheme
    ? normalizeFilterSidebarMode(previewTheme.nav?.filterSidebar?.mode)
    : filterSidebarMode
  // Logo variant lives entirely in the theme's nav block (it isn't a
  // separately-persisted Appearance field like layout/displayMode), so it's
  // read straight off the effective theme — the draft during a preview, the
  // persisted theme otherwise.
  const effectiveLogoVariant = normalizeLogoVariant(effectiveTheme?.nav?.logoVariant)

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
        setFilterSidebarSideState(parsed.filterSidebarSide)
        setFilterSidebarModeState(parsed.filterSidebarMode)
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
      setFilterSidebarSideState(parsed.filterSidebarSide)
      setFilterSidebarModeState(parsed.filterSidebarMode)
      applyTheme(parsed.theme, parsed.layout, {
        navDisplayMode: parsed.navDisplayMode,
        accentBarEnabled: parsed.accentBarEnabled,
      })
    })
    return () => {
      if (typeof removeListener === 'function') removeListener()
    }
  }, [availableThemes])

  // Re-apply CSS variables whenever the EFFECTIVE state changes — covers
  // the initial load above, any local setTheme/setLayout/etc call, AND
  // previewTheme changing (entering or leaving a Theme Builder preview).
  // Always uses effectiveTheme/effectiveLayout/etc., never the raw
  // theme/layout/etc., so a preview correctly overrides what's painted.
  // filterSidebarSide/filterSidebarMode aren't CSS-variable driven (see
  // App.jsx/SearchSidebar.jsx, which read them straight from useTheme()
  // instead), so they don't need to be in this dependency list — but
  // they're still part of the same provider state for consistency.
  useEffect(() => {
    applyTheme(effectiveTheme, effectiveLayout, {
      navDisplayMode: effectiveNavDisplayMode,
      accentBarEnabled: effectiveAccentBarEnabled,
    })
  }, [effectiveTheme, effectiveLayout, effectiveNavDisplayMode, effectiveAccentBarEnabled])

  // Theme Builder live preview (see ThemeBuilder.jsx + electron/ipc/
  // themes.js's broadcast-theme-preview / open-theme-builder handlers).
  // 'changed' sets previewTheme, which both re-applies CSS variables here
  // (via the effect below, since previewTheme is now a dependency) AND
  // causes effectiveTheme/effectiveLayout/etc. above to recompute, so any
  // component reading useTheme() re-renders with the draft's actual
  // layout/nav-display/accent-bar — not just its colors. 'ended' clears
  // previewTheme, which makes effectiveTheme/etc. fall back to the real
  // state again and the effect below re-applies that.
  useEffect(() => {
    const removePreviewListener = window.electronAPI.onThemePreviewChanged?.((draftTheme) => {
      setPreviewTheme(draftTheme)
    })
    const removeEndedListener = window.electronAPI.onThemePreviewEnded?.(() => {
      setPreviewTheme(null)
    })
    return () => {
      if (typeof removePreviewListener === 'function') removePreviewListener()
      if (typeof removeEndedListener === 'function') removeEndedListener()
    }
  }, [])

  // Ref mirror of the currently-active theme id, so the themes-changed
  // listener below can compare against it without having to re-subscribe
  // every time the theme changes (the listener is registered once on
  // mount). Kept in sync on every theme change via the effect below.
  const activeThemeIdRef = useRef(theme?.id)
  useEffect(() => {
    activeThemeIdRef.current = theme?.id
  }, [theme?.id])

  // Keep availableThemes in sync when the theme files on disk change (e.g.
  // the Theme Builder just saved a new theme in its own window). Without
  // this, this window's theme list is frozen at whatever it read on mount,
  // so a newly created theme wouldn't appear in the Appearance picker until
  // the client restarted. Re-reads the list and updates state, which flows
  // straight through to any consumer of useTheme().availableThemes.
  //
  // Additionally: if the file that just changed IS the currently-active
  // theme (e.g. the Theme Builder's "Save to current theme" wrote over it),
  // re-adopt the freshly-read version immediately so the edit takes effect
  // the moment it's saved — in every open window — instead of only after
  // the next restart or re-selection. This updates both the in-memory theme
  // state and its nav-derived settings, and re-applies the CSS variables,
  // exactly like picking the theme again would. A Theme Builder window that
  // is still open keeps broadcasting its own draft preview on top of this
  // (theme-preview-changed), so nothing flickers while editing; when that
  // window closes and the preview ends, windows revert to this now-updated
  // persisted theme rather than the stale pre-edit one.
  useEffect(() => {
    const removeThemesChangedListener = window.electronAPI.onThemesChanged?.(() => {
      fetchAvailableThemes().then((themeList) => {
        setAvailableThemes(themeList)
        const activeId = activeThemeIdRef.current
        if (!activeId) return
        const refreshed = themeList.find((t) => t.id === activeId)
        if (!refreshed) return
        const nextLayout = normalizeLayout(refreshed?.nav?.layout)
        const nextNavDisplayMode = normalizeNavDisplayMode(refreshed?.nav?.displayMode)
        const nextAccentBarEnabled = refreshed?.nav?.accentBarEnabled !== false
        const nextFilterSidebarSide = normalizeFilterSidebarSide(refreshed?.nav?.filterSidebar?.side)
        const nextFilterSidebarMode = normalizeFilterSidebarMode(refreshed?.nav?.filterSidebar?.mode)
        setThemeState(refreshed)
        setLayoutState(nextLayout)
        setNavDisplayModeState(nextNavDisplayMode)
        setAccentBarEnabledState(nextAccentBarEnabled)
        setFilterSidebarSideState(nextFilterSidebarSide)
        setFilterSidebarModeState(nextFilterSidebarMode)
        // Only paint immediately when no live builder preview is overriding
        // this window right now — otherwise the effectiveTheme effect above
        // would fight the active preview. When a preview is active it will
        // resolve to this updated persisted theme on its own once it ends.
        if (!previewThemeRef.current) {
          applyTheme(refreshed, nextLayout, {
            navDisplayMode: nextNavDisplayMode,
            accentBarEnabled: nextAccentBarEnabled,
          })
        }
      })
    })
    return () => {
      if (typeof removeThemesChangedListener === 'function') removeThemesChangedListener()
    }
  }, [])

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
    // accentBarEnabled, filterSidebar side/mode — glow is read directly
    // off theme.nav.glow wherever it's painted, not duplicated into
    // Appearance), overriding whatever was set before. This is
    // intentional — see the note on LAYOUT_OPTIONS in themes.js.
    const nextLayout = normalizeLayout(nextTheme?.nav?.layout)
    const nextNavDisplayMode = normalizeNavDisplayMode(nextTheme?.nav?.displayMode)
    const nextAccentBarEnabled = nextTheme?.nav?.accentBarEnabled !== false
    const nextFilterSidebarSide = normalizeFilterSidebarSide(nextTheme?.nav?.filterSidebar?.side)
    const nextFilterSidebarMode = normalizeFilterSidebarMode(nextTheme?.nav?.filterSidebar?.mode)
    setThemeState(nextTheme)
    setLayoutState(nextLayout)
    setNavDisplayModeState(nextNavDisplayMode)
    setAccentBarEnabledState(nextAccentBarEnabled)
    setFilterSidebarSideState(nextFilterSidebarSide)
    setFilterSidebarModeState(nextFilterSidebarMode)
    const isKnownTheme = availableThemes.some((t) => t.id === nextTheme.id)
    persist({
      themeId: isKnownTheme ? nextTheme.id : 'custom',
      layout: nextLayout,
      navDisplayMode: nextNavDisplayMode,
      accentBarEnabled: nextAccentBarEnabled,
      filterSidebarSide: nextFilterSidebarSide,
      filterSidebarMode: nextFilterSidebarMode,
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

  const setFilterSidebarSide = useCallback((nextSide) => {
    const safeSide = normalizeFilterSidebarSide(nextSide)
    setFilterSidebarSideState(safeSide)
    persist({ filterSidebarSide: safeSide })
  }, [persist])

  const setFilterSidebarMode = useCallback((nextMode) => {
    const safeMode = normalizeFilterSidebarMode(nextMode)
    setFilterSidebarModeState(safeMode)
    persist({ filterSidebarMode: safeMode })
  }, [persist])

  const value = {
    theme: effectiveTheme,
    layout: effectiveLayout,
    navDisplayMode: effectiveNavDisplayMode,
    accentBarEnabled: effectiveAccentBarEnabled,
    filterSidebarSide: effectiveFilterSidebarSide,
    filterSidebarMode: effectiveFilterSidebarMode,
    logoVariant: effectiveLogoVariant,
    setTheme, setLayout, setNavDisplayMode, setAccentBarEnabled,
    setFilterSidebarSide, setFilterSidebarMode,
    isLoaded, availableThemes,
  }

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

/**
 * Read/update the active theme, layout, nav display mode, accent bar
 * visibility, and filter sidebar placement. Must be called from within a
 * <ThemeProvider>. Returns { theme, layout, navDisplayMode,
 * accentBarEnabled, filterSidebarSide, filterSidebarMode, setTheme,
 * setLayout, setNavDisplayMode, setAccentBarEnabled, setFilterSidebarSide,
 * setFilterSidebarMode, isLoaded, availableThemes }.
 */
export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useTheme() must be called within a <ThemeProvider>')
  }
  return ctx
}

