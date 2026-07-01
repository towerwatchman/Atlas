import { useState, useEffect, useRef } from 'react'
import BannerVisualEditor from './bannerEditor/BannerVisualEditor.jsx'
import BannerEditorPreview from './bannerEditor/BannerEditorPreview.jsx'
import { defaultBannerLayouts, getBuiltInBannerLayoutOptions } from '../library/bannerLayout/defaultBannerLayouts.js'
import {
  BANNER_PRESET_EXPORT_TYPE,
  BANNER_FIELD_CATEGORIES,
  BANNER_FIELD_REGISTRY,
  BANNER_SIZE_LIMITS,
  BANNER_SIZE_PRESETS,
  CUSTOM_BANNER_LAYOUT_ID,
  SUPPORTED_BANNER_FIELD_IDS,
  SUPPORTED_BANNER_SLOTS,
  createBannerPresetExport,
  createUserPresetFromLayout,
  getBannerLayoutById,
  normalizeBannerLayout,
  normalizeBannerLayoutId,
  normalizeBannerPreset,
  sanitizeBannerPresetName,
} from '../library/bannerLayout/bannerLayoutSchema.js'
import { BROWSE_MODE_ENABLED } from '../../features.js'

const FIELD_LABELS = Object.fromEntries(BANNER_FIELD_REGISTRY.map((field) => [field.id, field.label]))

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

const BADGE_FIELDS = new Set(BANNER_FIELD_REGISTRY.filter((field) => field.supportsBadge).map((field) => field.id))

const previewGame = {
  record_id: 'banner-preview',
  title: 'A Very Long Example Title for Layout Preview',
  creator: 'Studio Example',
  engine: "Ren'Py",
  status: 'Completed',
  latestVersion: 'v1.3.0',
  versions: [{ version: 'v1.2.0', isInstalled: true }, { version: 'v1.0.0', isInstalled: true }],
  isUpdateAvailable: true,
  isFavorite: true,
  isWishlisted: true,
  hasInstalledVersion: true,
  atlas_id: 123,
  f95_id: 456,
  steam_id: 789,
  lc_id: 321,
  sourceRating: 4.4,
  personalRatingOverall: 4.8,
  totalPlaytime: 9280,
  lastPlayed: Date.now() - 86400000,
  tags: 'Female Protagonist, Romance, Mystery, Choices, Animated',
  category: 'Game',
  censored: 'No',
  language: 'English',
  siteUrl: 'https://example.com',
}

const previewModes = {
  local: { label: 'Local installed sample', patch: {} },
  ...(BROWSE_MODE_ENABLED
    ? { browse: { label: 'Browse catalog sample', patch: { isCatalogEntry: true, isMetadataOnly: true, hasInstalledVersion: true, isFavorite: false, personalRatingOverall: null, totalPlaytime: 0, lastPlayed: 0 } } }
    : {}),
  wishlist: { label: 'Wishlist sample', patch: { isCatalogEntry: true, isWishlistEntry: true, isWishlisted: true, isFavorite: false } },
  missing: { label: 'Missing/uninstalled sample', patch: { hasInstalledVersion: false, versions: [], totalPlaytime: 0, lastPlayed: 0 } },
}

const cloneLayout = (layout) => JSON.parse(JSON.stringify(layout))

const SectionHeader = ({ children }) => (
  <h3 className="text-sm font-bold uppercase tracking-wide opacity-70 mt-4 mb-2 first:mt-0">{children}</h3>
)

const uniqueName = (name, presets, ignoreId = null) => {
  const base = sanitizeBannerPresetName(name)
  const used = new Set(presets.filter((preset) => preset.id !== ignoreId).map((preset) => preset.name))
  if (!used.has(base)) return base
  let index = 2
  let candidate = `${base} (${index})`
  while (used.has(candidate)) {
    index += 1
    candidate = `${base} (${index})`
  }
  return candidate
}

