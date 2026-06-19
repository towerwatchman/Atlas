import { useState, useEffect } from 'react'
import { useTheme } from '../../theme/ThemeProvider.jsx'
import { GRADIENT_ELIGIBLE_KEYS, resolveColorValue } from '../../theme/themes.js'
import BannerLayoutRenderer from '../library/bannerLayout/BannerLayoutRenderer.jsx'
import { defaultBannerLayouts, getBuiltInBannerLayoutOptions } from '../library/bannerLayout/defaultBannerLayouts.js'
import {
  CUSTOM_BANNER_LAYOUT_ID,
  SUPPORTED_BANNER_FIELD_IDS,
  SUPPORTED_BANNER_SLOTS,
  getBannerLayoutById,
  normalizeBannerLayout,
  normalizeBannerLayoutId,
} from '../library/bannerLayout/bannerLayoutSchema.js'

const SWATCH_KEYS = ['primary', 'tertiary', 'accent', 'text']

const FIELD_LABELS = {
  title: 'Title',
  creator: 'Creator',
  engine: 'Engine',
  status: 'Status',
  version: 'Version',
  update: 'Update Available',
  favorite: 'Favorite',
  wishlist: 'Wishlist',
  installedState: 'Installed State',
}

const SLOT_LABELS = {
  'top-left': 'Top Left',
  'top-center': 'Top Center',
  'top-right': 'Top Right',
  'center-left': 'Center Left',
  center: 'Center',
  'center-right': 'Center Right',
  'bottom-left': 'Bottom Left',
  'bottom-center': 'Bottom Center',
  'bottom-right': 'Bottom Right',
  'top-left-floating': 'Top Left Floating',
  'top-right-floating': 'Top Right Floating',
}

const BADGE_FIELDS = new Set(['engine', 'status', 'version', 'installedState', 'update'])

const previewGame = {
  record_id: 'banner-preview',
  title: 'A Very Long Example Title for Layout Preview',
  creator: 'Studio Example',
  engine: "Ren'Py",
  status: 'Completed',
  versions: [{ version: 'v1.2.0', isInstalled: true }],
  isUpdateAvailable: true,
  isFavorite: true,
  isWishlisted: true,
  hasInstalledVersion: true,
  siteUrl: 'https://example.com',
}

