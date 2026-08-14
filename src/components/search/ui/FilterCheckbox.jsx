import React from 'react'

export default function FilterCheckbox({ checked, onChange, label }) {
  return (
    <label className="flex items-center space-x-2 text-sm">
      <input
        type="checkbox"
        checked={Boolean(checked)}
        onChange={onChange}
        className="accent-accent -webkit-app-region-no-drag"
      />
      <span>{label}</span>
    </label>
  )
}
