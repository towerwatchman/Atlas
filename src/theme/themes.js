/**
 * Theme schema + the one theme that's always guaranteed to exist.
 *
 * DEFAULT_THEME is the only theme defined in code. Every other theme is an
 * external, user-editable JSON file living in the app's data directory
 * (templates/theme/, alongside the existing templates/banner/ convention —
 * see electron/ipc/themes.js). Atlas ships one example file there,
 * xlibrary.json (sourced from src/assets/templates/theme/xlibrary.json on
 * first run), so there's a working second theme to look at out of the box,
 * but it is just a file — it can be edited, renamed, or deleted like any
 * other theme a person adds themselves.
 *
 * A theme is a plain JSON-serializable object:
 * {
 *   id:     string   — stable identifier. For external themes this is
 *           derived from the filename (xlibrary.json -> "xlibrary") so two
 *           files can't collide; never shown to the user.
 *   name:   string   — display name shown in the Appearance picker
 *   radius: 'sm' | 'md' | 'lg' | 'pill' — how rounded buttons/cards are.
 *           This maps to one of the --radius-* variables already defined in
 *           main.css; it does not introduce a new arbitrary radius value, so
 *           every theme's "roundedness" is one of the same 4 visual options.
 *   font:   string   — CSS font-family stack assigned to --font-sans
 *   colors: { ...every --color-* variable from main.css, without the prefix }
 * }
 *
 * Note: nav position (sidebar vs. topnav) is intentionally NOT part of a
 * theme. It's a separate, independent setting (Appearance.layout in
 * config.ini) so any theme can be combined with either nav position. See
 * LAYOUT_OPTIONS / DEFAULT_LAYOUT below.
 *
 * IMPORTANT: keep this object's `colors` keys in sync with the --color-*
 * variables declared in src/assets/css/main.css. THEME_COLOR_KEYS below is
 * the authoritative list both the ThemeProvider and the external-theme
 * loader (electron/ipc/themes.js, normalizeTheme below) should use, rather
 * than re-deriving it.
 */

export const THEME_COLOR_KEYS = [
  'canvas',
  'shadow',
  'primary',
  'secondary',
  'tertiary',
  'border',
  'selected',
  'accent',
  'accentBar',
  'atlasLogo',
  'text',
  'highlight',
  'overlayTop',
  'overlayBottom',
  'muted',
  'danger',
  'dangerHover',
  'dangerStrong',
  'success',
  'successHover',
  'warning',
  'info',
  'buttonHover',
  'accentHover',
]

export const RADIUS_OPTIONS = ['sm', 'md', 'lg', 'pill']

/**
 * Nav position is independent of theme — any theme can be paired with
 * either layout. Stored as Appearance.layout in config.ini.
 */
export const LAYOUT_OPTIONS = ['sidebar', 'topnav']
export const DEFAULT_LAYOUT = 'sidebar'

/**
 * --nav-size is the horizontal space reserved on the left for the nav
 * rail. Sidebar mode reserves 60px (Sidebar.jsx's width) for content to
 * sit to the right of. Topnav mode reserves 0 — its nav icons are
 * integrated directly into the existing top header bar (see TopNav.jsx /
 * App.jsx), not a second bar that takes up extra space of its own, so
 * there's no left-hand offset for the content area to account for.
 */
export const NAV_SIZES = {
  sidebar: '60px',
  topnav: '0px',
}

export const DEFAULT_THEME = {
  id: 'default',
  name: 'Default',
  radius: 'sm',
  font: '"Inter", "Segoe UI", ui-sans-serif, system-ui, sans-serif',
  colors: {
    canvas:         '#000000',
    shadow:         '#000000',
    primary:        '#19191c',
    secondary:      '#242629',
    tertiary:       '#313338',
    border:         '#51535A',
    selected:       '#404249',
    accent:         '#2C8EA9',
    accentBar:      '#2C8EA9',
    atlasLogo:      '#FFFFFF',
    text:           '#d2d2d2',
    highlight:      '#2C8EA9',
    overlayTop:     '#000000',
    overlayBottom:  '#000000',
    muted:          '#9CA3AF',
    danger:         '#DC2626',
    dangerHover:    '#B91C1C',
    dangerStrong:   '#7F1D1D',
    success:        '#16A34A',
    successHover:   '#15803D',
    warning:        '#FACC15',
    info:           '#38BDF8',
    buttonHover:    '#404249', // matches `selected`, the existing working hover pattern
    accentHover:    '#24748A', // ~18% darker than accent
  },
}

/**
 * The only theme list that's always correct without any IPC call. Used as
 * the initial value before the external-theme fetch resolves, and as the
 * fallback if that fetch fails for any reason.
 */
export const BUILT_IN_THEMES = [DEFAULT_THEME]

/**
 * Looks up a theme by id within a given list (defaults to just
 * DEFAULT_THEME). Pass the full list — DEFAULT_THEME plus whatever
 * electronAPI.getAvailableThemes() returned — once that call has resolved;
 * see ThemeProvider.jsx.
 */
export const getThemeById = (id, themeList = BUILT_IN_THEMES) =>
  themeList.find((theme) => theme.id === id) || DEFAULT_THEME

/**
 * Fills in any missing top-level or color keys from DEFAULT_THEME.
 * Used whenever a theme comes from an untrusted/external source (config.ini,
 * a future custom-theme JSON file) so a partial or stale theme object never
 * leaves a CSS variable unset.
 */
export const normalizeTheme = (theme) => {
  if (!theme || typeof theme !== 'object') return DEFAULT_THEME
  return {
    ...DEFAULT_THEME,
    ...theme,
    colors: {
      ...DEFAULT_THEME.colors,
      ...(theme.colors || {}),
    },
  }
}

/**
 * Guards against a malformed/stale Appearance.layout value from config.ini
 * (e.g. hand-edited file, or an older config from before a layout option
 * was removed). Falls back to DEFAULT_LAYOUT rather than letting an unknown
 * string reach --nav-size lookups.
 */
export const normalizeLayout = (layout) =>
  LAYOUT_OPTIONS.includes(layout) ? layout : DEFAULT_LAYOUT
