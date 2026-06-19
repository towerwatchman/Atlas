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

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-semibold">Visual Editor</h2>
        <p className="text-xs opacity-60">
          Drag field chips into zones. The precise table below remains available for keyboard editing.
        </p>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-2 gap-2">
            {SUPPORTED_BANNER_FIELD_IDS.map((fieldId) => {
              const field = fields.find((candidate) => candidate.id === fieldId) || {
                id: fieldId,
                slot: 'bottom-left',
                visible: false,
                fontSize: 12,
                badge: false,
              }
              return (
                <BannerFieldChip
                  key={fieldId}
                  field={field}
                  label={fieldLabels[fieldId]}
                  slotLabel={slotLabels[field.slot] || 'Unknown slot'}
                  isSelected={selectedFieldId === fieldId}
                  onSelect={() => setSelectedFieldId(fieldId)}
                  onToggleVisible={() => updateField(fieldId, { visible: field.visible === false })}
                />
              )
            })}
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