const BannerEditor = () => {
  const builtInBannerLayouts = getBuiltInBannerLayoutOptions()
  const classicLayout = getBannerLayoutById(defaultBannerLayouts, 'classic')
  const [selectedPresetId, setSelectedPresetId] = useState('classic')
  const [selectedLayoutId, setSelectedLayoutId] = useState('classic')
  const [draftLayout, setDraftLayout] = useState(() => cloneLayout(classicLayout))
  const [userPresets, setUserPresets] = useState([])
  const [presetName, setPresetName] = useState('')
  const [statusText, setStatusText] = useState('')
  const [lockAspectRatio, setLockAspectRatio] = useState(true)
  const [previewMode, setPreviewMode] = useState('local')
  const [activeTab, setActiveTab] = useState('presets')
  const customSaveTimerRef = useRef(null)

  const selectedUserPreset = userPresets.find((preset) => preset.id === selectedPresetId)
  const selectedBuiltIn = builtInBannerLayouts.find((layout) => layout.id === selectedPresetId)
  const isUserPresetSelected = Boolean(selectedUserPreset)
  const activePreviewGame = { ...previewGame, ...(previewModes[previewMode]?.patch || {}) }
  const tabs = [
    { id: 'presets', label: 'Presets' },
    { id: 'visual', label: 'Visual' },
    { id: 'sizeImage', label: 'Size & Image' },
    { id: 'fields', label: 'Fields' },
    { id: 'export', label: 'Import / Export' },
  ]

  const persistUserPresets = async (nextPresets) => {
    const result = await window.electronAPI.setUserBannerLayouts(nextPresets)
    if (result?.success === false) throw new Error(result.error || 'Failed to save presets')
    setUserPresets(nextPresets)
  }

  const createDraftFromPreset = (presetId) => {
    const userPreset = userPresets.find((preset) => preset.id === presetId)
    if (userPreset) return cloneLayout(normalizeBannerPreset(userPreset, classicLayout)?.layout || classicLayout)
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
    setStatusText('Unsaved custom changes')
  }

  useEffect(() => {
    const loadBannerSettings = async () => {
      try {
        const [selectedTemplate, customLayout, storedUserPresets] = await Promise.all([
          window.electronAPI.getSelectedBannerTemplate(),
          window.electronAPI.getCustomBannerLayout?.(),
          window.electronAPI.getUserBannerLayouts?.(),
        ])
        const existingIds = builtInBannerLayouts.map((layout) => layout.id)
        const normalizedUserPresets = (Array.isArray(storedUserPresets) ? storedUserPresets : [])
          .map((preset) => {
            const normalized = normalizeBannerPreset(preset, classicLayout, existingIds)
            if (normalized) existingIds.push(normalized.id)
            return normalized
          })
          .filter(Boolean)
        setUserPresets(normalizedUserPresets)

        const selectedId = normalizeBannerLayoutId(selectedTemplate)
        const selectedUser = normalizedUserPresets.find((preset) => preset.id === selectedId)

        if (selectedUser) {
          setSelectedPresetId(selectedUser.id)
          setSelectedLayoutId(selectedUser.id)
          setDraftLayout(cloneLayout(selectedUser.layout))
          setPresetName(selectedUser.name)
          return
        }

        if (selectedId === CUSTOM_BANNER_LAYOUT_ID && customLayout) {
          const normalized = normalizeBannerLayout(customLayout, classicLayout)
          const basePresetId = normalizeBannerLayoutId(normalized?.basePresetId)
          setSelectedPresetId(
            [...builtInBannerLayouts, ...normalizedUserPresets].some((layout) => layout.id === basePresetId)
              ? basePresetId
              : 'classic',
          )
          setSelectedLayoutId(CUSTOM_BANNER_LAYOUT_ID)
          setDraftLayout(normalized || cloneLayout(classicLayout))
          setPresetName(normalized?.name === 'Custom' ? '' : normalized?.name || '')
          return
        }

        const safePresetId = builtInBannerLayouts.some((layout) => layout.id === selectedId)
          ? selectedId
          : 'classic'
        const draft = cloneLayout(normalizeBannerLayout(getBannerLayoutById(defaultBannerLayouts, safePresetId), classicLayout))
        setSelectedPresetId(safePresetId)
        setSelectedLayoutId(safePresetId)
        setDraftLayout(draft)
        setPresetName(draft.name || '')
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

  useEffect(() => {
    if (selectedLayoutId !== CUSTOM_BANNER_LAYOUT_ID) return undefined
    if (customSaveTimerRef.current) clearTimeout(customSaveTimerRef.current)
    customSaveTimerRef.current = setTimeout(async () => {
      try {
        const result = await window.electronAPI.setCustomBannerLayout(draftLayout)
        if (result?.success === false) throw new Error(result.error || 'Save failed')
      } catch (err) {
        console.error('Error auto-saving custom banner layout:', err)
        setStatusText('Failed to save custom draft')
      }
    }, 300)
    return () => {
      if (customSaveTimerRef.current) clearTimeout(customSaveTimerRef.current)
    }
  }, [draftLayout, selectedLayoutId])

  const handlePresetChange = async (presetId) => {
    const draft = createDraftFromPreset(presetId)
    setSelectedPresetId(presetId)
    setSelectedLayoutId(presetId)
    setDraftLayout(draft)
    setPresetName(draft.name || '')
    setStatusText('')
    try {
      await window.electronAPI.setSelectedBannerTemplate(presetId)
    } catch (err) {
      console.error('Error applying banner preset:', err)
      setStatusText('Failed to apply banner preset')
    }
  }

  const saveCustomDraft = async (layout = draftLayout) => {
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
    return normalized
  }

  const handleSavePreset = async () => {
    try {
      const safeName = uniqueName(presetName || draftLayout.name || 'My Layout', userPresets, isUserPresetSelected ? selectedPresetId : null)
      if (isUserPresetSelected) {
        const updatedPreset = {
          ...selectedUserPreset,
          name: safeName,
          updatedAt: Date.now(),
          layout: {
            ...normalizeBannerLayout(draftLayout, classicLayout),
            id: selectedUserPreset.id,
            name: safeName,
          },
        }
        const nextPresets = userPresets.map((preset) =>
          preset.id === selectedUserPreset.id ? updatedPreset : preset,
        )
        await persistUserPresets(nextPresets)
        await window.electronAPI.setSelectedBannerTemplate(updatedPreset.id)
        setSelectedPresetId(updatedPreset.id)
        setSelectedLayoutId(updatedPreset.id)
        setDraftLayout(cloneLayout(updatedPreset.layout))
        setPresetName(safeName)
        setStatusText('Preset saved')
        return
      }

      const newPreset = createUserPresetFromLayout(
        draftLayout,
        safeName,
        classicLayout,
        [...builtInBannerLayouts.map((layout) => layout.id), ...userPresets.map((preset) => preset.id)],
      )
      await persistUserPresets([...userPresets, newPreset])
      await window.electronAPI.setSelectedBannerTemplate(newPreset.id)
      setSelectedPresetId(newPreset.id)
      setSelectedLayoutId(newPreset.id)
      setDraftLayout(cloneLayout(newPreset.layout))
      setPresetName(newPreset.name)
      setStatusText('Preset saved')
    } catch (err) {
      console.error('Error saving banner preset:', err)
      setStatusText('Failed to save preset')
    }
  }

  const handleDuplicatePreset = async () => {
    try {
      const sourceName = presetName || selectedUserPreset?.name || selectedBuiltIn?.name || 'Layout'
      const duplicateName = uniqueName(`${sourceName} Copy`, userPresets)
      const duplicate = createUserPresetFromLayout(
        draftLayout,
        duplicateName,
        classicLayout,
        [...builtInBannerLayouts.map((layout) => layout.id), ...userPresets.map((preset) => preset.id)],
      )
      await persistUserPresets([...userPresets, duplicate])
      await window.electronAPI.setSelectedBannerTemplate(duplicate.id)
      setSelectedPresetId(duplicate.id)
      setSelectedLayoutId(duplicate.id)
      setDraftLayout(cloneLayout(duplicate.layout))
      setPresetName(duplicate.name)
      setStatusText('Preset duplicated')
    } catch (err) {
      console.error('Error duplicating banner preset:', err)
      setStatusText('Failed to duplicate preset')
    }
  }

  const handleRenamePreset = async () => {
    if (!isUserPresetSelected) {
      setStatusText('Cannot rename built-in preset')
      return
    }
    try {
      const safeName = uniqueName(presetName, userPresets, selectedUserPreset.id)
      const renamed = {
        ...selectedUserPreset,
        name: safeName,
        updatedAt: Date.now(),
        layout: { ...selectedUserPreset.layout, name: safeName },
      }
      await persistUserPresets(userPresets.map((preset) => preset.id === renamed.id ? renamed : preset))
      setPresetName(safeName)
      setDraftLayout(cloneLayout(renamed.layout))
      setStatusText('Preset renamed')
    } catch (err) {
      console.error('Error renaming banner preset:', err)
      setStatusText('Failed to rename preset')
    }
  }

  const handleDeletePreset = async () => {
    if (!isUserPresetSelected) {
      setStatusText('Cannot delete built-in preset')
      return
    }
    try {
      const nextPresets = userPresets.filter((preset) => preset.id !== selectedUserPreset.id)
      await persistUserPresets(nextPresets)
      await window.electronAPI.setSelectedBannerTemplate('classic')
      setSelectedPresetId('classic')
      setSelectedLayoutId('classic')
      setDraftLayout(createDraftFromPreset('classic'))
      setPresetName('Classic')
      setStatusText('Preset deleted; Classic selected')
    } catch (err) {
      console.error('Error deleting banner preset:', err)
      setStatusText('Failed to delete preset')
    }
  }

  const handleExportPreset = async () => {
    try {
      const exportData = createBannerPresetExport(
        isUserPresetSelected ? selectedUserPreset : draftLayout,
        presetName || draftLayout.name,
      )
      const result = await window.electronAPI.exportBannerLayoutPreset(exportData.name, exportData)
      if (result?.canceled) return
      if (result?.success === false) throw new Error(result.error || 'Export failed')
      setStatusText('Preset exported')
    } catch (err) {
      console.error('Error exporting banner preset:', err)
      setStatusText('Failed to export preset')
    }
  }

  const handleImportPreset = async () => {
    try {
      const result = await window.electronAPI.importBannerLayoutPreset()
      if (result?.canceled) return
      if (result?.success === false) {
        setStatusText('Invalid preset file')
        return
      }
      const data = result.data
      if (data?.type && data.type !== BANNER_PRESET_EXPORT_TYPE) {
        setStatusText('Invalid preset file')
        return
      }
      const importedLayout = data?.layout || data
      const importedName = uniqueName(data?.name || importedLayout?.name || 'Imported Layout', userPresets)
      const importedPreset = createUserPresetFromLayout(
        importedLayout,
        importedName,
        classicLayout,
        [...builtInBannerLayouts.map((layout) => layout.id), ...userPresets.map((preset) => preset.id)],
      )
      await persistUserPresets([...userPresets, importedPreset])
      await window.electronAPI.setSelectedBannerTemplate(importedPreset.id)
      setSelectedPresetId(importedPreset.id)
      setSelectedLayoutId(importedPreset.id)
      setDraftLayout(cloneLayout(importedPreset.layout))
      setPresetName(importedPreset.name)
      setStatusText('Preset imported')
    } catch (err) {
      console.error('Error importing banner preset:', err)
      setStatusText('Invalid preset file')
    }
  }

  const handleResetCustom = async () => {
    try {
      const presetDraft = createDraftFromPreset(selectedPresetId)
      setDraftLayout(presetDraft)
      await saveCustomDraft(presetDraft)
      setStatusText('Reset current layout to preset')
    } catch (err) {
      console.error('Error resetting banner layout:', err)
      setStatusText('Failed to reset layout')
    }
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
    markCustom((current) => ({
      ...current,
      imageFit,
      image: { ...current.image, fit: imageFit },
    }))
  }

  const updateSizePreset = (presetId) => {
    const sizePreset = BANNER_SIZE_PRESETS.find((preset) => preset.id === presetId)
    if (!sizePreset) return
    markCustom((current) => ({
      ...current,
      width: sizePreset.width,
      height: sizePreset.height,
      density: sizePreset.density,
    }))
  }

  const updateDimension = (key, value) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return
    markCustom((current) => {
      const next = { ...current, [key]: numeric }
      if (lockAspectRatio) {
        const ratio = (current.width || 537) / (current.height || 251)
        if (key === 'width') next.height = Math.round(numeric / ratio)
        if (key === 'height') next.width = Math.round(numeric * ratio)
      }
      return next
    })
  }

  const updateImage = (patch) => {
    markCustom((current) => ({
      ...current,
      image: { ...current.image, ...patch },
      imageFit: patch.fit || current.imageFit,
    }))
  }

  const updateBlurBackground = (patch) => {
    markCustom((current) => ({
      ...current,
      image: {
        ...current.image,
        blurBackground: {
          opacity: 0.6,
          blur: 20,
          scale: 1.1,
          ...current.image?.blurBackground,
          ...patch,
        },
      },
    }))
  }

  const updatePreviewCycle = (patch) => {
    markCustom((current) => ({
      ...current,
      previewCycle: {
        enabled: false,
        intervalMs: 2000,
        ...current.previewCycle,
        ...patch,
      },
    }))
  }

  const resetField = (fieldId) => {
    const presetDraft = createDraftFromPreset(selectedPresetId)
    const presetField = presetDraft.fields.find((field) => field.id === fieldId)
    if (!presetField) return
    updateField(fieldId, presetField)
  }

  return (
    <div className="text-text -webkit-app-region-no-drag flex flex-col flex-1 min-h-0">
      {/* Fixed header: the preview-sample selector/status row, the live
          banner preview, and the tabs all stay pinned here and never
          scroll — only the active tab's own settings content below
          scrolls. Previously this whole block lived inside the same
          scrollable container as that content. */}
      <div className="flex-shrink-0 space-y-4 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm font-semibold">Preview sample</label>
            <select
              className="bg-secondary border border-border text-text rounded p-1"
              value={previewMode}
              onChange={(event) => setPreviewMode(event.target.value)}
            >
              {Object.entries(previewModes).map(([id, mode]) => (
                <option key={id} value={id}>{mode.label}</option>
              ))}
            </select>
          </div>
          <span className="text-xs opacity-70">
            {selectedLayoutId === CUSTOM_BANNER_LAYOUT_ID
              ? `Editing a custom copy of ${selectedBuiltIn?.name || selectedUserPreset?.name || 'preset'}`
              : isUserPresetSelected ? `Saved as ${selectedUserPreset.name}` : 'Built-in preset'}
            {statusText ? ` - ${statusText}` : ''}
          </span>
        </div>

        <div className="flex justify-center overflow-x-auto py-2">
          <BannerEditorPreview game={activePreviewGame} layout={draftLayout} />
        </div>

        <div className="flex gap-2 border-b border-border">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`text-xs px-3 py-2 border-b-2 transition-colors -mb-px ${
                activeTab === tab.id ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-text'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pt-3">
      {activeTab === 'presets' && (
        <section className="space-y-4">
          <SectionHeader>Preset Selection</SectionHeader>
          <div className="grid grid-cols-1 md:grid-cols-[minmax(220px,320px)_minmax(220px,320px)] gap-3">
            <label className="block text-sm">
              Banner preset
              <select
                className="mt-1 w-full bg-secondary border border-border text-text rounded p-1"
                value={selectedPresetId}
                onChange={(event) => handlePresetChange(event.target.value)}
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
              </select>
            </label>
            <label className="block text-sm">
              Preset name
              <input
                className="mt-1 w-full bg-secondary border border-border text-text rounded p-1"
                value={presetName}
                placeholder="Preset name"
                onChange={(event) => setPresetName(event.target.value)}
              />
            </label>
          </div>

          <SectionHeader>Preset Actions</SectionHeader>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="bg-accent text-text px-3 py-1 rounded hover:bg-accentHover" onClick={handleSavePreset}>Save as preset</button>
            <button type="button" className="bg-secondary border border-border text-text px-3 py-1 rounded hover:bg-tertiary" onClick={handleDuplicatePreset}>Duplicate preset</button>
            <button type="button" className="bg-secondary border border-border text-text px-3 py-1 rounded hover:bg-tertiary" onClick={handleRenamePreset}>Rename preset</button>
            <button type="button" className="bg-secondary border border-border text-text px-3 py-1 rounded hover:bg-tertiary" onClick={handleDeletePreset}>Delete preset</button>
            <button type="button" className="bg-secondary border border-border text-text px-3 py-1 rounded hover:bg-tertiary" onClick={handleResetCustom}>Reset current layout to preset</button>
          </div>
        </section>
      )}

      {activeTab === 'visual' && (
        <BannerVisualEditor
          layout={draftLayout}
          previewGame={activePreviewGame}
          fieldLabels={FIELD_LABELS}
          slotLabels={SLOT_LABELS}
          badgeFields={BADGE_FIELDS}
          fieldRegistry={BANNER_FIELD_REGISTRY}
          fieldCategories={BANNER_FIELD_CATEGORIES}
          onFieldChange={updateField}
          onResetField={resetField}
          showPreview={false}
        />
      )}

      {activeTab === 'sizeImage' && (
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="space-y-3">
            <SectionHeader>Size</SectionHeader>
            <label className="block text-sm">
              Size preset
              <select
                className="mt-1 w-48 bg-secondary border border-border text-text rounded p-1"
                value={BANNER_SIZE_PRESETS.find((preset) => preset.width === draftLayout.width && preset.height === draftLayout.height)?.id || 'custom'}
                onChange={(event) => updateSizePreset(event.target.value)}
              >
                {BANNER_SIZE_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>{preset.name} ({preset.width}x{preset.height})</option>
                ))}
                <option value="custom">Custom</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2 max-w-sm">
              <label className="block text-sm">
                Width
                <input type="number" min={BANNER_SIZE_LIMITS.minWidth} max={BANNER_SIZE_LIMITS.maxWidth} className="mt-1 w-full bg-secondary border border-border text-text rounded p-1" value={draftLayout.width || 537} onChange={(event) => updateDimension('width', event.target.value)} />
              </label>
              <label className="block text-sm">
                Height
                <input type="number" min={BANNER_SIZE_LIMITS.minHeight} max={BANNER_SIZE_LIMITS.maxHeight} className="mt-1 w-full bg-secondary border border-border text-text rounded p-1" value={draftLayout.height || 251} onChange={(event) => updateDimension('height', event.target.value)} />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={lockAspectRatio} onChange={(event) => setLockAspectRatio(event.target.checked)} />
              Lock aspect ratio
            </label>
            <p className="text-xs opacity-60">
              Width clamps to {BANNER_SIZE_LIMITS.minWidth}-{BANNER_SIZE_LIMITS.maxWidth}px; height clamps to {BANNER_SIZE_LIMITS.minHeight}-{BANNER_SIZE_LIMITS.maxHeight}px.
            </p>
          </div>

          <div className="space-y-3">
            <SectionHeader>Image</SectionHeader>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draftLayout.image?.visible !== false} onChange={(event) => updateImage({ visible: event.target.checked })} />
              Show banner image
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block text-sm">
                Image fit
                <select className="mt-1 w-full bg-secondary border border-border text-text rounded p-1" value={draftLayout.image?.fit || draftLayout.imageFit} onChange={(event) => updateImageFit(event.target.value)}>
                  <option value="contain">Contain</option>
                  <option value="cover">Cover</option>
                </select>
              </label>
              <label className="block text-sm">
                Image background
                <select className="mt-1 w-full bg-secondary border border-border text-text rounded p-1" value={draftLayout.image?.backgroundMode || 'image'} onChange={(event) => updateImage({ backgroundMode: event.target.value })}>
                  <option value="solid">Solid fallback</option>
                  <option value="image">Single image</option>
                  <option value="blurred-fill">Blurred image fill</option>
                </select>
              </label>
              <label className="block text-sm">
                Image position
                <select className="mt-1 w-full bg-secondary border border-border text-text rounded p-1" value={draftLayout.image?.position || 'center'} onChange={(event) => updateImage({ position: event.target.value })}>
                  <option value="center">Center</option>
                  <option value="top">Top</option>
                  <option value="bottom">Bottom</option>
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                </select>
              </label>
              <label className="block text-sm">
                Fallback background
                <select className="mt-1 w-full bg-secondary border border-border text-text rounded p-1" value={draftLayout.image?.fallbackBackground || 'dark'} onChange={(event) => updateImage({ fallbackBackground: event.target.value })}>
                  <option value="dark">Dark</option>
                  <option value="theme">Theme secondary</option>
                </select>
              </label>
            </div>
            <div className="border border-border rounded p-3 bg-secondary/40 space-y-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draftLayout.previewCycle?.enabled === true}
                  onChange={(event) => updatePreviewCycle({ enabled: event.target.checked })}
                />
                Cycle previews on hover
              </label>
              <label className="block">
                Cycle interval (seconds)
                <input
                  type="number"
                  min="0.25"
                  max="15"
                  step="0.25"
                  disabled={draftLayout.previewCycle?.enabled !== true}
                  className="mt-1 w-full bg-secondary border border-border text-text rounded p-1 disabled:opacity-50"
                  value={(draftLayout.previewCycle?.intervalMs ?? 2000) / 1000}
                  onChange={(event) => {
                    const seconds = Number(event.target.value)
                    if (!Number.isFinite(seconds)) return
                    updatePreviewCycle({ intervalMs: Math.round(seconds * 1000) })
                  }}
                />
              </label>
              <p className="text-xs opacity-60">
                Hovering a banner in the library cycles through the game's preview images.
                Video previews are skipped.
              </p>
            </div>
            {(draftLayout.image?.backgroundMode || 'image') === 'blurred-fill' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm border border-border rounded p-3 bg-secondary/40">
                <label>
                  Blur opacity
                  <input type="number" min="0" max="1" step="0.05" className="mt-1 w-full bg-secondary border border-border text-text rounded p-1" value={draftLayout.image?.blurBackground?.opacity ?? 0.6} onChange={(event) => updateBlurBackground({ opacity: Number(event.target.value) })} />
                </label>
                <label>
                  Blur amount
                  <input type="number" min="0" max="40" step="1" className="mt-1 w-full bg-secondary border border-border text-text rounded p-1" value={draftLayout.image?.blurBackground?.blur ?? 20} onChange={(event) => updateBlurBackground({ blur: Number(event.target.value) })} />
                </label>
                <label>
                  Blur scale
                  <input type="number" min="1" max="1.3" step="0.01" className="mt-1 w-full bg-secondary border border-border text-text rounded p-1" value={draftLayout.image?.blurBackground?.scale ?? 1.1} onChange={(event) => updateBlurBackground({ scale: Number(event.target.value) })} />
                </label>
              </div>
            )}

            <SectionHeader>Overlays</SectionHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {['top', 'bottom'].map((position) => (
                <div key={position} className="space-y-2 border border-border rounded p-3 bg-secondary/40">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={draftLayout.overlays?.[position]?.visible !== false} onChange={(event) => updateOverlay(position, { visible: event.target.checked })} />
                    Show {position} dark overlay
                  </label>
                  <input type="range" min="0" max="1" step="0.05" value={draftLayout.overlays?.[position]?.opacity ?? 0.8} onChange={(event) => updateOverlay(position, { opacity: Number(event.target.value) })} />
                  <input type="number" min="0" max="1" step="0.05" className="w-20 bg-secondary border border-border text-text rounded p-1" value={draftLayout.overlays?.[position]?.opacity ?? 0.8} onChange={(event) => updateOverlay(position, { opacity: Number(event.target.value) })} />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {activeTab === 'fields' && (
        <section className="overflow-x-auto">
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
                      <input type="checkbox" checked={field.visible !== false} onChange={(event) => updateField(fieldId, { visible: event.target.checked })} />
                    </td>
                    <td className="py-2 pr-3">
                      <select className="w-48 bg-secondary border border-border text-text rounded p-1" value={field.slot} onChange={(event) => updateField(fieldId, { slot: event.target.value })}>
                        {SUPPORTED_BANNER_SLOTS.map((slot) => (
                          <option key={slot} value={slot}>{SLOT_LABELS[slot]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      <input type="number" min="8" max="24" className="w-20 bg-secondary border border-border text-text rounded p-1" value={field.fontSize ?? 12} onChange={(event) => updateField(fieldId, { fontSize: Number(event.target.value) })} />
                    </td>
                    <td className="py-2 pr-3">
                      <input type="checkbox" disabled={!canBadge} checked={canBadge && field.badge === true} onChange={(event) => updateField(fieldId, { badge: event.target.checked })} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}

      {activeTab === 'export' && (
        <section className="space-y-4">
          <SectionHeader>Import / Export</SectionHeader>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="bg-secondary border border-border text-text px-3 py-1 rounded hover:bg-tertiary" onClick={handleExportPreset}>Export preset</button>
            <button type="button" className="bg-secondary border border-border text-text px-3 py-1 rounded hover:bg-tertiary" onClick={handleImportPreset}>Import preset</button>
          </div>
        </section>
      )}
      </div>
    </div>
  )
}

export default BannerEditor
