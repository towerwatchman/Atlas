import { useState, useEffect, useMemo, useCallback } from 'react'
import { applyTheme } from '../../theme/applyTheme.js'
import { useTheme } from '../../theme/ThemeProvider.jsx'
import {
  THEME_COLOR_KEYS, GRADIENT_ELIGIBLE_KEYS, RADIUS_OPTIONS, WINDOW_RADIUS_OPTIONS,
  LAYOUT_OPTIONS, NAV_DISPLAY_MODE_OPTIONS,
  FILTER_SIDEBAR_SIDE_OPTIONS, FILTER_SIDEBAR_MODE_OPTIONS,
  TEXT_EFFECT_CONTEXTS, normalizeTheme,
} from '../../theme/themes.js'

// Human-readable labels for the color keys — shown next to each picker so
// a person doesn't have to guess what "overlayTop" or "dangerStrong" means
// from the camelCase key alone.
const COLOR_LABELS = {
  canvas: 'Canvas',
  shadow: 'Shadow',
  primary: 'Primary Surface',
  secondary: 'Secondary Surface',
  tertiary: 'Tertiary Surface',
  border: 'Border',
  selected: 'Selected',
  accent: 'Accent',
  accentBar: 'Accent Bar',
  atlasLogo: 'Logo',
  text: 'Text',
  highlight: 'Highlight',
  overlayTop: 'Overlay (Top)',
  overlayBottom: 'Overlay (Bottom)',
  muted: 'Muted Text',
  danger: 'Danger',
  dangerHover: 'Danger (Hover)',
  dangerStrong: 'Danger (Strong)',
  success: 'Success',
  successHover: 'Success (Hover)',
  warning: 'Warning',
  info: 'Info',
  buttonHover: 'Button (Hover)',
  accentHover: 'Accent (Hover)',
  button: 'Button',
  progressBackground: 'Progress Bar (Background)',
  progressForeground: 'Progress Bar (Foreground)',
  library: 'Library Background',
  windowBorder: 'Window Border',
  detailPlay: 'Detail · Play Button',
  detailPlayText: 'Detail · Play Button Text',
  detailLaunching: 'Detail · Launching State',
  detailRunning: 'Detail · Running State',
  detailAccent: 'Detail · Accent (Install/Update)',
  detailAccentText: 'Detail · Accent Text',
  detailWishlistAdd: 'Detail · Wishlist (Add)',
  detailWishlistRemove: 'Detail · Wishlist (Remove)',
  detailFavorite: 'Detail · Favorite',
}

// A short "what is this actually used for" note shown under each color's
// label in the builder, so a person doesn't have to reverse-engineer the
// name. Kept deliberately plain-language and concrete (which UI element it
// paints) rather than restating the key.
const COLOR_DESCRIPTIONS = {
  canvas: 'The outermost window background, behind every other surface.',
  shadow: 'Color used for drop shadows and depth around raised elements.',
  primary: 'Main content background — headers and primary panels.',
  secondary: 'Slightly raised surface — cards, inputs, and secondary panels.',
  tertiary: 'Nested surfaces — inputs, menus, dropdowns, and hover fills.',
  library: 'Background of the main library / banner-grid view specifically.',
  border: 'Default lines and dividers between elements.',
  selected: 'Background of a selected or active item (e.g. a highlighted row).',
  windowBorder: 'The accent border drawn around the outside of every window.',

  accent: 'Primary brand color — active states, links, focus rings, emphasis.',
  accentHover: 'Hover shade for accent-colored buttons.',
  accentBar: 'The decorative accent strip behind the logo in the header.',
  atlasLogo: 'The Atlas logo mark itself.',
  highlight: 'Hover/emphasis highlight for chips and links (matches accent by default).',

  text: 'Default body and label text throughout the app.',
  muted: 'Dimmed secondary text — captions, placeholders, minor labels.',

  overlayTop: 'Top of the dark gradient laid over cover art so text stays readable.',
  overlayBottom: 'Bottom of that same cover-art gradient.',

  danger: 'Destructive actions and errors — delete/remove buttons, error text.',
  dangerHover: 'Hover shade for danger buttons.',
  dangerStrong: 'The most severe, irreversible actions (e.g. delete files from disk).',
  success: 'Positive states — success messages and "installed" indicators.',
  successHover: 'Hover shade for success buttons.',
  warning: 'Cautions and warnings — warning text and highlights.',
  info: 'Informational text and icons.',

  button: 'Resting background of standard buttons.',
  buttonHover: 'Hover shade for standard buttons.',

  progressBackground: 'The unfilled track of a progress bar.',
  progressForeground: 'The filled portion of a progress bar.',

  detailPlay: 'Game detail page — the Play button when ready to launch.',
  detailPlayText: 'Game detail page — text/icon on the Play button.',
  detailLaunching: 'Game detail page — Play button while the game is launching.',
  detailRunning: 'Game detail page — Play button while the game is running.',
  detailAccent: 'Game detail page — Install/Update buttons and info highlights.',
  detailAccentText: 'Game detail page — text on those accent-colored buttons.',
  detailWishlistAdd: 'Game detail page — the "Add to Wishlist" button.',
  detailWishlistRemove: 'Game detail page — the "Remove from Wishlist" button.',
  detailFavorite: 'Game detail page — the favorite (heart/star) accent.',
}

