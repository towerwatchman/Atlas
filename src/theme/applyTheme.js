/**
 * Pure DOM logic for applying a theme + layout to the document. No React
 * here on purpose — applyThemeOnLoad needs to run before React mounts (to
 * avoid a flash of default colors on startup), and applyTheme itself is
 * also called every time a theme/layout change is broadcast from the main
 * process (see useTheme.js), independent of any component's render cycle.
 */

import {
  THEME_COLOR_KEYS, GRADIENT_ELIGIBLE_KEYS, NAV_SIZES, DEFAULT_THEME,
  TEXT_EFFECT_CONTEXTS,
  getThemeById, normalizeTheme, normalizeLayout, normalizeNavDisplayMode,
  resolveColorValue,
} from './themes.js'

// camelCase color key -> kebab-case CSS variable name, e.g. 'dangerHover' -> '--color-danger-hover'
const cssVarNameForColorKey = (key) =>
  `--color-${key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}`

// Builds a CSS box-shadow/text-shadow value string from a GlowSpec (see
// DEFAULT_GLOW in themes.js), or 'none' if disabled — shared by nav glow,
// app-wide button shadow/glow, and per-context text shadow/glow so the
// offsetX/offsetY/blur/color ordering only needs to be right in one place.
const buildShadowValue = (spec) =>
  spec?.enabled ? `${spec.offsetX}px ${spec.offsetY}px ${spec.intensity}px ${spec.color}` : 'none'

// kebab-case for a TEXT_EFFECT_CONTEXTS entry, e.g. 'navLabels' -> 'nav-labels'
const kebabCase = (key) => key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()

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

  // windowBorder is set like any other color above, but can also be
  // switched off entirely (windowBorderEnabled) — when off, make it
  // transparent rather than introducing a second on/off mechanism (a CSS
  // class or data attribute) that every window's border usage would also
  // need to account for.
  if (!safeTheme.windowBorderEnabled) {
    root.setProperty('--color-window-border', 'transparent')
  }

  root.setProperty('--radius-active', `var(--radius-${safeTheme.radius})`)
  root.setProperty('--font-sans', safeTheme.font)
  root.setProperty('--nav-size', NAV_SIZES[safeLayout])

  // Nav button glow — only ever painted on TopNav.jsx's active button (see
  // DEFAULT_GLOW in themes.js). Always set --nav-glow (even to 'none') so
  // a theme that disables glow cleanly removes any previous theme's glow
  // rather than leaving it on.
  root.setProperty('--nav-glow', buildShadowValue(safeTheme.nav.glow))

  // App-wide button effects (DEFAULT_BUTTON_EFFECTS in themes.js) — unlike
  // nav.glow above, these apply to every button in the app, not just the
  // active TopNav one. --button-shadow is painted unconditionally via
  // .btn-shadow (see main.css); --button-glow is only painted on
  // hover/focus/active via .btn-glow:hover/:focus/.active, never as a
  // permanent effect, mirroring how nav.glow itself is scoped to an
  // interaction state rather than always-on.
  root.setProperty('--button-shadow', buildShadowValue(safeTheme.buttonEffects.shadow))
  root.setProperty('--button-glow', buildShadowValue(safeTheme.buttonEffects.glow))

  // Text effects (DEFAULT_TEXT_EFFECTS in themes.js) — one shared shadow
  // value and one shared glow value, written once here, plus a per-context
  // on/off data attribute for each entry in TEXT_EFFECT_CONTEXTS so CSS
  // can decide which text actually uses them (see the .text-shadow /
  // .text-glow utility classes + [data-text-shadow-*]/[data-text-glow-*]
  // attribute selectors in main.css). Text-shadow only needs x/y/blur/color
  // — the same 4 values buildShadowValue already produces — so it's reused
  // as-is rather than a separate builder.
  root.setProperty('--text-shadow', buildShadowValue(safeTheme.textEffects.shadow))
  root.setProperty('--text-glow', buildShadowValue(safeTheme.textEffects.glow))
  for (const ctx of TEXT_EFFECT_CONTEXTS) {
    const ctxConfig = safeTheme.textEffects.contexts[ctx] || { shadow: false, glow: false }
    document.documentElement.setAttribute(`data-text-shadow-${kebabCase(ctx)}`, ctxConfig.shadow ? 'on' : 'off')
    document.documentElement.setAttribute(`data-text-glow-${kebabCase(ctx)}`, ctxConfig.glow ? 'on' : 'off')
  }

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
