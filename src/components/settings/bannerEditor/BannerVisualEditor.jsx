import { useState } from 'react'
import BannerEditorPreview from './BannerEditorPreview.jsx'
import BannerFieldChip from './BannerFieldChip.jsx'
import BannerSlotGrid from './BannerSlotGrid.jsx'
import {
  SUPPORTED_BANNER_FIELD_IDS,
  SUPPORTED_BANNER_SLOTS,
} from '../../library/bannerLayout/bannerLayoutSchema.js'

const fieldIdSet = new Set(SUPPORTED_BANNER_FIELD_IDS)
const slotSet = new Set(SUPPORTED_BANNER_SLOTS)

const BannerVisualEditor = ({
  layout,
  previewGame,
  fieldLabels,
  slotLabels,
  badgeFields,
  fieldRegistry,
  fieldCategories,
  previewMode,
  previewModes,
  onPreviewModeChange,
  onFieldChange,
  onResetField,
}) => {
  const [selectedFieldId, setSelectedFieldId] = useState('title')
  const [selectedSlot, setSelectedSlot] = useState('bottom-center')
  const fields = layout.fields || []
  const selectedField = fields.find((field) => field.id === selectedFieldId) || fields[0]

  const updateField = (fieldId, patch) => {
    if (!fieldIdSet.has(fieldId)) return
    onFieldChange(fieldId, patch)
  }

  const handleDropField = (fieldId, slot) => {
    if (!fieldIdSet.has(fieldId) || !slotSet.has(slot)) return
    setSelectedFieldId(fieldId)
    setSelectedSlot(slot)
    updateField(fieldId, { slot, visible: true })
  }

  const updateConditions = (patch) => {
    if (!selectedField) return
    updateField(selectedField.id, {
      conditions: { ...selectedField.conditions, ...patch },
    })
  }

  const updateSourceCondition = (source, enabled) => {
    const currentSources = Array.isArray(selectedField?.conditions?.source)
      ? selectedField.conditions.source
      : []
    const nextSources = enabled
      ? Array.from(new Set([...currentSources, source]))
      : currentSources.filter((item) => item !== source)
    updateConditions({ source: nextSources })
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-semibold">Visual Editor</h2>
        <p className="text-xs opacity-60">
          Drag field chips into zones. The precise table below remains available for keyboard editing.
        </p>
        <label className="inline-flex items-center gap-2 text-xs mt-2">
          Preview
          <select
            className="bg-secondary border border-border text-text rounded p-1"
            value={previewMode}
            onChange={(event) => onPreviewModeChange(event.target.value)}
          >
            {Object.entries(previewModes).map(([id, mode]) => (
              <option key={id} value={id}>{mode.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[420px_minmax(360px,1fr)_280px] gap-4">
        <div className="space-y-3">
          <BannerEditorPreview game={previewGame} layout={layout} />
          <BannerSlotGrid
            layout={layout}
            fieldLabels={fieldLabels}
            slotLabels={slotLabels}
            selectedSlot={selectedSlot}
            onSelectSlot={setSelectedSlot}
            onDropField={handleDropField}
            onSelectField={setSelectedFieldId}
            onHideField={(fieldId) => updateField(fieldId, { visible: false })}
          />
        </div>

        <div>
          <h3 className="text-sm font-semibold mb-2">Fields</h3>
          <div className="space-y-3 max-h-[640px] overflow-y-auto pr-1">
            {fieldCategories.map((category) => (
              <div key={category}>
                <h4 className="text-xs uppercase tracking-wide opacity-60 mb-1">{category}</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-2 gap-2">
                  {fieldRegistry.filter((meta) => meta.category === category).map((meta) => {
                    const field = fields.find((candidate) => candidate.id === meta.id) || {
                      id: meta.id,
                      slot: meta.defaultSlot || 'bottom-left',
                      visible: false,
                      fontSize: meta.defaultFontSize || 12,
                      badge: false,
                    }
                    return (
                      <BannerFieldChip
                        key={meta.id}
                        field={field}
                        label={fieldLabels[meta.id]}
                        slotLabel={slotLabels[field.slot] || 'Unknown slot'}
                        isSelected={selectedFieldId === meta.id}
                        onSelect={() => setSelectedFieldId(meta.id)}
                        onToggleVisible={() => updateField(meta.id, { visible: field.visible === false })}
                      />
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border border-border rounded p-3 bg-secondary/60 space-y-3">
          <h3 className="text-sm font-semibold">Selected Field</h3>
          {selectedField ? (
            <>
              <div className="font-medium">{fieldLabels[selectedField.id]}</div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedField.visible !== false}
                  onChange={(event) => updateField(selectedField.id, { visible: event.target.checked })}
                />
                Visible
              </label>
              <label className="block text-sm">
                Position
                <select
                  className="mt-1 w-full bg-secondary border border-border text-text rounded p-1"
                  value={selectedField.slot}
                  onChange={(event) => updateField(selectedField.id, { slot: event.target.value, visible: true })}
                >
                  {SUPPORTED_BANNER_SLOTS.map((slot) => (
                    <option key={slot} value={slot}>
                      {slotLabels[slot]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                Font size
                <input
                  type="number"
                  min="8"
                  max="24"
                  className="mt-1 w-full bg-secondary border border-border text-text rounded p-1"
                  value={selectedField.fontSize ?? 12}
                  onChange={(event) => updateField(selectedField.id, { fontSize: Number(event.target.value) })}
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={!badgeFields.has(selectedField.id)}
                  checked={badgeFields.has(selectedField.id) && selectedField.badge === true}
                  onChange={(event) => updateField(selectedField.id, { badge: event.target.checked })}
                />
                Badge style
              </label>
              <button
                type="button"
                className="w-full bg-secondary border border-border text-text px-3 py-1 rounded hover:bg-tertiary"
                onClick={() => onResetField(selectedField.id)}
              >
                Reset this field
              </button>
              <details className="text-sm">
                <summary className="cursor-pointer opacity-80">Advanced conditions</summary>
                <div className="mt-2 space-y-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedField.hideWhenEmpty === true}
                      onChange={(event) => updateField(selectedField.id, { hideWhenEmpty: event.target.checked })}
                    />
                    Hide when empty
                  </label>
                  {[
                    ['localOnly', 'Local only'],
                    ['browseOnly', 'Browse only'],
                    ['wishlistOnly', 'Wishlist only'],
                    ['installedOnly', 'Installed only'],
                    ['uninstalledOnly', 'Uninstalled only'],
                    ['updateOnly', 'Update only'],
                    ['favoriteOnly', 'Favorite only'],
                  ].map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedField.conditions?.[key] === true}
                        onChange={(event) => updateConditions({ [key]: event.target.checked })}
                      />
                      {label}
                    </label>
                  ))}
                  <div>
                    <div className="text-xs opacity-60 mb-1">Source</div>
                    {['atlas', 'f95', 'steam', 'lewdcorner'].map((source) => (
                      <label key={source} className="mr-3 inline-flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={(selectedField.conditions?.source || []).includes(source)}
                          onChange={(event) => updateSourceCondition(source, event.target.checked)}
                        />
                        {source}
                      </label>
                    ))}
                  </div>
                </div>
              </details>
            </>
          ) : (
            <p className="text-sm opacity-60">Select a field to edit it.</p>
          )}
        </div>
      </div>
    </section>
  )
}

export default BannerVisualEditor