// Colors grouped by what part of the app they affect, each with a one-line
// summary for the group. The builder renders these in order; any
// THEME_COLOR_KEYS not listed here still appear under a catch-all "Other"
// group (see the colors section render below), so adding a new key can
// never make it silently disappear from the builder.
const COLOR_GROUPS = [
  {
    label: 'Surfaces & Structure',
    blurb: 'The stacked background layers and the lines that separate them.',
    keys: ['canvas', 'primary', 'secondary', 'tertiary', 'library', 'border', 'selected', 'shadow', 'windowBorder'],
  },
  {
    label: 'Accent & Brand',
    blurb: 'Your highlight color and the branded bits of the header.',
    keys: ['accent', 'accentHover', 'accentBar', 'atlasLogo', 'highlight'],
  },
  {
    label: 'Text',
    blurb: 'The two text colors used almost everywhere.',
    keys: ['text', 'muted'],
  },
  {
    label: 'Cover-Art Overlay',
    blurb: 'The gradient drawn over banner/cover images to keep text legible.',
    keys: ['overlayTop', 'overlayBottom'],
  },
  {
    label: 'Buttons & Progress',
    blurb: 'Standard button backgrounds and progress-bar colors.',
    keys: ['button', 'buttonHover', 'progressBackground', 'progressForeground'],
  },
  {
    label: 'Status',
    blurb: 'Meaning-carrying colors: danger, success, warning, and info.',
    keys: ['danger', 'dangerHover', 'dangerStrong', 'success', 'successHover', 'warning', 'info'],
  },
  {
    label: 'Game Detail Page',
    blurb: 'The Steam-style detail page — Play/Install buttons, wishlist, and favorite.',
    keys: ['detailPlay', 'detailPlayText', 'detailLaunching', 'detailRunning', 'detailAccent', 'detailAccentText', 'detailWishlistAdd', 'detailWishlistRemove', 'detailFavorite'],
  },
]

const RADIUS_LABELS = { sm: 'Small', md: 'Medium', lg: 'Large', pill: 'Pill' }
const RADIUS_DESCRIPTIONS = {
  sm: 'Slightly rounded corners — close to square.',
  md: 'Moderately rounded corners, a balanced default.',
  lg: 'Noticeably rounded corners for a softer look.',
  pill: 'Fully rounded ends, like a capsule or pill shape.',
}

// Separate from RADIUS_LABELS/DESCRIPTIONS above — windows use their own
// smaller option set (see WINDOW_RADIUS_OPTIONS in themes.js): no 'pill'
// (a window-sized capsule curve eats deep into the window, not just the
// corner), plus 'none' since a window defaults to perfectly square.
const WINDOW_RADIUS_LABELS = { none: 'Off', sm: 'Small', md: 'Medium', lg: 'Large' }
const WINDOW_RADIUS_DESCRIPTIONS = {
  none: 'Plain square corners — the default.',
  sm: 'Slightly rounded corners — close to square.',
  md: 'Moderately rounded corners, a balanced default.',
  lg: 'Noticeably rounded corners for a softer look.',
}

const LAYOUT_LABELS = { sidebar: 'Sidebar', topnav: 'Top Bar' }
const LAYOUT_DESCRIPTIONS = {
  sidebar: 'Navigation icons run down the left edge of the window.',
  topnav: 'Navigation sits in a bar across the top of the window.',
}

const NAV_DISPLAY_LABELS = { icons: 'Icons Only', iconsAndText: 'Icons + Text', text: 'Text Only' }
const NAV_DISPLAY_DESCRIPTIONS = {
  icons: 'Nav buttons show only their icon — the most compact option.',
  iconsAndText: 'Nav buttons show both an icon and a label.',
  text: 'Nav buttons show only their text label, no icon.',
}

const FILTER_SIDE_LABELS = { left: 'Left', right: 'Right' }
const FILTER_SIDE_DESCRIPTIONS = {
  left: 'The Filters panel opens on the left edge of the library.',
  right: 'The Filters panel opens on the right edge of the library.',
}

const FILTER_MODE_LABELS = { overlay: 'Overlay', inline: 'Inline' }
const FILTER_MODE_DESCRIPTIONS = {
  overlay: 'Floats on top of the library grid without resizing it.',
  inline: 'Shares space with the library grid, which shrinks to fit.',
}

const TEXT_CONTEXT_LABELS = { navLabels: 'Nav Labels', pageTitles: 'Page Titles', gameTitles: 'Game Titles' }
const TEXT_CONTEXT_DESCRIPTIONS = {
  navLabels: 'Text labels on Sidebar/Top Bar nav buttons (Icons + Text or Text Only display modes).',
  pageTitles: 'The section heading shown next to the logo in Sidebar layout (e.g. "Games", "Wishlist").',
  gameTitles: 'Game names shown on grid banners and in the library list view.',
}

// Used only if the OS font query (window.electronAPI.getSystemFonts())
// returns nothing — e.g. font-list isn't installed yet (see the require
// in electron/ipc/themes.js) or the query fails for some reason. Every
// one of these is a generic CSS fallback family (not a specific font
// name), so this list is guaranteed to render SOMETHING reasonable on
// any OS, even with zero real font data available.
const FALLBACK_FONTS = ['sans-serif', 'serif', 'monospace', 'cursive']

