import { useState, useEffect } from 'react'
import { useTheme } from '../../theme/ThemeProvider.jsx'
import { GRADIENT_ELIGIBLE_KEYS, resolveColorValue } from '../../theme/themes.js'
import { getBuiltInBannerLayoutOptions } from '../library/bannerLayout/defaultBannerLayouts.js'
import { normalizeBannerLayoutId } from '../library/bannerLayout/bannerLayoutSchema.js'

// A handful of each theme's colors, shown as small swatches on its picker
// card so people can tell themes apart at a glance rather than reading
// names off a dropdown.
const SWATCH_KEYS = ['primary', 'tertiary', 'accent', 'text']

// Turns a theme color value (flat hex OR a gradient object, see
// GRADIENT_ELIGIBLE_KEYS in themes.js) into a CSS `background` value for
// inline style props. Using the `background` shorthand rather than
// `backgroundColor` here on purpose: a gradient resolves to a
// background-image string (e.g. 'linear-gradient(...)'), which
// backgroundColor can't hold, while `background` accepts either a plain
// color or a gradient. For a non-eligible key (accent, text, etc.) this
// is always just the flat hex passed straight through.
const backgroundStyleFor = (key, value) => {
  const { solid, gradient } = resolveColorValue(key, value)
  return GRADIENT_ELIGIBLE_KEYS.includes(key) && gradient !== 'none' ? gradient : solid
}

const ThemeSwatchCard = ({ theme, isActive, onSelect }) => (
  <button
    type="button"
    onClick={() => onSelect(theme)}
    className={`text-left rounded-theme border-2 p-3 transition-colors ${
      isActive ? 'border-accent' : 'border-border hover:border-muted'
    }`}
    style={{ background: backgroundStyleFor('secondary', theme.colors.secondary) }}
  >
    <div className="flex gap-1 mb-3">
      {SWATCH_KEYS.map((key) => (
        <span
          key={key}
          className="block w-6 h-6 rounded-themeSm border border-border"
          style={{ background: backgroundStyleFor(key, theme.colors[key]) }}
        />
      ))}
    </div>
    <div className="flex items-center justify-between">
      <span className="text-sm font-semibold" style={{ color: resolveColorValue('text', theme.colors.text).solid }}>
        {theme.name}
      </span>
      {isActive && (
        <span className="text-xs text-accent font-medium">Active</span>
      )}
    </div>
  </button>
)

const Appearance = () => {
  // Navigation position/display, accent bar, and filter sidebar side/mode
  // USED to be quick standalone overrides here, independent of the active
  // theme. They're now theme-only settings — exclusively authored in the
  // Theme Builder as part of a theme's nav block — so this page only
  // needs theme + setTheme + availableThemes, not the individual
  // nav-setting state/setters those old sections used.
  //
  // Theme Builder itself is a genuinely separate BrowserWindow (see
  // createThemeBuilderWindow in electron/main.js), not a React modal or
  // inline view swap on this page — opened below via
  // window.electronAPI.openThemeBuilder().
  const { theme, setTheme, availableThemes } = useTheme()

  // ── Banner template + XAML editor — unrelated to the theme engine above.
  // These are a separate, pre-existing feature (per-game banner card
  // layout, not app chrome) with its own future editor planned, so this
  // section is left exactly as it was, just relocated below the new
  // theme/layout controls. ──────────────────────────────────────────────
  const builtInBannerLayouts = getBuiltInBannerLayoutOptions()
  const [banner, setBanner] = useState('classic')
  const [availableTemplates, setAvailableTemplates] = useState(builtInBannerLayouts)

  useEffect(() => {
    const loadTemplates = async () => {
      try {
        const [templates, selectedTemplate] = await Promise.all([
          window.electronAPI.getAvailableBannerTemplates(),
          window.electronAPI.getSelectedBannerTemplate(),
        ])
        const legacyTemplateIds = Array.from(new Set(['f95', ...(templates || [])]))
        const legacyTemplates = legacyTemplateIds
          .filter((template) => template !== 'Default' && template !== 'default')
          .filter((template) => !builtInBannerLayouts.some((layout) => layout.id === template))
          .map((template) => ({ id: template, name: `${template} (legacy template)` }))
        const templateOptions = [...builtInBannerLayouts, ...legacyTemplates]
        const selectedId = normalizeBannerLayoutId(selectedTemplate)
        setAvailableTemplates(templateOptions)
        setBanner(
          templateOptions.some((template) => template.id === selectedId)
            ? selectedId
            : 'classic',
        )
      } catch (err) {
        console.error('Error fetching banner templates:', err)
        window.electronAPI.log(`Error fetching banner templates: ${err.message}`)
      }
    }
    loadTemplates()
  }, [])

  const handleLoadBanner = async () => {
    try {
      await window.electronAPI.setSelectedBannerTemplate(banner)
      alert('Banner layout loaded.')
    } catch (err) {
      console.error('Error loading banner template:', err)
      window.electronAPI.log(`Error loading banner template: ${err.message}`)
      alert('Failed to load banner template.')
    }
  }

  const handleOpenXamlEditor = () => {
    alert('XAML Editor is not implemented in this version.')
  }

  return (
    <div className="p-5 text-text -webkit-app-region-no-drag">
      {/* ── Theme picker ────────────────────────────────────────────── */}
      <div className="mb-2 flex items-center justify-between">
        <label className="block mb-3">Theme</label>
        <button
          type="button"
          onClick={() => window.electronAPI.openThemeBuilder()}
          className="btn-shadow btn-glow text-sm bg-accent text-white px-3 py-1.5 rounded-theme hover:bg-accentHover"
        >
          <i className="fas fa-palette mr-1.5"></i>Open Theme Builder
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {availableThemes.map((t) => (
          <ThemeSwatchCard
            key={t.id}
            theme={t}
            isActive={t.id === theme.id}
            onSelect={setTheme}
          />
        ))}
      </div>
      <p className="text-xs opacity-50 mb-2">
        Changes apply immediately across all open Atlas windows. Navigation
        layout, accent bar, and filter sidebar placement are all part of a
        theme now — open the Theme Builder to customize or create one.
      </p>
      <div className="border-t border-text opacity-25 my-2"></div>

      {/* ── Banner template (existing feature, unchanged) ──────────────── */}
      <div className="flex items-center mb-2">
        <label className="flex-1">Banner layout preset:</label>
        <div className="flex items-center">
          <select
            className="w-80 bg-secondary border border-border text-text rounded p-1"
            value={banner}
            onChange={(e) => setBanner(e.target.value)}
          >
            {availableTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
          <button
            className="ml-5 bg-accent text-text px-4 py-1 rounded hover:bg-accentHover"
            onClick={handleLoadBanner}
          >
            Load
          </button>
        </div>
      </div>
      <p className="text-xs opacity-50 mb-2">
        Built-in presets are schema-driven. Legacy JS templates are still
        available when present.
      </p>
      <div className="border-t border-text opacity-25 my-2"></div>
      <div className="flex items-center mb-2">
        <label className="flex-1">Banner editor</label>
        <button
          className="ml-5 bg-secondary border border-border text-text px-4 py-1 rounded opacity-75 cursor-not-allowed"
          onClick={handleOpenXamlEditor}
          disabled
        >
          Coming later
        </button>
      </div>
      <p className="text-xs opacity-50 mb-2">
        Drag/drop editing and preset sharing are planned for a later phase.
      </p>
      <div className="border-t border-text opacity-25 my-2"></div>
    </div>
  )
}

export default Appearance
