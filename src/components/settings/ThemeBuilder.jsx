import { useState, useEffect, useMemo, useCallback } from 'react'
import { applyTheme } from '../../theme/applyTheme.js'
import { useTheme } from '../../theme/ThemeProvider.jsx'
import {
  THEME_COLOR_KEYS, GRADIENT_ELIGIBLE_KEYS, RADIUS_OPTIONS,
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
}

const RADIUS_LABELS = { sm: 'Small', md: 'Medium', lg: 'Large', pill: 'Pill' }
const RADIUS_DESCRIPTIONS = {
  sm: 'Slightly rounded corners — close to square.',
  md: 'Moderately rounded corners, a balanced default.',
  lg: 'Noticeably rounded corners for a softer look.',
  pill: 'Fully rounded ends, like a capsule or pill shape.',
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
  pageTitles: 'The section heading shown next to the logo in Sidebar layout (e.g. "Library", "Browse").',
  gameTitles: 'Game names shown on grid banners and in the library list view.',
}

const FONT_PRESETS = [
  '"Inter", "Segoe UI", ui-sans-serif, system-ui, sans-serif',
  '"Roboto", ui-sans-serif, system-ui, sans-serif',
  '"Georgia", "Times New Roman", serif',
  '"JetBrains Mono", "Fira Code", monospace',
  '"Poppins", ui-sans-serif, system-ui, sans-serif',
]

// Small reusable color input: native <input type="color"> (a real OS/
// browser color picker) plus the raw hex text next to it for precise entry
// or copy-paste, kept in sync both ways.
const ColorField = ({ label, value, onChange }) => (
  <div className="flex items-center gap-2 py-1">
    <input
      type="color"
      value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'}
      onChange={(e) => onChange(e.target.value)}
      className="w-8 h-8 rounded border border-border bg-transparent cursor-pointer flex-shrink-0"
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
const ColorKeyEditor = ({ themeKey, value, onChange }) => {
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
    <div className="border border-border rounded-theme p-2 mb-1">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold">{COLOR_LABELS[themeKey] || themeKey}</span>
        {isEligible && (
          <label className="flex items-center gap-1 text-[10px] opacity-70 cursor-pointer">
            <input type="checkbox" checked={isGradient} onChange={toggleGradient} />
            Gradient
          </label>
        )}
      </div>
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
  <div className="border border-border rounded-theme p-3 mb-2">
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
        className={`text-left rounded-theme border-2 transition-colors ${descriptions ? 'p-2.5 min-w-[140px]' : 'text-xs px-3 py-1.5'} ${
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
  const { theme: activeTheme, layout: activeLayout } = useTheme()
  const [draft, setDraft] = useState(() => normalizeTheme({
    ...activeTheme,
    id: undefined,
    name: `${activeTheme.name} Copy`,
  }))
  const [themeName, setThemeName] = useState(`${activeTheme.name} Copy`)
  const [saveState, setSaveState] = useState({ status: 'idle', error: null })
  const [activeSection, setActiveSection] = useState('colors')

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
  // preference.
  useEffect(() => {
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

  const sections = useMemo(() => ([
    { id: 'colors', label: 'Colors', description: 'Every color used throughout the app, including gradients for the main surfaces.' },
    { id: 'general', label: 'Radius & Font', description: 'Corner roundedness and the font family used everywhere.' },
    { id: 'nav', label: 'Navigation', description: 'Navigation position/display, the accent bar, filter sidebar placement, and nav button glow.' },
    { id: 'buttonEffects', label: 'Button Effects', description: 'Shadow and glow effects applied to every button in the app.' },
    { id: 'textEffects', label: 'Text Effects', description: 'Shadow and glow effects for nav labels, page titles, and game titles.' },
  ]), [])

  return (
    <div className="-webkit-app-region-no-drag">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onClose} className="btn-shadow btn-glow text-text hover:text-accent text-sm px-2 py-1">
            <i className="fas fa-arrow-left mr-1"></i>Back to Appearance
          </button>
        </div>
        <div className="flex items-center gap-2">
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
              <button type="button" onClick={() => handleSave(true)} className="btn-shadow btn-glow text-sm bg-danger text-white px-3 py-1.5 rounded-theme">
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
              className="btn-shadow btn-glow text-sm bg-accent text-white px-3 py-1.5 rounded-theme hover:bg-accentHover disabled:opacity-50"
            >
              {saveState.status === 'saving' ? 'Saving…' : 'Save as New Theme'}
            </button>
          )}
        </div>
      </div>
      {saveState.status === 'saved' && (
        <p className="text-xs text-success mb-2">
          Saved! "{themeName.trim()}" is now available in the Appearance theme picker.
        </p>
      )}
      {saveState.status === 'error' && (
        <p className="text-xs text-danger mb-2">{saveState.error}</p>
      )}

      <div className="flex gap-2 mb-3 border-b border-border sticky top-0 bg-secondary z-10 pt-1">
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

      <div>
        {activeSection === 'colors' && (
          <div>
            <p className="text-[10px] opacity-50 mb-2">
              Every color used throughout the app. Most are flat colors; the 4 main
              surfaces (Canvas, Primary, Secondary, Tertiary Surface) can also be set
              as a gradient using the "Gradient" checkbox on each.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {THEME_COLOR_KEYS.map((key) => (
                <ColorKeyEditor
                  key={key}
                  themeKey={key}
                  value={draft.colors[key]}
                  onChange={(value) => updateColor(key, value)}
                />
              ))}
            </div>
          </div>
        )}

        {activeSection === 'general' && (
          <div>
            <SectionHeader>Corner Radius</SectionHeader>
            <p className="text-[10px] opacity-50 mb-2">How rounded buttons, cards, and panels are throughout the app.</p>
            <OptionPicker
              options={RADIUS_OPTIONS}
              labels={RADIUS_LABELS}
              descriptions={RADIUS_DESCRIPTIONS}
              value={draft.radius}
              onChange={(radius) => setDraft((prev) => ({ ...prev, radius }))}
            />

            <SectionHeader>Font</SectionHeader>
            <p className="text-[10px] opacity-50 mb-2">The font family used for all text in the app. Pick a preset or paste a custom CSS font-family value below.</p>
            <select
              value={draft.font}
              onChange={(e) => setDraft((prev) => ({ ...prev, font: e.target.value }))}
              className="w-full bg-secondary border border-border text-text text-sm rounded p-2"
            >
              {FONT_PRESETS.map((font) => (
                <option key={font} value={font} style={{ fontFamily: font }}>{font.split(',')[0].replace(/"/g, '')}</option>
              ))}
              {!FONT_PRESETS.includes(draft.font) && (
                <option value={draft.font}>{draft.font.split(',')[0].replace(/"/g, '')} (current)</option>
              )}
            </select>
            <input
              type="text"
              value={draft.font}
              onChange={(e) => setDraft((prev) => ({ ...prev, font: e.target.value }))}
              className="w-full mt-2 bg-secondary border border-border text-text text-xs rounded p-2 font-mono"
              placeholder="Custom font-family CSS value"
            />
          </div>
        )}

        {activeSection === 'nav' && (
          <div>
            <SectionHeader>Navigation Position</SectionHeader>
            <p className="text-[10px] opacity-50 mb-2">Where the app's main navigation buttons (Library, Browse, Settings, etc.) are positioned.</p>
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
                <div key={context} className="border border-border rounded-theme p-2">
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