// The font a draft falls back to if its chosen font isn't in the
// retrieved system list for some reason (e.g. a theme file authored on a
// different computer references a font this one doesn't have installed).
// 'sans-serif' is a CSS generic family — always available everywhere, on
// every OS, with no installation required.
const UNIVERSAL_DEFAULT_FONT = 'sans-serif'

// Small reusable color input: native <input type="color"> (a real OS/
// browser color picker) plus the raw hex text next to it for precise entry
// or copy-paste, kept in sync both ways.
const ColorField = ({ label, value, onChange }) => (
  <div className="flex items-center gap-2 py-1">
    <input
      type="color"
      value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'}
      onChange={(e) => onChange(e.target.value)}
      className="w-8 h-8 rounded bg-transparent cursor-pointer flex-shrink-0"
    />
    <span className="text-xs flex-1">{label}</span>
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-24 bg-secondary border border-border text-text text-xs rounded p-1 font-mono"
    />
  </div>
)

// One color key's full control: a Gradient toggle (only for
// GRADIENT_ELIGIBLE_KEYS) plus either a single ColorField (solid) or 2-3
// ColorFields for gradient stops + an angle slider.
const ColorKeyEditor = ({ themeKey, value, onChange, description }) => {
  const isEligible = GRADIENT_ELIGIBLE_KEYS.includes(themeKey)
  const isGradient = isEligible && value && typeof value === 'object'
  const stops = isGradient ? value.stops : [typeof value === 'string' ? value : '#000000']
  const angle = isGradient ? value.angle : 180

  const setSolid = (hex) => onChange(hex)
  const setGradientStop = (index, hex) => {
    const nextStops = [...stops]
    nextStops[index] = hex
    onChange({ type: 'linear', angle, stops: nextStops })
  }
  const setAngle = (nextAngle) => onChange({ type: 'linear', angle: nextAngle, stops })
  const toggleGradient = () => {
    if (isGradient) {
      onChange(stops[0] || '#000000')
    } else {
      onChange({ type: 'linear', angle: 180, stops: [stops[0] || '#000000', '#000000'] })
    }
  }
  const addStop = () => onChange({ type: 'linear', angle, stops: [...stops, '#000000'] })
  const removeStop = (index) => {
    if (stops.length <= 2) return
    onChange({ type: 'linear', angle, stops: stops.filter((_, i) => i !== index) })
  }

  return (
    <div className="border border-border rounded-cardTheme p-2 mb-1">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold">{COLOR_LABELS[themeKey] || themeKey}</span>
        {isEligible && (
          <label className="flex items-center gap-1 text-[10px] opacity-70 cursor-pointer">
            <input type="checkbox" checked={isGradient} onChange={toggleGradient} />
            Gradient
          </label>
        )}
      </div>
      {description && (
        <p className="text-[10px] opacity-55 leading-tight mb-1.5 -mt-0.5">{description}</p>
      )}
      {!isGradient ? (
        <ColorField label="Color" value={stops[0]} onChange={setSolid} />
      ) : (
        <>
          {stops.map((stop, index) => (
            <div key={index} className="flex items-center gap-1">
              <div className="flex-1">
                <ColorField label={`Stop ${index + 1}`} value={stop} onChange={(hex) => setGradientStop(index, hex)} />
              </div>
              {stops.length > 2 && (
                <button type="button" onClick={() => removeStop(index)} className="text-muted hover:text-danger text-xs px-1">
                  <i className="fas fa-times"></i>
                </button>
              )}
            </div>
          ))}
          <div className="flex items-center gap-2 mt-1">
            <button type="button" onClick={addStop} className="text-[10px] text-accent hover:underline">+ Add Stop</button>
            <span className="text-[10px] opacity-60 ml-auto">Angle</span>
            <input
              type="number"
              min="0"
              max="360"
              value={angle}
              onChange={(e) => setAngle(Number(e.target.value) || 0)}
              className="w-14 bg-secondary border border-border text-text text-xs rounded p-1"
            />
          </div>
        </>
      )}
    </div>
  )
}

// Shared editor for any { enabled, color, offsetX, offsetY, intensity }
// GlowSpec — used for nav glow, button shadow, button glow, text shadow,
// and text glow alike, so this one component covers all 5 effect configs
// in the builder.
const EffectSpecEditor = ({ label, spec, onChange, alwaysOnNote }) => (
  <div className="border border-border rounded-cardTheme p-3 mb-2">
    <div className="flex items-center justify-between mb-2">
      <span className="text-sm font-semibold">{label}</span>
      <label className="flex items-center gap-1 text-xs cursor-pointer">
        <input
          type="checkbox"
          checked={spec.enabled}
          onChange={(e) => onChange({ ...spec, enabled: e.target.checked })}
        />
        Enabled
      </label>
    </div>
    {alwaysOnNote && <p className="text-[10px] opacity-50 mb-2">{alwaysOnNote}</p>}
    {spec.enabled && (
      <div className="grid grid-cols-2 gap-2">
        <ColorField label="Color" value={spec.color} onChange={(hex) => onChange({ ...spec, color: hex })} />
        <div className="flex items-center gap-1" title="How far the glow/shadow spreads outward, in pixels. Higher = softer and wider.">
          <span className="text-xs flex-1">Intensity</span>
          <input
            type="number"
            min="0"
            max="60"
            value={spec.intensity}
            onChange={(e) => onChange({ ...spec, intensity: Number(e.target.value) || 0 })}
            className="w-16 bg-secondary border border-border text-text text-xs rounded p-1"
          />
        </div>
        <div className="flex items-center gap-1" title="Horizontal shift, in pixels. Positive moves right, negative moves left. 0 is centered.">
          <span className="text-xs flex-1">Offset X</span>
          <input
            type="number"
            value={spec.offsetX}
            onChange={(e) => onChange({ ...spec, offsetX: Number(e.target.value) || 0 })}
            className="w-16 bg-secondary border border-border text-text text-xs rounded p-1"
          />
        </div>
        <div className="flex items-center gap-1" title="Vertical shift, in pixels. Positive moves down, negative moves up. 0 is centered.">
          <span className="text-xs flex-1">Offset Y</span>
          <input
            type="number"
            value={spec.offsetY}
            onChange={(e) => onChange({ ...spec, offsetY: Number(e.target.value) || 0 })}
            className="w-16 bg-secondary border border-border text-text text-xs rounded p-1"
          />
        </div>
      </div>
    )}
  </div>
)

