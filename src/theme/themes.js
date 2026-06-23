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
 *           Each color value is normally a hex string ('#19191c'). For
 *           the 4 keys in GRADIENT_ELIGIBLE_KEYS below (the surfaces that
 *           are ever used as a CSS background-color in this app), a color
 *           value MAY instead be a gradient object:
 *           { type: 'linear', angle: 180, stops: ['#19191c', '#0d0d0f'] }
 *           - type:   only 'linear' is supported right now.
 *           - angle:  degrees, same convention as CSS linear-gradient()
 *                     (0 = bottom-to-top, 90 = left-to-right, 180 =
 *                     top-to-bottom, etc).
 *           - stops:  2 or more hex colors, spread evenly along the
 *                     gradient. No per-stop position control — keeps
 *                     authoring simple; most themes only need 2-3 stops.
 *           A gradient on any other key is ignored (treated as invalid —
 *           see isGradientValue/resolveColorValue below), since there's
 *           no CSS background-image slot for it to paint into.
 * }
 *
 * Note: a theme's `nav` block (layout, displayMode, accentBarEnabled, glow)
 * is a SUGGESTED default, applied when that theme is selected — but the
 * actually-active values still live independently in Appearance.layout /
 * Appearance.navDisplayMode / Appearance.accentBarEnabled in config.ini,
 * exactly like radius/font, so they can still be changed afterward without
 * switching themes. See LAYOUT_OPTIONS / DEFAULT_NAV / normalizeNav below.
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
  // The accent-colored border drawn around every window (see
  // windowBorderEnabled below for the on/off toggle — the border itself
  // is drawn by src/components/ui/WindowBorderFrame.jsx, a fixed overlay
  // rather than a regular CSS border, so it can't be visually covered by
  // a scrollbar or a full-width fixed header/footer bar).
  'windowBorder',
]

/**
 * The only color keys that may hold a gradient object instead of a flat
 * hex string. Restricted to surfaces that are ever used as a CSS
 * background-color in this app (confirmed by grepping every bg-, text-,
 * and border- usage across src/) — main.css has a matching
 * --gradient-canvas/-primary/-secondary/-tertiary variable for each of
 * these, and only these. A gradient on text/accent/border/etc. has no
 * CSS property to paint into (you can't put a gradient in `color` or
 * `border-color` the way you can `background-image`), so it's rejected
 * rather than silently doing nothing.
 */
export const GRADIENT_ELIGIBLE_KEYS = ['canvas', 'primary', 'secondary', 'tertiary']

/**
 * A valid gradient object: { type: 'linear', angle: number, stops: [hex, hex, ...] }
 * with at least 2 stops. Anything else (wrong shape, too few stops,
 * unsupported type) is NOT a valid gradient — callers should fall back to
 * treating the color as flat/invalid rather than passing a malformed
 * value through to CSS.
 */
export const isValidGradient = (value) =>
  value !== null &&
  typeof value === 'object' &&
  value.type === 'linear' &&
  typeof value.angle === 'number' &&
  Array.isArray(value.stops) &&
  value.stops.length >= 2 &&
  value.stops.every((s) => typeof s === 'string')

/** True if `value` looks like a gradient was *intended*, valid or not — used to
 * distinguish "this is supposed to be a gradient but is malformed" (fall back
 * to a solid color derived from it if possible) from "this was never meant to
 * be a gradient" (e.g. a plain hex string, the normal case). */
const looksLikeGradientAttempt = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** Builds the CSS linear-gradient(...) string for a valid gradient object. */
export const gradientToCss = (gradient) =>
  `linear-gradient(${gradient.angle}deg, ${gradient.stops.join(', ')})`

/**
 * Resolves a single theme color value (for `key`) into the two things the
 * CSS layer needs: a flat hex fallback for --color-{key} (always set, so
 * --color-{key} is never left as a gradient-object-turned-"[object
 * Object]" string), and a CSS gradient string for --gradient-{key} (only
 * for GRADIENT_ELIGIBLE_KEYS; 'none' otherwise/by default).
 *
 * - Plain hex string -> { solid: value, gradient: 'none' }
 * - Valid gradient object on an eligible key -> { solid: first stop,
 *   gradient: the linear-gradient(...) string }
 * - Gradient object on a NON-eligible key, or an invalid/malformed
 *   gradient object anywhere -> falls back to the first stop (if any) as
 *   a flat color, or '#000000' as a last resort, with gradient: 'none'.
 *   This keeps a broken/misplaced gradient from ever reaching the DOM as
 *   a raw object or breaking the surface entirely.
 */
export const resolveColorValue = (key, value) => {
  if (typeof value === 'string') {
    return { solid: value, gradient: 'none' }
  }
  if (looksLikeGradientAttempt(value)) {
    const eligible = GRADIENT_ELIGIBLE_KEYS.includes(key)
    if (eligible && isValidGradient(value)) {
      return { solid: value.stops[0], gradient: gradientToCss(value) }
    }
    // Not eligible for a gradient here, or malformed — use the first
    // stop as a best-effort flat fallback so the surface still has SOME
    // sensible color rather than breaking.
    const fallbackStop = Array.isArray(value.stops) ? value.stops.find((s) => typeof s === 'string') : null
    return { solid: fallbackStop || '#000000', gradient: 'none' }
  }
  return { solid: '#000000', gradient: 'none' }
}

