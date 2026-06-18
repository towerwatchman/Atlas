import { builtInSavedFilters, normalizeFilterState } from '../../hooks/useFilters.js'

const SavedFilterRow = ({
  filter,
  count,
  isActive,
  deleteState,
  onApply,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
}) => (
  <div
    className={`group flex items-start gap-2 px-2 py-2 text-sm cursor-pointer hover:bg-selected ${
      isActive ? 'bg-selected' : ''
    }`}
    onClick={() => onApply(filter)}
    title={filter.name}
  >
    <div className="min-w-0 flex-1">
      <div className="truncate text-text">{filter.name}</div>
      <div className="text-[11px] text-muted">
        {filter.builtIn ? 'Built-in' : 'Saved'} - {count ?? 0} matches
      </div>
      {deleteState?.confirming && (
        <div className="mt-2 flex items-center gap-2 text-[11px]">
          <span className="text-danger">Delete?</span>
          <button
            className="px-2 py-1 bg-danger hover:bg-dangerHover text-white rounded disabled:opacity-50"
            disabled={deleteState.busy}
            onClick={(event) => {
              event.stopPropagation()
              onConfirmDelete(filter)
            }}
          >
            Delete
          </button>
          <button
            className="px-2 py-1 bg-tertiary hover:bg-buttonHover rounded disabled:opacity-50"
            disabled={deleteState.busy}
            onClick={(event) => {
              event.stopPropagation()
              onCancelDelete(filter)
            }}
          >
            Cancel
          </button>
        </div>
      )}
      {deleteState?.error && (
        <div className="mt-1 text-[11px] text-danger">{deleteState.error}</div>
      )}
    </div>
    {!filter.builtIn && (
      <button
        className="opacity-0 group-hover:opacity-100 px-2 py-1 text-xs hover:text-[DarkRed] disabled:opacity-50"
        disabled={deleteState?.busy}
        onClick={(event) => {
          event.stopPropagation()
          onRequestDelete(filter)
        }}
        title="Delete saved filter"
      >
        <i className="fas fa-trash"></i>
      </button>
    )}
  </div>
)

const SavedFiltersPanel = ({
  userSavedFilters = [],
  activeSavedFilterId = '',
  counts = {},
  deleteStateById = {},
  leftOffsetClassName = '',
  onApplyFilter,
  onDeleteFilter,
}) => {
  const sortedUserFilters = [...userSavedFilters].sort((a, b) =>
    String(a?.name || '').localeCompare(String(b?.name || '')),
  )

  const applyFilter = (filter) => {
    if (!filter) return
    onApplyFilter?.({
      ...filter,
      filters: normalizeFilterState(filter.filters),
    })
  }

  const requestDelete = (filter) => {
    if (!filter?.id || filter.builtIn) return
    onDeleteFilter?.(filter, 'request')
  }

  const confirmDelete = (filter) => {
    if (!filter?.id || filter.builtIn) return
    onDeleteFilter?.(filter, 'confirm')
  }

  const cancelDelete = (filter) => {
    if (!filter?.id || filter.builtIn) return
    onDeleteFilter?.(filter, 'cancel')
  }

  const renderRow = (filter) => (
    <SavedFilterRow
      key={filter.id}
      filter={filter}
      count={counts[filter.id]}
      isActive={activeSavedFilterId === filter.id}
      deleteState={deleteStateById[filter.id]}
      onApply={applyFilter}
      onRequestDelete={requestDelete}
      onConfirmDelete={confirmDelete}
      onCancelDelete={cancelDelete}
    />
  )

  return (
    <div className={`w-[200px] bg-secondary fixed top-[70px] bottom-[40px] z-40 overflow-y-auto ${leftOffsetClassName}`}>
      <div className="px-2 py-3 border-b border-border">
        <div className="font-semibold text-sm">Saved Filters</div>
        <div className="text-[11px] text-muted">Click to apply</div>
      </div>

      <div className="py-2">
        <div className="px-2 pb-1 text-[11px] uppercase tracking-wide text-muted">
          Built-in
        </div>
        {builtInSavedFilters.map(renderRow)}
      </div>

      <div className="py-2 border-t border-border">
        <div className="px-2 pb-1 text-[11px] uppercase tracking-wide text-muted">
          Saved
        </div>
        {sortedUserFilters.length === 0 ? (
          <div className="px-2 py-2 text-xs text-muted">
            Save the current filters from the filter panel.
          </div>
        ) : (
          sortedUserFilters.map(renderRow)
        )}
      </div>
    </div>
  )
}

export default SavedFiltersPanel