const SectionHeader = ({ children }) => (
  <h3 className="text-sm font-bold uppercase tracking-wide opacity-70 mt-5 mb-2 first:mt-0">{children}</h3>
)

// descriptions is optional — when provided, renders richer cards (label +
// short blurb) instead of bare pill buttons, matching the style
// Appearance.jsx's old Layout/Filter Mode pickers used.
const OptionPicker = ({ options, labels, descriptions, value, onChange }) => (
  <div className="flex gap-2 flex-wrap">
    {options.map((option) => (
      <button
        key={option}
        type="button"
        onClick={() => onChange(option)}
        title={descriptions?.[option]}
        className={`text-left rounded-cardTheme border-2 transition-colors ${descriptions ? 'p-2.5 min-w-[140px]' : 'text-xs px-3 py-1.5'} ${
          value === option ? 'border-accent bg-selected' : 'border-border bg-secondary hover:border-muted'
        }`}
      >
        <div className={descriptions ? 'flex items-center justify-between mb-0.5' : ''}>
          <span className={descriptions ? 'text-xs font-semibold' : 'text-xs'}>{labels[option] || option}</span>
          {descriptions && value === option && <span className="text-[10px] text-accent font-medium ml-2">Active</span>}
        </div>
        {descriptions?.[option] && (
          <p className="text-[10px] opacity-60 leading-tight">{descriptions[option]}</p>
        )}
      </button>
    ))}
  </div>
)

/**
 * Full theme authoring tool: every themeable property (colors, radius,
 * font, nav layout/display/accent-bar/filter-sidebar, nav glow, app-wide
 * button shadow/glow, text shadow/glow + per-context toggles) in one
 * place, with a LIVE PREVIEW that's visible APP-WIDE, not just in this
 * window — every draft change both re-applies locally (so the Theme
 * Builder window's own UI reflects it too) and broadcasts via
 * window.electronAPI.broadcastThemePreview(), which every other open
 * window (main library, Settings, etc.) picks up through its own
 * ThemeProvider's onThemePreviewChanged listener and applies the same
 * way. See electron/ipc/themes.js's broadcast-theme-preview handler.
 *
 * Rendered inside its OWN BrowserWindow (see createThemeBuilderWindow in
 * electron/main.js + ThemeBuilderWindow.jsx, which provides this
 * window's chrome) — not a view swap inside Appearance.jsx or a React
 * modal over Settings. Opened via the "Open Theme Builder" button on
 * Appearance.jsx, which calls window.electronAPI.openThemeBuilder().
 * However this window closes (the in-app Back button, titlebar, Alt+F4),
 * every other window's ThemeProvider receives a 'theme-preview-ended'
 * broadcast and reverts to whatever theme is actually persisted — the
 * live-preview changes made while in here are never persisted unless the
 * person explicitly clicks Save.
 */
