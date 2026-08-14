import React from 'react'

export default function FilterDropdown({ value, onChange, label, children, className = '' }) {
  return (
    <div>
      {label && <label className="block text-sm mb-1">{label}</label>}
      <select
        className={`w-full p-2 bg-tertiary border border-border rounded text-sm ${className}`}
        value={value}
        onChange={onChange}
      >
        {children}
      </select>
    </div>
  )
}
