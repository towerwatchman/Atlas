import { builtInSavedFilters, normalizeFilterState } from '../../hooks/useFilters.js'

const SavedFilterRow = ({ filter, count, isActive, onApply, onDelete }) => (
  <div
    className={`group flex items-center gap-2 px-2 py-2 text-sm cursor-pointer hover:bg-selected ${
      isActive ? 'bg-selected' : ''
    }`}
    onClick={() => onApply(filter)}
    title={filter.name}
  >
    <div className="min-w-0 flex-1">
      <div className="truncate text-text">{filter.name}</div>
      <div className="text-[11px] text-gray-400">
        {filter.builtIn ? 'Built-in' : 'Saved'} · {count ?? 0} matches
      </div>
    </div>
    {!filter.builtIn && (
      <button
        className="opacity-0 group-hover:opacity-100 px-2 py-1 text-xs hover:text-[DarkRed]"
        onClick={(event) => {
          event.stopPropagation()
          onDelete(filter)
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

  const deleteFilter = (filter) => {
    if (!filter?.id || filter.builtIn) return
    onDeleteFilter?.(filter)
  }

  return (
    <div className="w-[200px] bg-secondary fixed top-[70px] bottom-[40px] z-40 overflow-y-auto ml-[60px]">
      <div className="px-2 py-3 border-b border-border">
        <div className="font-semibold text-sm">Saved Filters</div>
        <div className="text-[11px] text-gray-400">Click to apply</div>
      </div>

      <div className="py-2">
        <div className="px-2 pb-1 text-[11px] uppercase tracking-wide text-gray-400">
          Built-in
        </div>
        {builtInSavedFilters.map((filter) => (
          <SavedFilterRow
            key={filter.id}
            filter={filter}
            count={counts[filter.id]}
            isActive={activeSavedFilterId === filter.id}
            onApply={applyFilter}
            onDelete={deleteFilter}
          />
        ))}
      </div>

      <div className="py-2 border-t border-border">
        <div className="px-2 pb-1 text-[11px] uppercase tracking-wide text-gray-400">
          Saved
        </div>
        {sortedUserFilters.length === 0 ? (
          <div className="px-2 py-2 text-xs text-gray-400">
            Save the current filters from the filter panel.
          </div>
        ) : (
          sortedUserFilters.map((filter) => (
            <SavedFilterRow
              key={filter.id}
              filter={filter}
              count={counts[filter.id]}
              isActive={activeSavedFilterId === filter.id}
              onApply={applyFilter}
              onDelete={deleteFilter}
            />
          ))
        )}
      </div>
    </div>
  )
}

export default SavedFiltersPanel