const ThemeBuilder = ({ onClose }) => {
  const { theme: activeTheme, layout: activeLayout, isLoaded } = useTheme()
  const [draft, setDraft] = useState(null)
  const [themeName, setThemeName] = useState('')
  const [saveState, setSaveState] = useState({ status: 'idle', error: null })
  const [activeSection, setActiveSection] = useState('colors')
  // Fonts actually installed on THIS computer (see get-system-fonts in
  // electron/ipc/themes.js) — fetched once on mount. Falls back to
  // FALLBACK_FONTS (generic CSS families, always available everywhere)
  // if the query comes back empty, e.g. font-list isn't installed yet or
  // the OS query failed. This list is necessarily different from one
  // computer to another — that's the point: every option shown is
  // guaranteed to actually render correctly on whoever is running this
  // particular copy of Atlas.
  const [systemFonts, setSystemFonts] = useState(FALLBACK_FONTS)

  // ThemeProvider resolves the real persisted theme asynchronously — it
  // starts at DEFAULT_THEME until its own config fetch resolves (see
  // isLoaded in ThemeProvider.jsx). Seeding the draft synchronously on
  // mount (useState(() => normalizeTheme({...activeTheme,...}))) could
  // therefore capture that placeholder DEFAULT_THEME instead of whatever
  // theme was actually active, and since the live-preview effect below
  // broadcasts the draft to every other open window right away, that
  // meant opening the Theme Builder could visibly switch the WHOLE APP
  // to the Default theme. Wait for isLoaded, then seed the draft exactly
  // once — never again after that, so the person's own in-progress edits
  // are never clobbered by an unrelated theme change elsewhere.
  useEffect(() => {
    if (!isLoaded || draft !== null) return
    setDraft(normalizeTheme({
      ...activeTheme,
      id: undefined,
      name: `${activeTheme.name} Copy`,
    }))
    setThemeName(`${activeTheme.name} Copy`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded])

  useEffect(() => {
    let cancelled = false
    window.electronAPI.getSystemFonts?.()
      .then((fonts) => {
        if (cancelled) return
        if (Array.isArray(fonts) && fonts.length > 0) {
          setSystemFonts(fonts)
        }
        // else: leave the FALLBACK_FONTS default in place.
      })
      .catch((err) => {
        console.error('Failed to load system fonts:', err)
      })
    return () => { cancelled = true }
  }, [])

  // Live preview: every draft change re-applies immediately in THIS
  // window, exactly like picking a theme in Appearance.jsx does, AND
  // broadcasts the same draft to every OTHER open window (main library,
  // Settings, etc. — see electron/ipc/themes.js's broadcast-theme-preview
  // handler and each window's own 'theme-preview-changed' listener) so
  // the live preview is visible app-wide, not just inside this window.
  // layout/navDisplayMode/accentBarEnabled overrides intentionally mirror
  // the DRAFT's own nav block (not whatever the person's real Appearance
  // settings currently are), so the preview always reflects what's
  // actually in the draft — toggling "Top Bar" in here should immediately
  // show a topnav preview regardless of the user's normal saved layout
  // preference. Guarded against draft still being null (see above) — no
  // preview to broadcast until the real theme has actually loaded.
  useEffect(() => {
    if (!draft) return
    applyTheme(draft, draft.nav.layout, {
      navDisplayMode: draft.nav.displayMode,
      accentBarEnabled: draft.nav.accentBarEnabled,
    })
    window.electronAPI.broadcastThemePreview(draft)
  }, [draft])

  // Restore this window's own CSS state on unmount, right before the
  // window itself closes (Back button, titlebar, Alt+F4 all eventually
  // unmount this component) — mostly redundant with the window actually
  // disappearing a moment later, but cheap and avoids any flash of the
  // draft theme during that brief window-close transition.
  useEffect(() => {
    return () => {
      applyTheme(activeTheme, activeLayout)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateColor = useCallback((key, value) => {
    setDraft((prev) => ({ ...prev, colors: { ...prev.colors, [key]: value } }))
  }, [])

  const updateNav = useCallback((patch) => {
    setDraft((prev) => ({ ...prev, nav: { ...prev.nav, ...patch } }))
  }, [])

  const updateFilterSidebar = useCallback((patch) => {
    setDraft((prev) => ({ ...prev, nav: { ...prev.nav, filterSidebar: { ...prev.nav.filterSidebar, ...patch } } }))
  }, [])

  const updateButtonEffect = useCallback((effectKey, spec) => {
    setDraft((prev) => ({ ...prev, buttonEffects: { ...prev.buttonEffects, [effectKey]: spec } }))
  }, [])

  const updateTextEffect = useCallback((effectKey, spec) => {
    setDraft((prev) => ({ ...prev, textEffects: { ...prev.textEffects, [effectKey]: spec } }))
  }, [])

  const toggleTextContext = useCallback((context, effectKey, checked) => {
    setDraft((prev) => ({
      ...prev,
      textEffects: {
        ...prev.textEffects,
        contexts: {
          ...prev.textEffects.contexts,
          [context]: { ...prev.textEffects.contexts[context], [effectKey]: checked },
        },
      },
    }))
  }, [])

  const handleSave = async (overwrite = false) => {
    const name = themeName.trim()
    if (!name) {
      setSaveState({ status: 'error', error: 'Enter a theme name.' })
      return
    }
    setSaveState({ status: 'saving', error: null })
    try {
      const result = await window.electronAPI.saveTheme({ ...draft, name }, { overwrite })
      if (!result?.success) {
        if (result?.exists) {
          setSaveState({ status: 'confirm-overwrite', error: result.error })
          return
        }
        setSaveState({ status: 'error', error: result?.error || 'Failed to save theme.' })
        return
      }
      setSaveState({ status: 'saved', error: null })
    } catch (err) {
      setSaveState({ status: 'error', error: err.message })
    }
  }

  // Overwrites whichever theme was active when this window opened, by its
  // exact name (so it targets the same file — see save-theme's id-from-
  // filename scheme in electron/ipc/themes.js — no name-typing/collision
  // dance needed). Not offered for the built-in Default theme, which is a
  // code constant with no file to overwrite — see the activeTheme.id !==
  // 'default' check where this is rendered below.
  const handleSaveToCurrentTheme = async () => {
    setSaveState({ status: 'saving', error: null })
    try {
      const result = await window.electronAPI.saveTheme({ ...draft, name: activeTheme.name }, { overwrite: true })
      if (!result?.success) {
        setSaveState({ status: 'error', error: result?.error || 'Failed to save theme.' })
        return
      }
      setSaveState({ status: 'saved-current', error: null })
    } catch (err) {
      setSaveState({ status: 'error', error: err.message })
    }
  }

  const sections = useMemo(() => ([
    { id: 'colors', label: 'Colors', description: 'Every color used throughout the app, including gradients for the main surfaces.' },
    { id: 'general', label: 'Radius & Font', description: 'Button and card/panel corner roundedness (set independently), and the font family used everywhere.' },
    { id: 'nav', label: 'Navigation', description: 'Navigation position/display, the accent bar, filter sidebar placement, and nav button glow.' },
    { id: 'buttonEffects', label: 'Button Effects', description: 'Shadow and glow effects applied to every button in the app.' },
    { id: 'textEffects', label: 'Text Effects', description: 'Shadow and glow effects for nav labels, page titles, and game titles.' },
  ]), [])

  if (!draft) {
    return (
      <div className="-webkit-app-region-no-drag text-sm text-muted p-4">
        Loading current theme…
      </div>
    )
  }

  return (
    <div className="-webkit-app-region-no-drag flex flex-col flex-1 min-h-0">
      {/* Fixed header: back button, save controls, status messages, and
          the section tabs all stay pinned here and never scroll — only
          the actual settings content below (per-section colors, radius
          pickers, etc.) scrolls. Previously this entire block lived
          inside the same scrollable container as the content, so it
          scrolled out of view along with everything else. */}
      <div className="flex-shrink-0 px-4 pt-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="btn-shadow btn-glow text-text hover:text-accent text-sm px-2 py-1">
              <i className="fas fa-arrow-left mr-1"></i>Back to Appearance
            </button>
          </div>
          <div className="flex items-center gap-2">
            {activeTheme.id !== 'default' && saveState.status !== 'confirm-overwrite' && (
              <button
                type="button"
                onClick={handleSaveToCurrentTheme}
                disabled={saveState.status === 'saving'}
                className="btn-shadow btn-glow text-sm bg-accent text-white px-3 py-1.5 rounded-buttonTheme hover:bg-accentHover disabled:opacity-50"
                title={`Overwrites "${activeTheme.name}" with these changes`}
              >
                {saveState.status === 'saving' ? 'Saving…' : `Save Changes to "${activeTheme.name}"`}
              </button>
            )}
            <input
              type="text"
              value={themeName}
              onChange={(e) => { setThemeName(e.target.value); setSaveState({ status: 'idle', error: null }) }}
              placeholder="Theme name"
              className="bg-secondary border border-border text-text text-sm rounded p-1.5 w-48"
            />
            {saveState.status === 'confirm-overwrite' ? (
              <>
                <span className="text-xs text-warning">Already exists —</span>
                <button type="button" onClick={() => handleSave(true)} className="btn-shadow btn-glow text-sm bg-danger text-white px-3 py-1.5 rounded-buttonTheme">
                  Overwrite
                </button>
                <button type="button" onClick={() => setSaveState({ status: 'idle', error: null })} className="text-xs text-muted hover:text-text">
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => handleSave(false)}
                disabled={saveState.status === 'saving'}
                className="btn-shadow btn-glow text-sm bg-button text-text px-3 py-1.5 rounded-buttonTheme hover:bg-buttonHover disabled:opacity-50"
              >
                {saveState.status === 'saving' ? 'Saving…' : 'Save as New Theme'}
              </button>
            )}
          </div>
        </div>
        {saveState.status === 'saved-current' && (
          <p className="text-xs text-success mb-2">
            Saved! "{activeTheme.name}" has been updated with these changes.
          </p>
        )}
        {saveState.status === 'saved' && (
          <p className="text-xs text-success mb-2">
            Saved! "{themeName.trim()}" is now available in the Appearance theme picker.
          </p>
        )}
        {saveState.status === 'error' && (
          <p className="text-xs text-danger mb-2">{saveState.error}</p>
        )}

        <div className="flex gap-2 border-b border-border">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => setActiveSection(section.id)}
              title={section.description}
              className={`text-xs px-3 py-2 border-b-2 transition-colors -mb-px ${
                activeSection === section.id ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-text'
              }`}
            >
              {section.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-4">
        {activeSection === 'colors' && (
          <div>
            <p className="text-[10px] opacity-50 mb-2">
              Every color in the app, grouped by where it's used, with a note on
              each. Most are flat colors; the main surfaces (Canvas, Primary,
              Secondary, Tertiary Surface, Library) can also be set as a gradient
              using the "Gradient" checkbox on each. Changes preview live everywhere.
            </p>
            <div className="border border-border rounded-cardTheme p-2 mb-2">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="text-xs font-semibold block">Window Border</span>
                  <span className="text-[10px] opacity-60">The accent-colored border drawn around every Atlas window. Uses the "Window Border" color below.</span>
                </div>
                <label className="flex items-center gap-1 text-xs cursor-pointer flex-shrink-0 ml-2">
                  <input
                    type="checkbox"
                    checked={draft.windowBorderEnabled}
                    onChange={(e) => setDraft((prev) => ({ ...prev, windowBorderEnabled: e.target.checked }))}
                  />
                  Enabled
                </label>
              </div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] opacity-60 max-w-[70%]">
                  Keep every other window's border, but hide it on just the
                  main library window.
                </span>
                <label className="flex items-center gap-1 text-xs cursor-pointer flex-shrink-0 ml-2">
                  <input
                    type="checkbox"
                    checked={draft.windowBorderHideOnMain}
                    onChange={(e) => setDraft((prev) => ({ ...prev, windowBorderHideOnMain: e.target.checked }))}
                  />
                  Hide on main window
                </label>
              </div>
              <span className="text-[10px] opacity-60 block mb-1">
                How rounded every window's corners are — applies even with the
                border above turned off, since the corners themselves always
                follow this.
              </span>
              <OptionPicker
                options={WINDOW_RADIUS_OPTIONS}
                labels={WINDOW_RADIUS_LABELS}
                descriptions={WINDOW_RADIUS_DESCRIPTIONS}
                value={draft.windowBorderRadius}
                onChange={(windowBorderRadius) => setDraft((prev) => ({ ...prev, windowBorderRadius }))}
              />
            </div>
            {COLOR_GROUPS.map((group) => {
              const keys = group.keys.filter((k) => THEME_COLOR_KEYS.includes(k))
              if (keys.length === 0) return null
              return (
                <div key={group.label} className="mb-4">
                  <SectionHeader>{group.label}</SectionHeader>
                  {group.blurb && <p className="text-[10px] opacity-50 mb-2 -mt-1">{group.blurb}</p>}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {keys.map((key) => (
                      <ColorKeyEditor
                        key={key}
                        themeKey={key}
                        value={draft.colors[key]}
                        onChange={(value) => updateColor(key, value)}
                        description={COLOR_DESCRIPTIONS[key]}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
            {/* Catch-all: any THEME_COLOR_KEYS not placed in a group above still
                shows here, so adding a new color key can never make it silently
                vanish from the builder. */}
            {(() => {
              const grouped = new Set(COLOR_GROUPS.flatMap((g) => g.keys))
              const leftovers = THEME_COLOR_KEYS.filter((k) => !grouped.has(k))
              if (leftovers.length === 0) return null
              return (
                <div className="mb-4">
                  <SectionHeader>Other</SectionHeader>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {leftovers.map((key) => (
                      <ColorKeyEditor
                        key={key}
                        themeKey={key}
                        value={draft.colors[key]}
                        onChange={(value) => updateColor(key, value)}
                        description={COLOR_DESCRIPTIONS[key]}
                      />
                    ))}
                  </div>
                </div>
              )
            })()}
          </div>
        )}

        {activeSection === 'general' && (
          <div>
            <SectionHeader>Button Radius</SectionHeader>
            <p className="text-[10px] opacity-50 mb-2">How rounded buttons are throughout the app.</p>
            <OptionPicker
              options={RADIUS_OPTIONS}
              labels={RADIUS_LABELS}
              descriptions={RADIUS_DESCRIPTIONS}
              value={draft.buttonRadius}
              onChange={(buttonRadius) => setDraft((prev) => ({ ...prev, buttonRadius }))}
            />

            <SectionHeader>Card & Panel Radius</SectionHeader>
            <p className="text-[10px] opacity-50 mb-2">How rounded cards and panels are — independent from button radius above.</p>
            <OptionPicker
              options={RADIUS_OPTIONS}
              labels={RADIUS_LABELS}
              descriptions={RADIUS_DESCRIPTIONS}
              value={draft.cardRadius}
              onChange={(cardRadius) => setDraft((prev) => ({ ...prev, cardRadius }))}
            />

            <SectionHeader>Font</SectionHeader>
            <p className="text-[10px] opacity-50 mb-2">
              The font family used for all text in the app. This list shows fonts
              actually installed on this computer — picking one always appends a
              generic fallback (sans-serif) so text still renders even if this theme
              is later opened on a different machine that doesn't have that font.
            </p>
            <select
              value={draft.font.split(',')[0].replace(/"/g, '').trim()}
              onChange={(e) => {
                const fontName = e.target.value
                const isGeneric = FALLBACK_FONTS.includes(fontName)
                setDraft((prev) => ({
                  ...prev,
                  font: isGeneric ? fontName : `"${fontName}", ${UNIVERSAL_DEFAULT_FONT}`,
                }))
              }}
              className="w-full bg-secondary border border-border text-text text-sm rounded p-2"
            >
              {!systemFonts.includes(draft.font.split(',')[0].replace(/"/g, '').trim()) && (
                <option value={draft.font.split(',')[0].replace(/"/g, '').trim()}>
                  {draft.font.split(',')[0].replace(/"/g, '').trim()} (current — not in this list)
                </option>
              )}
              {systemFonts.map((font) => (
                <option key={font} value={font} style={{ fontFamily: font }}>{font}</option>
              ))}
            </select>
            <p className="text-[10px] opacity-50 mt-2 mb-1">
              Or paste a custom CSS font-family value directly (for an exact stack, web font, etc.):
            </p>
            <input
              type="text"
              value={draft.font}
              onChange={(e) => setDraft((prev) => ({ ...prev, font: e.target.value }))}
              className="w-full bg-secondary border border-border text-text text-xs rounded p-2 font-mono"
              placeholder="Custom font-family CSS value"
            />
          </div>
        )}

        {activeSection === 'nav' && (
          <div>
            <SectionHeader>Navigation Position</SectionHeader>
            <p className="text-[10px] opacity-50 mb-2">Where the app's main navigation buttons (Library, Import, Settings, etc.) are positioned.</p>
            <OptionPicker options={LAYOUT_OPTIONS} labels={LAYOUT_LABELS} descriptions={LAYOUT_DESCRIPTIONS} value={draft.nav.layout} onChange={(layout) => updateNav({ layout })} />

            <SectionHeader>Navigation Display</SectionHeader>
            <p className="text-[10px] opacity-50 mb-2">How each navigation button presents itself — icon, text, or both.</p>
            <OptionPicker options={NAV_DISPLAY_MODE_OPTIONS} labels={NAV_DISPLAY_LABELS} descriptions={NAV_DISPLAY_DESCRIPTIONS} value={draft.nav.displayMode} onChange={(displayMode) => updateNav({ displayMode })} />

            <SectionHeader>Accent Bar</SectionHeader>
            <p className="text-[10px] opacity-50 mb-2">A decorative accent-colored notch behind the logo at the top of the window. Purely cosmetic — safe to turn off for a flatter header.</p>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={draft.nav.accentBarEnabled} onChange={(e) => updateNav({ accentBarEnabled: e.target.checked })} />
              Show the accent-colored strip behind the logo
            </label>

            <SectionHeader>Filter Sidebar Side</SectionHeader>
            <p className="text-[10px] opacity-50 mb-2">Which edge of the window the Filters panel (search/sort/filter controls) opens on.</p>
            <OptionPicker options={FILTER_SIDEBAR_SIDE_OPTIONS} labels={FILTER_SIDE_LABELS} descriptions={FILTER_SIDE_DESCRIPTIONS} value={draft.nav.filterSidebar.side} onChange={(side) => updateFilterSidebar({ side })} />

            <SectionHeader>Filter Sidebar Mode</SectionHeader>
            <p className="text-[10px] opacity-50 mb-2">Whether the Filters panel floats over the library grid or shares space with it.</p>
            <OptionPicker options={FILTER_SIDEBAR_MODE_OPTIONS} labels={FILTER_MODE_LABELS} descriptions={FILTER_MODE_DESCRIPTIONS} value={draft.nav.filterSidebar.mode} onChange={(mode) => updateFilterSidebar({ mode })} />

            <SectionHeader>Nav Button Glow</SectionHeader>
            <p className="text-[10px] opacity-50 mb-2">A colored glow effect. Only ever shown on the Top Bar's active/selected button — never the Sidebar, and never a permanent effect (it disappears when nothing is selected).</p>
            <EffectSpecEditor label="Nav Glow" spec={draft.nav.glow} onChange={(glow) => updateNav({ glow })} />
          </div>
        )}

        {activeSection === 'buttonEffects' && (
          <div>
            <p className="text-[10px] opacity-50 mb-2">
              These effects apply to every button in the app — Settings, dialogs, the
              filter sidebar, and more — not just navigation buttons (which have their
              own separate glow setting on the Navigation tab).
            </p>
            <SectionHeader>Button Shadow</SectionHeader>
            <EffectSpecEditor
              label="Shadow"
              spec={draft.buttonEffects.shadow}
              onChange={(shadow) => updateButtonEffect('shadow', shadow)}
              alwaysOnNote="A drop shadow shown permanently on every button in the app whenever enabled — it doesn't depend on hover, focus, or selection."
            />

            <SectionHeader>Button Glow</SectionHeader>
            <EffectSpecEditor
              label="Glow"
              spec={draft.buttonEffects.glow}
              onChange={(glow) => updateButtonEffect('glow', glow)}
              alwaysOnNote="A colored glow shown on every button in the app, but only while hovered, focused, or marked active — it disappears the rest of the time, never a permanent effect."
            />
          </div>
        )}

        {activeSection === 'textEffects' && (
          <div>
            <p className="text-[10px] opacity-50 mb-2">
              One shared shadow style and one shared glow style for text — turn each on
              for whichever contexts (below) you want it to affect. Useful for making
              navigation labels or game titles stand out against busy backgrounds.
            </p>
            <SectionHeader>Text Shadow</SectionHeader>
            <EffectSpecEditor
              label="Shadow"
              spec={draft.textEffects.shadow}
              onChange={(shadow) => updateTextEffect('shadow', shadow)}
              alwaysOnNote="Shown permanently (whenever a context below has Shadow checked) — it doesn't depend on hover or selection."
            />

            <SectionHeader>Text Glow</SectionHeader>
            <EffectSpecEditor
              label="Glow"
              spec={draft.textEffects.glow}
              onChange={(glow) => updateTextEffect('glow', glow)}
              alwaysOnNote="Only shown while hovered or selected (for any context below with Glow checked) — never a permanent effect."
            />

            <SectionHeader>Apply To</SectionHeader>
            <p className="text-[10px] opacity-50 mb-2">Check Shadow and/or Glow independently for each text context below.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {TEXT_EFFECT_CONTEXTS.map((context) => (
                <div key={context} className="border border-border rounded-cardTheme p-2">
                  <p className="text-xs font-semibold mb-0.5">{TEXT_CONTEXT_LABELS[context] || context}</p>
                  <p className="text-[10px] opacity-60 mb-1.5 leading-tight">{TEXT_CONTEXT_DESCRIPTIONS[context]}</p>
                  <label className="flex items-center gap-1 text-[11px] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.textEffects.contexts[context].shadow}
                      onChange={(e) => toggleTextContext(context, 'shadow', e.target.checked)}
                    />
                    Shadow
                  </label>
                  <label className="flex items-center gap-1 text-[11px] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.textEffects.contexts[context].glow}
                      onChange={(e) => toggleTextContext(context, 'glow', e.target.checked)}
                    />
                    Glow
                  </label>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ThemeBuilder
