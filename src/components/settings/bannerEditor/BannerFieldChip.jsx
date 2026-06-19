const BannerFieldChip = ({ field, label, slotLabel, isSelected, onSelect, onToggleVisible }) => (
  <button
    type="button"
    draggable
    onDragStart={(event) => {
      event.dataTransfer.setData('text/plain', field.id)
      event.dataTransfer.effectAllowed = 'move'
    }}
    onClick={onSelect}
    className={`w-full text-left border rounded p-2 transition-colors ${
      isSelected ? 'border-accent bg-tertiary' : 'border-border bg-secondary hover:bg-tertiary'
    }`}
    title={`Drag ${label} into a banner slot`}
  >
    <span className="flex items-center justify-between gap-2">
      <span className="font-medium">{label}</span>
      <span className={`text-[10px] ${field.visible === false ? 'opacity-50' : 'text-accent'}`}>
        {field.visible === false ? 'Hidden' : 'Visible'}
      </span>
    </span>
    <span className="block text-xs opacity-60 mt-1">{slotLabel}</span>
    <span
      role="button"
      tabIndex={0}
      className="inline-block mt-2 text-xs underline opacity-80"
      onClick={(event) => {
        event.stopPropagation()
        onToggleVisible()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          event.stopPropagation()
          onToggleVisible()
        }
      }}
    >
      {field.visible === false ? 'Show' : 'Hide'}
    </span>
  </button>
)

export default BannerFieldChip

