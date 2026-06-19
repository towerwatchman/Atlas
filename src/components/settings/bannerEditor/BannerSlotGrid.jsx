import {
  SUPPORTED_BANNER_FIELD_IDS,
  SUPPORTED_BANNER_SLOTS,
} from '../../library/bannerLayout/bannerLayoutSchema.js'

const normalSlots = [
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
]

const floatingSlots = ['top-left-floating', 'top-right-floating']

const fieldIdSet = new Set(SUPPORTED_BANNER_FIELD_IDS)
const slotSet = new Set(SUPPORTED_BANNER_SLOTS)

const SlotTarget = ({ slot, label, fields, fieldLabels, isSelected, onSelectSlot, onDropField, onSelectField, onHideField }) => (
  <button
    type="button"
    className={`min-h-[76px] rounded border p-2 text-left transition-colors ${
      isSelected ? 'border-accent bg-tertiary' : 'border-border bg-secondary hover:bg-tertiary'
    }`}
    title={`Drop fields into ${label}`}
    onClick={() => onSelectSlot(slot)}
    onDragOver={(event) => {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
    }}
    onDrop={(event) => {
      event.preventDefault()
      const fieldId = event.dataTransfer.getData('text/plain')
      if (!fieldIdSet.has(fieldId) || !slotSet.has(slot)) return
      onDropField(fieldId, slot)
    }}
  >
    <span className="block text-xs font-semibold opacity-80 mb-2">{label}</span>
    <span className="flex flex-wrap gap-1">
      {fields.length === 0 && <span className="text-xs opacity-40">Empty</span>}
      {fields.map((field) => (
        <span
          key={field.id}
          role="button"
          tabIndex={0}
          className="inline-flex items-center gap-1 rounded bg-primary border border-border px-2 py-0.5 text-[10px]"
          onClick={(event) => {
            event.stopPropagation()
            onSelectField(field.id)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              event.stopPropagation()
              onSelectField(field.id)
            }
          }}
        >
          {fieldLabels[field.id]}
          <span
            role="button"
            tabIndex={0}
            className="opacity-70 hover:opacity-100"
            title={`Hide ${fieldLabels[field.id]}`}
            onClick={(event) => {
              event.stopPropagation()
              onHideField(field.id)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                event.stopPropagation()
                onHideField(field.id)
              }
            }}
          >
            x
          </span>
        </span>
      ))}
    </span>
  </button>
)

const BannerSlotGrid = ({ layout, fieldLabels, slotLabels, selectedSlot, onSelectSlot, onDropField, onSelectField, onHideField }) => {
  const visibleFields = (layout.fields || []).filter((field) => field.visible !== false)
  const fieldsForSlot = (slot) => visibleFields.filter((field) => field.slot === slot)

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {normalSlots.map((slot) => (
          <SlotTarget
            key={slot}
            slot={slot}
            label={slotLabels[slot]}
            fields={fieldsForSlot(slot)}
            fieldLabels={fieldLabels}
            isSelected={selectedSlot === slot}
            onSelectSlot={onSelectSlot}
            onDropField={onDropField}
            onSelectField={onSelectField}
            onHideField={onHideField}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {floatingSlots.map((slot) => (
          <SlotTarget
            key={slot}
            slot={slot}
            label={slotLabels[slot]}
            fields={fieldsForSlot(slot)}
            fieldLabels={fieldLabels}
            isSelected={selectedSlot === slot}
            onSelectSlot={onSelectSlot}
            onDropField={onDropField}
            onSelectField={onSelectField}
            onHideField={onHideField}
          />
        ))}
      </div>
    </div>
  )
}

export default BannerSlotGrid

