/**
 * Pure DOM logic for applying a theme + layout to the document. No React
 * here on purpose — applyThemeOnLoad needs to run before React mounts (to
 * avoid a flash of default colors on startup), and applyTheme itself is
 * also called every time a theme/layout change is broadcast from the main
 * process (see useTheme.js), independent of any component's render cycle.
 */

import { THEME_COLOR_KEYS, GRADIENT_ELIGIBLE_KEYS, NAV_SIZES, DEFAULT_THEME, getThemeById, normalizeTheme, normalizeLayout, resolveColorValue } from './themes.js'

// camelCase color key -> kebab-case CSS variable name, e.g. 'dangerHover' -> '--color-danger-hover'
const cssVarNameForColorKey = (key) =>
  `--color-${key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}`

/**
 * Writes every design-token CSS variable onto :root for the given theme +
 * layout. Safe to call repeatedly (e.g. on every appearance-changed event).
 */
export function applyTheme(theme, layout) {
  const safeTheme = normalizeTheme(theme)
  const safeLayout = normalizeLayout(layout)
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

  // Exposed as a data attribute (rather than only a CSS variable) so
  // layout-branching components (Sidebar vs. TopNav) and plain CSS alike
  // can key off it without reaching into JS state.
  document.documentElement.setAttribute('data-layout', safeLayout)
  document.documentElement.setAttribute('data-theme', safeTheme.id)
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
    applyTheme(theme, appearance.layout)
  } catch (err) {
    console.error('Failed to apply saved theme on load:', err)
    applyTheme(DEFAULT_THEME, 'sidebar')
  }
}
