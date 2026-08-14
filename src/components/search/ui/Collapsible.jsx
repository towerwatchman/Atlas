import { useState } from 'react'

// Collapsible accordion section — keeps the long filter list scannable so
// the panel isn't one endless scroll (matches the grouped/accordion layout
// of the reference filter sidebars). Each section owns its own open state
// and starts closed unless defaultOpen is set; the most-used sections open
// by default. An optional badge shows a count/summary next to the title.
export default function Collapsible({ title, badge, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between py-3 text-left -webkit-app-region-no-drag"
      >
        <span className="font-bold text-sm flex items-center gap-2">
          {title}
          {badge != null && badge !== "" && (
            <span className="text-[11px] font-normal text-muted">{badge}</span>
          )}
        </span>
        <i className={`fas fa-chevron-down text-xs text-muted transition-transform ${open ? "rotate-180" : ""}`}></i>
      </button>
      {open && <div className="pb-4">{children}</div>}
    </div>
  )
}
