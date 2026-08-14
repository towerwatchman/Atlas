import React from 'react'
import Collapsible from '../ui/Collapsible.jsx'
import FilterCheckbox from '../ui/FilterCheckbox.jsx'
import FilterDropdown from '../ui/FilterDropdown.jsx'

function SidebarSection({ title, currentMode, filters, selectedFilters, updateFilters }) {
  const visibleFilters = filters.filter((filter) => {
    if (!filter.excludeModes) return true
    return !filter.excludeModes.includes(currentMode)
  })

  if (visibleFilters.length === 0) return null

  // Checkbox filter type
  const renderFilter = (filter) => {
    if (filter.type === 'checkbox') {
      return (
        <FilterCheckbox
          checked={selectedFilters[filter.field]}
          onChange={() => updateFilters({ [filter.field]: !selectedFilters[filter.field] })}
          label={filter.label}
        />
      )
    }

    // Dropdown filter type
    if (filter.type === 'dropdown') {
      return (
        <FilterDropdown
          label={filter.label}
          value={selectedFilters[filter.field]}
          onChange={(e) => filter.onChange?.(e.target.value, { selectedFilters, updateFilters })}
        >
          {filter.options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </FilterDropdown>
      )
    }
    return filter.content
  }

  return (
    <Collapsible title={title}>
      <div className="space-y-3">
        {visibleFilters.map((filter, i) => (
          <React.Fragment key={i}>{renderFilter(filter)}</React.Fragment>
        ))}
      </div>
    </Collapsible>
  )
}

export default SidebarSection