export const RADIUS_OPTIONS = ['sm', 'md', 'lg', 'pill']

/**
 * Nav position is independent of theme STATE (Appearance.layout in
 * config.ini is still the durable source of truth for what's currently
 * active), but each theme JSON file may specify its own preferred nav
 * settings under a `nav` object — see DEFAULT_NAV / NAV_DISPLAY_MODE_OPTIONS
 * / DEFAULT_FILTER_SIDEBAR below. Picking a theme in the Appearance picker
 * re-applies that theme's `nav` block (layout + displayMode +
 * accentBarEnabled + glow + filterSidebar), overwriting whatever was set
 * before — see ThemeProvider.jsx's setTheme/persist. This is intentional:
 * a theme like XLibrary is designed around a specific nav arrangement
 * (topnav, icons+text, no accent bar), and switching to it should look
 * the way its author intended without an extra manual step.
 */
export const LAYOUT_OPTIONS = ['sidebar', 'topnav']
export const DEFAULT_LAYOUT = 'sidebar'

/**
 * How nav buttons render their label: icon only, icon + text side by side,
 * or text only. Applies identically to both Sidebar.jsx (vertical rail) and
 * TopNav.jsx (horizontal bar) — see renderNavLabel-style logic in each.
 */
export const NAV_DISPLAY_MODE_OPTIONS = ['icons', 'iconsAndText', 'text']
export const DEFAULT_NAV_DISPLAY_MODE = 'icons'

export const normalizeNavDisplayMode = (mode) =>
  NAV_DISPLAY_MODE_OPTIONS.includes(mode) ? mode : DEFAULT_NAV_DISPLAY_MODE

/**
 * A theme's `nav` block: its preferred layout + nav button presentation +
 * the optional glow effect applied only to the ACTIVE/selected button in
 * TopNav.jsx's topnav bar (never Sidebar.jsx's vertical rail, and never
 * an unselected button) — see GlowSpec below and applyTheme.js / main.css
 * (.nav-glow) / TopNav.jsx for where it's actually painted.
 *
 * GlowSpec shape: { enabled: bool, color: hex string, offsetX: number,
 * offsetY: number, intensity: number (blur radius in px, roughly 0-40) }.
 * offsetX/offsetY let the glow be asymmetric (e.g. a glow that leans
 * slightly downward); 0/0 is a centered, even glow — the common case.
 */
export const DEFAULT_GLOW = {
  enabled: false,
  color: '#2C8EA9',
  offsetX: 0,
  offsetY: 0,
  intensity: 12,
}

/**
 * Which edge the filter sidebar (SearchSidebar.jsx) docks to, and whether
 * it floats on top of the library grid ('overlay', the original/default
 * behavior — fixed position, grid does not reflow) or shares horizontal
 * space with it ('inline' — a normal flex sibling, grid shrinks to make
 * room, same general mechanism the existing library-list panel already
 * uses). See App.jsx's main-content layout for where this is consumed.
 */
export const FILTER_SIDEBAR_SIDE_OPTIONS = ['left', 'right']
export const DEFAULT_FILTER_SIDEBAR_SIDE = 'right'
export const FILTER_SIDEBAR_MODE_OPTIONS = ['overlay', 'inline']
export const DEFAULT_FILTER_SIDEBAR_MODE = 'overlay'

export const DEFAULT_FILTER_SIDEBAR = {
  side: DEFAULT_FILTER_SIDEBAR_SIDE,
  mode: DEFAULT_FILTER_SIDEBAR_MODE,
}

export const normalizeFilterSidebarSide = (side) =>
  FILTER_SIDEBAR_SIDE_OPTIONS.includes(side) ? side : DEFAULT_FILTER_SIDEBAR_SIDE

export const normalizeFilterSidebarMode = (mode) =>
  FILTER_SIDEBAR_MODE_OPTIONS.includes(mode) ? mode : DEFAULT_FILTER_SIDEBAR_MODE

/**
 * App-wide button effects — distinct from nav.glow above, which is scoped
 * specifically to TopNav's active/selected button. This block applies to
 * ALL buttons across the app (Settings, dialogs, the filter sidebar's
 * Reset/Close, etc.), at the theme's top level rather than under `nav`,
 * since it isn't nav-specific.
 *
 * - shadow: always-on whenever enabled (a permanent drop shadow on every
 *   button, regardless of interaction state).
 * - glow: only painted on hover/active/focus — never a permanent effect —
 *   same reasoning as nav.glow's active-only scoping, just generalized to
 *   every button instead of only the active nav button.
 *
 * Both reuse the same { enabled, color, offsetX, offsetY, intensity }
 * GlowSpec shape as DEFAULT_GLOW.
 */
export const DEFAULT_BUTTON_EFFECTS = {
  shadow: { ...DEFAULT_GLOW },
  glow: { ...DEFAULT_GLOW },
}

