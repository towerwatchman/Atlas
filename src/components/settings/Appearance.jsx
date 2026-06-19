import { useState, useEffect } from 'react'
import { useTheme } from '../../theme/ThemeProvider.jsx'
import { GRADIENT_ELIGIBLE_KEYS, resolveColorValue } from '../../theme/themes.js'
import { getBuiltInBannerLayoutOptions } from '../library/bannerLayout/defaultBannerLayouts.js'
import { normalizeBannerLayoutId } from '../library/bannerLayout/bannerLayoutSchema.js'

const SWATCH_KEYS = ['primary', 'tertiary', 'accent', 'text']

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
      {isActive && <span className="text-xs text-accent font-medium">Active</span>}
    </div>
  </button>
)

const Appearance = () => {
  const { theme, setTheme, availableThemes } = useTheme()
  const builtInBannerLayouts = getBuiltInBannerLayoutOptions()
  const [selectedBannerPreset, setSelectedBannerPreset] = useState('classic')
  const [userPresets, setUserPresets] = useState([])
  const [statusText, setStatusText] = useState('')

  const loadBannerSummary = async () => {
    try {
      const [selectedTemplate, presets] = await Promise.all([
        window.electronAPI.getSelectedBannerTemplate(),
        window.electronAPI.getUserBannerLayouts?.(),
      ])
      const userBannerPresets = Array.isArray(presets) ? presets : []
      const selectedId = normalizeBannerLayoutId(selectedTemplate)
      const knownIds = new Set([...builtInBannerLayouts.map((layout) => layout.id), ...userBannerPresets.map((preset) => preset.id), 'custom'])
      setUserPresets(userBannerPresets)
      setSelectedBannerPreset(knownIds.has(selectedId) ? selectedId : 'classic')
    } catch (err) {
      console.error('Failed to load banner preset summary:', err)
      setStatusText('Failed to load banner presets')
    }
  }

  useEffect(() => {
    loadBannerSummary()
    const handleVisibilityChange = () => {
      if (!document.hidden) loadBannerSummary()
    }
    window.addEventListener('focus', loadBannerSummary)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    const removeBannerLayoutListener = window.electronAPI.onBannerLayoutUpdated?.(loadBannerSummary)
    return () => {
      window.removeEventListener('focus', loadBannerSummary)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (typeof removeBannerLayoutListener === 'function') removeBannerLayoutListener()
    }
  }, [])

  const handleSelectBannerPreset = async (presetId) => {
    setSelectedBannerPreset(presetId)
    try {
      const result = await window.electronAPI.setSelectedBannerTemplate(presetId)
      if (result?.success === false) throw new Error(result.error || 'Failed to save preset')
      setStatusText('Banner preset applied')
    } catch (err) {
      console.error('Failed to save selected banner preset:', err)
      setStatusText('Failed to apply banner preset')
    }
  }

  return (
    <div className="p-5 text-text -webkit-app-region-no-drag">
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
        {availableThemes.map((availableTheme) => (
          <ThemeSwatchCard
            key={availableTheme.id}
            theme={availableTheme}
            isActive={availableTheme.id === theme.id}
            onSelect={setTheme}
          />
        ))}
      </div>
      <p className="text-xs opacity-50 mb-2">
        Changes apply immediately across all open Atlas windows. Navigation
        layout, accent bar, and filter sidebar placement are all part of a
        theme now - open the Theme Builder to customize or create one.
      </p>
      <div className="border-t border-text opacity-25 my-3"></div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="font-semibold">Banner preset</label>
          <select
            className="w-72 bg-secondary border border-border text-text rounded p-1"
            value={selectedBannerPreset}
            onChange={(event) => handleSelectBannerPreset(event.target.value)}
          >
            <optgroup label="Built-in">
              {builtInBannerLayouts.map((layout) => (
                <option key={layout.id} value={layout.id}>{layout.name}</option>
              ))}
            </optgroup>
            {userPresets.length > 0 && (
              <optgroup label="User">
                {userPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>{preset.name}</option>
                ))}
              </optgroup>
            )}
            <option value="custom">Custom draft</option>
          </select>
          <button
            type="button"
            className="bg-accent text-text px-3 py-1 rounded hover:bg-accentHover"
            onClick={() => window.electronAPI.openBannerEditor()}
          >
            Open Banner Editor
          </button>
          {statusText && <span className="text-xs opacity-70">{statusText}</span>}
        </div>
        <p className="text-xs opacity-60">
          Choose the active banner layout here. Use the Banner Editor window for visual placement,
          sizing, field conditions, presets, and import/export.
        </p>
      </section>
      <div className="border-t border-text opacity-25 my-3"></div>
    </div>
  )
}

export default Appearance
