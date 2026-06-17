import { useState, useEffect } from 'react'
import { useTheme } from '../../theme/ThemeProvider.jsx'
import { LAYOUT_OPTIONS } from '../../theme/themes.js'

// A handful of each theme's colors, shown as small swatches on its picker
// card so people can tell themes apart at a glance rather than reading
// names off a dropdown.
const SWATCH_KEYS = ['primary', 'tertiary', 'accent', 'text']

const layoutLabels = {
  sidebar: 'Sidebar',
  topnav: 'Top Bar',
}

const layoutDescriptions = {
  sidebar: 'Navigation icons run down the left edge of the window.',
  topnav: 'Navigation sits in a bar across the top of the window.',
}

const ThemeSwatchCard = ({ theme, isActive, onSelect }) => (
  <button
    type="button"
    onClick={() => onSelect(theme)}
    className={`text-left rounded-theme border-2 p-3 transition-colors ${
      isActive ? 'border-accent' : 'border-border hover:border-muted'
    }`}
    style={{ backgroundColor: theme.colors.secondary }}
  >
    <div className="flex gap-1 mb-3">
      {SWATCH_KEYS.map((key) => (
        <span
          key={key}
          className="block w-6 h-6 rounded-themeSm border border-border"
          style={{ backgroundColor: theme.colors[key] }}
        />
      ))}
    </div>
    <div className="flex items-center justify-between">
      <span className="text-sm font-semibold" style={{ color: theme.colors.text }}>
        {theme.name}
      </span>
      {isActive && (
        <span className="text-xs text-accent font-medium">Active</span>
      )}
    </div>
  </button>
)

const Appearance = () => {
  const { theme, layout, setTheme, setLayout, availableThemes } = useTheme()

  // ── Banner template + XAML editor — unrelated to the theme engine above.
  // These are a separate, pre-existing feature (per-game banner card
  // layout, not app chrome) with its own future editor planned, so this
  // section is left exactly as it was, just relocated below the new
  // theme/layout controls. ──────────────────────────────────────────────
  const [banner, setBanner] = useState('Default')
  const [availableTemplates, setAvailableTemplates] = useState(['Default'])

  useEffect(() => {
    const loadTemplates = async () => {
      try {
        const templates = await window.electronAPI.getAvailableBannerTemplates()
        setAvailableTemplates(['Default', ...templates])
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
      <div className="mb-2">
        <label className="block mb-3">Theme</label>
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
      </div>
      <p className="text-xs opacity-50 mb-2">
        Changes apply immediately across all open Atlas windows.
      </p>
      <div className="border-t border-text opacity-25 my-2"></div>

      {/* ── Layout (nav position) ───────────────────────────────────── */}
      <div className="mb-2">
        <label className="block mb-3">Navigation Position</label>
        <div className="flex gap-3">
          {LAYOUT_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setLayout(option)}
              className={`flex-1 text-left rounded-theme border-2 p-3 transition-colors ${
                layout === option ? 'border-accent bg-selected' : 'border-border bg-secondary hover:border-muted'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold">{layoutLabels[option]}</span>
                {layout === option && <span className="text-xs text-accent font-medium">Active</span>}
              </div>
              <p className="text-xs opacity-60">{layoutDescriptions[option]}</p>
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs opacity-50 mb-2">
        Works with any theme — pick whichever layout you prefer independently of theme.
      </p>
      <div className="border-t border-text opacity-25 my-2"></div>

      {/* ── Banner template (existing feature, unchanged) ──────────────── */}
      <div className="flex items-center mb-2">
        <label className="flex-1">Select a Banner UI Resource:</label>
        <div className="flex items-center">
          <select
            className="w-80 bg-secondary border border-border text-text rounded p-1"
            value={banner}
            onChange={(e) => setBanner(e.target.value)}
          >
            {availableTemplates.map((template) => (
              <option key={template} value={template}>
                {template}
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
        This will override the default banner layout. Please check for errors
        prior to loading
      </p>
      <div className="border-t border-text opacity-25 my-2"></div>
      <div className="flex items-center mb-2">
        <label className="flex-1">Open Xaml Editor</label>
        <button
          className="ml-5 bg-accent text-text px-4 py-1 rounded hover:bg-accentHover"
          onClick={handleOpenXamlEditor}
        >
          Launch
        </button>
      </div>
      <p className="text-xs opacity-50 mb-2">
        Create and modify existing banner themes
      </p>
      <div className="border-t border-text opacity-25 my-2"></div>
    </div>
  )
}

export default Appearance