const normalizeEffectSpec = (spec) => ({
  ...DEFAULT_GLOW,
  ...(spec && typeof spec === 'object' ? spec : {}),
})

export const normalizeButtonEffects = (buttonEffects) => {
  const safe = buttonEffects && typeof buttonEffects === 'object' ? buttonEffects : {}
  return {
    shadow: normalizeEffectSpec(safe.shadow),
    glow: normalizeEffectSpec(safe.glow),
  }
}

/**
 * Text effects — a single shared shadow style and a single shared glow
 * style (same GlowSpec shape again), each independently toggleable per
 * text context rather than each context getting its own fully independent
 * color/offset/intensity. Keeps the config surface manageable: changing
 * "the" text glow color changes it everywhere it's turned on, rather than
 * needing to update 3 separate color pickers that are likely meant to
 * match anyway.
 *
 * - shadow: always-on (per context) whenever that context's shadow toggle
 *   is true.
 * - glow: only painted on hover/select (per context) when that context's
 *   glow toggle is true — never a permanent effect, same as button glow.
 *
 * contexts lists which UI text each effect can apply to:
 *   - navLabels: Sidebar.jsx / TopNav.jsx button text (iconsAndText/text
 *     display modes only — see NAV_DISPLAY_MODE_OPTIONS)
 *   - pageTitles: section heading text (e.g. the Games/Browse/Wishlist
 *     title shown in sidebar layout's header — see App.jsx's viewTitle)
 *   - gameTitles: game name text in the library grid/list views
 */
export const TEXT_EFFECT_CONTEXTS = ['navLabels', 'pageTitles', 'gameTitles']

export const DEFAULT_TEXT_EFFECTS = {
  shadow: { ...DEFAULT_GLOW },
  glow: { ...DEFAULT_GLOW },
  contexts: {
    navLabels: { shadow: false, glow: false },
    pageTitles: { shadow: false, glow: false },
    gameTitles: { shadow: false, glow: false },
  },
}

export const normalizeTextEffects = (textEffects) => {
  const safe = textEffects && typeof textEffects === 'object' ? textEffects : {}
  const safeContexts = safe.contexts && typeof safe.contexts === 'object' ? safe.contexts : {}
  const contexts = {}
  for (const ctx of TEXT_EFFECT_CONTEXTS) {
    const safeCtx = safeContexts[ctx] && typeof safeContexts[ctx] === 'object' ? safeContexts[ctx] : {}
    contexts[ctx] = {
      shadow: safeCtx.shadow === true,
      glow: safeCtx.glow === true,
    }
  }
  return {
    shadow: normalizeEffectSpec(safe.shadow),
    glow: normalizeEffectSpec(safe.glow),
    contexts,
  }
}

export const DEFAULT_NAV = {
  layout: DEFAULT_LAYOUT,
  displayMode: DEFAULT_NAV_DISPLAY_MODE,
  accentBarEnabled: true,
  glow: { ...DEFAULT_GLOW },
  filterSidebar: { ...DEFAULT_FILTER_SIDEBAR },
}

/** Fills in any missing nav sub-fields (including nested glow/filterSidebar
 * fields) from DEFAULT_NAV, the same way normalizeTheme() does for the
 * rest of a theme. Used wherever an external/untrusted theme's `nav`
 * block is read. */
export const normalizeNav = (nav) => {
  const safeNav = nav && typeof nav === 'object' ? nav : {}
  const safeFilterSidebar = safeNav.filterSidebar && typeof safeNav.filterSidebar === 'object'
    ? safeNav.filterSidebar
    : {}
  return {
    ...DEFAULT_NAV,
    ...safeNav,
    layout: LAYOUT_OPTIONS.includes(safeNav.layout) ? safeNav.layout : DEFAULT_NAV.layout,
    displayMode: normalizeNavDisplayMode(safeNav.displayMode),
    accentBarEnabled: safeNav.accentBarEnabled !== false,
    glow: {
      ...DEFAULT_GLOW,
      ...(safeNav.glow && typeof safeNav.glow === 'object' ? safeNav.glow : {}),
    },
    filterSidebar: {
      side: normalizeFilterSidebarSide(safeFilterSidebar.side),
      mode: normalizeFilterSidebarMode(safeFilterSidebar.mode),
    },
  }
}

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
  nav: { ...DEFAULT_NAV },
  buttonEffects: { ...DEFAULT_BUTTON_EFFECTS },
  textEffects: { ...DEFAULT_TEXT_EFFECTS },
  // Whether the accent-colored border drawn around every window (see
  // src/components/ui/WindowBorderFrame.jsx) is shown at all. The
  // border's color is colors.windowBorder below, like any other theme
  // color — this is just the on/off switch, same pattern as
  // nav.accentBarEnabled.
  windowBorderEnabled: true,
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
    windowBorder:   '#2C8EA9', // matches `accent` by default; independently editable
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
    nav: normalizeNav(theme.nav),
    buttonEffects: normalizeButtonEffects(theme.buttonEffects),
    textEffects: normalizeTextEffects(theme.textEffects),
    windowBorderEnabled: theme.windowBorderEnabled !== false,
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
