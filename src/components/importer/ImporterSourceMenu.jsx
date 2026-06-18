import { useEffect, useRef, useState } from 'react'
import { importerSources } from './importerSources.js'

const placementClasses = {
  sidebar: {
    wrapper: 'relative w-full',
    menu: 'absolute left-[calc(100%+8px)] bottom-0 w-56',
  },
  footer: {
    wrapper: 'relative justify-self-start',
    menu: 'absolute left-0 bottom-[calc(100%+8px)] w-56',
  },
  topnav: {
    wrapper: 'relative',
    menu: 'absolute right-0 top-[calc(100%+8px)] w-60',
  },
}

export default function ImporterSourceMenu({
  children,
  placement = 'sidebar',
  onSelect,
  label = 'Choose import source',
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const classes = placementClasses[placement] || placementClasses.sidebar

  useEffect(() => {
    if (!open) return undefined
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const chooseSource = (source) => {
    setOpen(false)
    onSelect?.(source.id)
  }

  return (
    <div ref={rootRef} className={`${classes.wrapper} -webkit-app-region-no-drag`}>
      {children({
        open,
        toggle: () => setOpen((value) => !value),
        buttonProps: {
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          'aria-label': label,
        },
      })}
      {open && (
        <div
          role="menu"
          aria-label={label}
          className={`${classes.menu} z-[1600] border border-border bg-primary shadow-lg rounded p-1 text-text`}
        >
          {importerSources.map((source) => (
            <button
              key={source.id}
              type="button"
              role="menuitem"
              onClick={() => chooseSource(source)}
              className="w-full flex items-center gap-2 rounded px-2 py-2 text-left hover:bg-tertiary focus:bg-tertiary focus:outline-none"
            >
              <span className="w-7 h-7 flex items-center justify-center shrink-0 text-accent">
                {source.iconType === 'image'
                  ? <img src={source.icon} alt="" className="w-5 h-5 object-contain" />
                  : <i className={`${source.icon} text-lg`}></i>}
              </span>
              <span className="min-w-0">
                <span className="block text-sm leading-tight">{source.label}</span>
                <span className="block text-[10px] leading-tight text-muted truncate">{source.description}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