const cloneLayout = (layout) => JSON.parse(JSON.stringify(layout))

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
  const { theme, setTheme, availableThemes } = useTheme()
  const builtInBannerLayouts = getBuiltInBannerLayoutOptions()
  const classicLayout = getBannerLayoutById(defaultBannerLayouts, 'classic')
  const [selectedPresetId, setSelectedPresetId] = useState('classic')
  const [selectedLayoutId, setSelectedLayoutId] = useState('classic')
  const [draftLayout, setDraftLayout] = useState(() => cloneLayout(classicLayout))
  const [statusText, setStatusText] = useState('')

  const createDraftFromPreset = (presetId) => {
    const preset = getBannerLayoutById(defaultBannerLayouts, presetId)
    return cloneLayout(normalizeBannerLayout(preset, classicLayout))
  }

  const markCustom = (updater) => {
    setDraftLayout((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater
      return normalizeBannerLayout(
        {
          ...next,
          id: CUSTOM_BANNER_LAYOUT_ID,
          name: 'Custom',
          basePresetId: selectedPresetId,
        },
        classicLayout,
      )
    })
    setSelectedLayoutId(CUSTOM_BANNER_LAYOUT_ID)
    setStatusText('Unsaved custom layout')
  }

  useEffect(() => {
    const loadBannerSettings = async () => {
      try {
        const [selectedTemplate, customLayout] = await Promise.all([
          window.electronAPI.getSelectedBannerTemplate(),
          window.electronAPI.getCustomBannerLayout?.(),
        ])
        const selectedId = normalizeBannerLayoutId(selectedTemplate)

        if (selectedId === CUSTOM_BANNER_LAYOUT_ID && customLayout) {
          const normalized = normalizeBannerLayout(customLayout, classicLayout)
          const basePresetId = normalizeBannerLayoutId(normalized?.basePresetId)
          setSelectedPresetId(
            builtInBannerLayouts.some((layout) => layout.id === basePresetId)
              ? basePresetId
              : 'classic',
          )
          setSelectedLayoutId(CUSTOM_BANNER_LAYOUT_ID)
          setDraftLayout(normalized || cloneLayout(classicLayout))
          return
        }

        const safePresetId = builtInBannerLayouts.some((layout) => layout.id === selectedId)
          ? selectedId
          : 'classic'
        setSelectedPresetId(safePresetId)
        setSelectedLayoutId(safePresetId)
        setDraftLayout(createDraftFromPreset(safePresetId))
      } catch (err) {
        console.error('Error loading banner layout settings:', err)
        window.electronAPI.log(`Error loading banner layout settings: ${err.message}`)
        setDraftLayout(cloneLayout(classicLayout))
        setSelectedLayoutId('classic')
        setStatusText('Failed to load banner layout settings')
      }
    }

    loadBannerSettings()
  }, [])

  const handlePresetChange = (presetId) => {
    setSelectedPresetId(presetId)
    setDraftLayout(createDraftFromPreset(presetId))
    setSelectedLayoutId(presetId)
    setStatusText('')
  }

  const handleUsePreset = async () => {
    try {
      await window.electronAPI.setSelectedBannerTemplate(selectedPresetId)
      setDraftLayout(createDraftFromPreset(selectedPresetId))
      setSelectedLayoutId(selectedPresetId)
      setStatusText('Preset applied')
    } catch (err) {
      console.error('Error applying banner preset:', err)
      setStatusText('Failed to apply banner preset')
    }
  }

  const handleSaveCustom = async (layout = draftLayout) => {
    try {
      const normalized = normalizeBannerLayout(
        {
          ...layout,
          id: CUSTOM_BANNER_LAYOUT_ID,
          name: 'Custom',
          basePresetId: selectedPresetId,
        },
        classicLayout,
      )
      const result = await window.electronAPI.setCustomBannerLayout(normalized)
      if (result?.success === false) throw new Error(result.error || 'Save failed')
      setDraftLayout(normalized)
      setSelectedLayoutId(CUSTOM_BANNER_LAYOUT_ID)
      setStatusText('Saved')
    } catch (err) {
      console.error('Error saving custom banner layout:', err)
      setStatusText('Failed to save banner layout')
    }
  }

  const handleResetCustom = () => {
    const presetDraft = {
      ...createDraftFromPreset(selectedPresetId),
      id: CUSTOM_BANNER_LAYOUT_ID,
      name: 'Custom',
      basePresetId: selectedPresetId,
    }
    setDraftLayout(presetDraft)
    handleSaveCustom(presetDraft)
  }

  const updateOverlay = (position, patch) => {
    markCustom((current) => ({
      ...current,
      overlays: {
        ...current.overlays,
        [position]: {
          ...current.overlays?.[position],
          ...patch,
        },
      },
    }))
  }

  const updateField = (fieldId, patch) => {
    markCustom((current) => ({
      ...current,
      fields: current.fields.map((field) =>
        field.id === fieldId ? { ...field, ...patch } : field,
      ),
    }))
  }

  const updateImageFit = (imageFit) => {
    markCustom((current) => ({ ...current, imageFit }))
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

      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="font-semibold">Banner preset</label>
          <select
            className="w-64 bg-secondary border border-border text-text rounded p-1"
            value={selectedPresetId}
            onChange={(event) => handlePresetChange(event.target.value)}
          >
            {builtInBannerLayouts.map((layout) => (
              <option key={layout.id} value={layout.id}>
                {layout.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="bg-accent text-text px-3 py-1 rounded hover:bg-accentHover"
            onClick={handleUsePreset}
          >
            Use preset
          </button>
          <button
            type="button"
            className="bg-secondary border border-border text-text px-3 py-1 rounded hover:bg-tertiary"
            onClick={handleResetCustom}
          >
            Reset custom layout to this preset
          </button>
          <button
            type="button"
            className="bg-accent text-text px-3 py-1 rounded hover:bg-accentHover"
            onClick={() => handleSaveCustom()}
          >
            Save custom layout
          </button>
          <span className="text-xs opacity-70">
            Current: {selectedLayoutId === CUSTOM_BANNER_LAYOUT_ID ? 'Custom' : 'Built-in preset'}
            {statusText ? ` - ${statusText}` : ''}
          </span>
        </div>

        <div className="flex flex-wrap gap-5">
          <div className="space-y-3 min-w-[240px]">
            <div>
              <label className="block text-sm mb-1">Image fit</label>
              <select
                className="w-40 bg-secondary border border-border text-text rounded p-1"
                value={draftLayout.imageFit}
                onChange={(event) => updateImageFit(event.target.value)}
              >
                <option value="contain">Contain</option>
                <option value="cover">Cover</option>
              </select>
            </div>

            {['top', 'bottom'].map((position) => (
              <div key={position} className="space-y-1">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draftLayout.overlays?.[position]?.visible !== false}
                    onChange={(event) => updateOverlay(position, { visible: event.target.checked })}
                  />
                  Show {position} dark overlay
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={draftLayout.overlays?.[position]?.opacity ?? 0.8}
                    onChange={(event) => updateOverlay(position, { opacity: Number(event.target.value) })}
                  />
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    className="w-16 bg-secondary border border-border text-text rounded p-1"
                    value={draftLayout.overlays?.[position]?.opacity ?? 0.8}
                    onChange={(event) => updateOverlay(position, { opacity: Number(event.target.value) })}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="origin-top-left scale-[0.72] -mb-16">
            <BannerLayoutRenderer
              game={previewGame}
              layout={draftLayout}
              onSelect={() => {}}
              onContextMenu={(event) => event.preventDefault()}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2">Field</th>
                <th className="text-left py-2">Visible</th>
                <th className="text-left py-2">Position</th>
                <th className="text-left py-2">Font size</th>
                <th className="text-left py-2">Badge</th>
              </tr>
            </thead>
            <tbody>
              {SUPPORTED_BANNER_FIELD_IDS.map((fieldId) => {
                const field = draftLayout.fields.find((candidate) => candidate.id === fieldId) || {
                  id: fieldId,
                  slot: 'bottom-left',
                  visible: false,
                  fontSize: 12,
                  badge: false,
                }
                const canBadge = BADGE_FIELDS.has(fieldId)
                return (
                  <tr key={fieldId} className="border-b border-border/60">
                    <td className="py-2 pr-3">{FIELD_LABELS[fieldId]}</td>
                    <td className="py-2 pr-3">
                      <input
                        type="checkbox"
                        checked={field.visible !== false}
                        onChange={(event) => updateField(fieldId, { visible: event.target.checked })}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        className="w-48 bg-secondary border border-border text-text rounded p-1"
                        value={field.slot}
                        onChange={(event) => updateField(fieldId, { slot: event.target.value })}
                      >
                        {SUPPORTED_BANNER_SLOTS.map((slot) => (
                          <option key={slot} value={slot}>
                            {SLOT_LABELS[slot]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        min="8"
                        max="24"
                        className="w-20 bg-secondary border border-border text-text rounded p-1"
                        value={field.fontSize ?? 12}
                        onChange={(event) => updateField(fieldId, { fontSize: Number(event.target.value) })}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="checkbox"
                        disabled={!canBadge}
                        checked={canBadge && field.badge === true}
                        onChange={(event) => updateField(fieldId, { badge: event.target.checked })}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
      <div className="border-t border-text opacity-25 my-3"></div>
    </div>
  )
}

export default Appearance
