/**
 * Pure DOM logic for applying a theme + layout to the document. No React
 * here on purpose — applyThemeOnLoad needs to run before React mounts (to
 * avoid a flash of default colors on startup), and applyTheme itself is
 * also called every time a theme/layout change is broadcast from the main
 * process (see useTheme.js), independent of any component's render cycle.
 */

import {
  THEME_COLOR_KEYS, GRADIENT_ELIGIBLE_KEYS, NAV_SIZES, DEFAULT_THEME,
  getThemeById, normalizeTheme, normalizeLayout, normalizeNavDisplayMode,
  resolveColorValue,
} from './themes.js'

// camelCase color key -> kebab-case CSS variable name, e.g. 'dangerHover' -> '--color-danger-hover'
const cssVarNameForColorKey = (key) =>
  `--color-${key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}`

/**
 * Writes every design-token CSS variable onto :root for the given theme +
 * layout + nav-display-mode + accent-bar-enabled. Safe to call repeatedly
 * (e.g. on every appearance-changed event).
 *
 * navOverrides lets the caller supply the actually-active
 * navDisplayMode/accentBarEnabled (which live independently in
 * Appearance.* once set — see ThemeProvider.jsx's parseAppearance) rather
 * than always falling back to the theme's own nav defaults. Omitted
 * fields fall back to safeTheme.nav's value.
 */
export function applyTheme(theme, layout, navOverrides = {}) {
  const safeTheme = normalizeTheme(theme)
  const safeLayout = normalizeLayout(layout !== undefined && layout !== '' ? layout : safeTheme.nav.layout)
  const safeNavDisplayMode = normalizeNavDisplayMode(
    navOverrides.navDisplayMode !== undefined ? navOverrides.navDisplayMode : safeTheme.nav.displayMode,
  )
  const safeAccentBarEnabled =
    navOverrides.accentBarEnabled !== undefined ? navOverrides.accentBarEnabled !== false : safeTheme.nav.accentBarEnabled
  const root = document.documentElement.style

  for (const key of THEME_COLOR_KEYS) {
    const { solid, gradient } = resolveColorValue(key, safeTheme.colors[key])
    root.setProperty(cssVarNameForColorKey(key), solid)
    if (GRADIENT_ELIGIBLE_KEYS.includes(key)) {
      root.setProperty(`--gradient-${key}`, gradient)
    }
  }

  root.setProperty('--radius-active', `var(--radius-${safeTheme.radius})`)
  root.setProperty('--font-sans', safeTheme.font)
  root.setProperty('--nav-size', NAV_SIZES[safeLayout])

  // Nav button glow — only ever painted on TopNav.jsx's active button (see
  // DEFAULT_GLOW in themes.js). Always set --nav-glow (even to 'none') so
  // a theme that disables glow cleanly removes any previous theme's glow
  // rather than leaving it on. Order matches CSS box-shadow: offsetX
  // offsetY blur color.
  const glow = safeTheme.nav.glow
  root.setProperty(
    '--nav-glow',
    glow.enabled ? `${glow.offsetX}px ${glow.offsetY}px ${glow.intensity}px ${glow.color}` : 'none',
  )

  // Exposed as data attributes (rather than only CSS variables) so
  // layout-branching components (Sidebar vs. TopNav) and plain CSS alike
  // can key off them without reaching into JS state.
  document.documentElement.setAttribute('data-layout', safeLayout)
  document.documentElement.setAttribute('data-theme', safeTheme.id)
  document.documentElement.setAttribute('data-nav-display', safeNavDisplayMode)
  document.documentElement.setAttribute('data-accent-bar', safeAccentBarEnabled ? 'on' : 'off')
}

/**
 * Fetches the saved Appearance config and applies it immediately, before
 * React mounts. Each of the 4 window entry points (main.jsx, settings.jsx,
 * importer.jsx, gamedetails.jsx) calls this once at startup, exactly where
 * they currently import main.css — see ThemeProvider.jsx for the
 * React-side hook that takes over after mount and reacts to live
 * appearance-changed events.
 *
 * If the saved themeId points at an external theme file (templates/theme/),
 * this needs that file's contents before it can paint the right colors, so
 * it fetches both the config and the available-themes list together. On a
 * fresh/default install (themeId: 'default') this resolves to DEFAULT_THEME
 * immediately and there's no visible delay since main.css's own :root
 * defaults already match it. Falls back to Default + sidebar layout if
 * anything here fails, so a slow or broken read never means a visibly
 * broken UI — at worst, the wrong (but valid) theme briefly, corrected once
 * ThemeProvider mounts.
 */
export async function applyThemeOnLoad() {
  try {
    const [config, externalThemes] = await Promise.all([
      window.electronAPI.getConfig(),
      window.electronAPI.getAvailableThemes?.().catch(() => []),
    ])
    const appearance = config?.Appearance || {}
    const customTheme = appearance.customTheme
      ? JSON.parse(appearance.customTheme)
      : null
    const themeList = [DEFAULT_THEME, ...(Array.isArray(externalThemes) ? externalThemes : [])]
    const theme = customTheme || getThemeById(appearance.themeId, themeList)
    applyTheme(theme, appearance.layout, {
      navDisplayMode: appearance.navDisplayMode,
      accentBarEnabled:
        appearance.accentBarEnabled !== undefined && appearance.accentBarEnabled !== ''
          ? appearance.accentBarEnabled !== false && appearance.accentBarEnabled !== 'false'
          : undefined,
    })
  } catch (err) {
    console.error('Failed to apply saved theme on load:', err)
    applyTheme(DEFAULT_THEME, 'sidebar')
  }
}
