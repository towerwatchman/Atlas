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
const LAYOUT_LABELS = { sidebar: 'Sidebar', topnav: 'Top Bar' }
const NAV_DISPLAY_LABELS = { icons: 'Icons Only', iconsAndText: 'Icons + Text', text: 'Text Only' }
const FILTER_SIDE_LABELS = { left: 'Left', right: 'Right' }
const FILTER_MODE_LABELS = { overlay: 'Overlay', inline: 'Inline' }
const TEXT_CONTEXT_LABELS = { navLabels: 'Nav Labels', pageTitles: 'Page Titles', gameTitles: 'Game Titles' }

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
        <div className="flex items-center gap-1">
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
        <div className="flex items-center gap-1">
          <span className="text-xs flex-1">Offset X</span>
          <input
            type="number"
            value={spec.offsetX}
            onChange={(e) => onChange({ ...spec, offsetX: Number(e.target.value) || 0 })}
            className="w-16 bg-secondary border border-border text-text text-xs rounded p-1"
          />
        </div>
        <div className="flex items-center gap-1">
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

const OptionPicker = ({ options, labels, value, onChange }) => (
  <div className="flex gap-2 flex-wrap">
    {options.map((option) => (
      <button
        key={option}
        type="button"
        onClick={() => onChange(option)}
        className={`text-xs px-3 py-1.5 rounded-theme border-2 transition-colors ${
          value === option ? 'border-accent bg-selected' : 'border-border bg-secondary hover:border-muted'
        }`}
      >
        {labels[option] || option}
      </button>
    ))}
  </div>
)

/**
 * Full theme authoring tool: every themeable property (colors, radius,
 * font, nav layout/display/accent-bar/filter-sidebar, nav glow, app-wide
 * button shadow/glow, text shadow/glow + per-context toggles) in one
 * place, with a live preview — every change calls applyTheme() against
 * the draft immediately, so the whole running app visibly updates as you
 * adjust sliders/pickers, the same way picking a different theme in the
 * regular Appearance picker does.
 *
 * Opened via the "Open Theme Builder" button on Appearance.jsx; closing
 * it (Cancel, or after a successful Save) restores whatever theme was
 * actually active before the builder opened, via the cleanup effect
 * below — the live-preview changes made while in here are never
 * persisted unless the person explicitly clicks Save.
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

  // Live preview: every draft change re-applies immediately, exactly like
  // picking a theme in Appearance.jsx does. layout/navDisplayMode/
  // accentBarEnabled overrides intentionally mirror the DRAFT's own nav
  // block (not whatever the person's real Appearance settings currently
  // are), so the preview always reflects what's actually in the draft —
  // toggling "Top Bar" in here should immediately show a topnav preview
  // regardless of the user's normal saved layout preference.
  useEffect(() => {
    applyTheme(draft, draft.nav.layout, {
      navDisplayMode: draft.nav.displayMode,
      accentBarEnabled: draft.nav.accentBarEnabled,
    })
  }, [draft])

  // Restore the actually-active theme/layout on unmount (Cancel, Save-then-
  // close, or navigating away some other way) so the live preview never
  // leaks into the rest of the app after leaving the builder.
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
    { id: 'colors', label: 'Colors' },
    { id: 'general', label: 'Radius & Font' },
    { id: 'nav', label: 'Navigation' },
    { id: 'buttonEffects', label: 'Button Effects' },
    { id: 'textEffects', label: 'Text Effects' },
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
        )}

        {activeSection === 'general' && (
          <div>
            <SectionHeader>Corner Radius</SectionHeader>
            <OptionPicker
              options={RADIUS_OPTIONS}
              labels={RADIUS_LABELS}
              value={draft.radius}
              onChange={(radius) => setDraft((prev) => ({ ...prev, radius }))}
            />

            <SectionHeader>Font</SectionHeader>
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
            <OptionPicker options={LAYOUT_OPTIONS} labels={LAYOUT_LABELS} value={draft.nav.layout} onChange={(layout) => updateNav({ layout })} />

            <SectionHeader>Navigation Display</SectionHeader>
            <OptionPicker options={NAV_DISPLAY_MODE_OPTIONS} labels={NAV_DISPLAY_LABELS} value={draft.nav.displayMode} onChange={(displayMode) => updateNav({ displayMode })} />

            <SectionHeader>Accent Bar</SectionHeader>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={draft.nav.accentBarEnabled} onChange={(e) => updateNav({ accentBarEnabled: e.target.checked })} />
              Show the accent-colored strip behind the logo
            </label>

            <SectionHeader>Filter Sidebar Side</SectionHeader>
            <OptionPicker options={FILTER_SIDEBAR_SIDE_OPTIONS} labels={FILTER_SIDE_LABELS} value={draft.nav.filterSidebar.side} onChange={(side) => updateFilterSidebar({ side })} />

            <SectionHeader>Filter Sidebar Mode</SectionHeader>
            <OptionPicker options={FILTER_SIDEBAR_MODE_OPTIONS} labels={FILTER_MODE_LABELS} value={draft.nav.filterSidebar.mode} onChange={(mode) => updateFilterSidebar({ mode })} />

            <SectionHeader>Nav Button Glow</SectionHeader>
            <p className="text-[10px] opacity-50 mb-2">Only ever shown on the Top Bar's active/selected button — never the Sidebar, never a permanent effect.</p>
            <EffectSpecEditor label="Nav Glow" spec={draft.nav.glow} onChange={(glow) => updateNav({ glow })} />
          </div>
        )}

        {activeSection === 'buttonEffects' && (
          <div>
            <SectionHeader>Button Shadow</SectionHeader>
            <EffectSpecEditor
              label="Shadow"
              spec={draft.buttonEffects.shadow}
              onChange={(shadow) => updateButtonEffect('shadow', shadow)}
              alwaysOnNote="Applies to every button in the app, permanently, whenever enabled."
            />

            <SectionHeader>Button Glow</SectionHeader>
            <EffectSpecEditor
              label="Glow"
              spec={draft.buttonEffects.glow}
              onChange={(glow) => updateButtonEffect('glow', glow)}
              alwaysOnNote="Applies to every button in the app, but only on hover, focus, or active state — never a permanent effect."
            />
          </div>
        )}

        {activeSection === 'textEffects' && (
          <div>
            <SectionHeader>Text Shadow</SectionHeader>
            <EffectSpecEditor
              label="Shadow"
              spec={draft.textEffects.shadow}
              onChange={(shadow) => updateTextEffect('shadow', shadow)}
              alwaysOnNote="Permanent whenever enabled, for any context checked below."
            />

            <SectionHeader>Text Glow</SectionHeader>
            <EffectSpecEditor
              label="Glow"
              spec={draft.textEffects.glow}
              onChange={(glow) => updateTextEffect('glow', glow)}
              alwaysOnNote="Only shown on hover or selection, for any context checked below — never a permanent effect."
            />

            <SectionHeader>Apply To</SectionHeader>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {TEXT_EFFECT_CONTEXTS.map((context) => (
                <div key={context} className="border border-border rounded-theme p-2">
                  <p className="text-xs font-semibold mb-1">{TEXT_CONTEXT_LABELS[context] || context}</p>
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
