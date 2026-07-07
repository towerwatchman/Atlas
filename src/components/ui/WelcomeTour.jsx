import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

// Interactive, mobile-app-style welcome tour for the main window. Dims the
// screen, spotlights one nav button at a time, points an arrow at it, and
// explains what it does. The user can Skip, or step through with the
// Back/Next arrows at the bottom. Auto-shown once on first run (persisted
// in localStorage) and re-launchable from the About modal.
//
// Targets are resolved from the live DOM by `[data-tour="<name>"]`
// attributes that TopNav.jsx and Sidebar.jsx put on each nav button. That
// keeps the tour layout-agnostic: whichever buttons actually exist in the
// current layout (topnav vs sidebar) get a step, and any that don't are
// skipped automatically. Positions recompute on resize so the tour stays
// correct as the window is resized (this is a desktop app, but windows get
// resized aggressively).

export const WELCOME_TOUR_SEEN_KEY = 'atlasWelcomeTourSeen'

// Ordered canonical step list. `target` matches the data-tour attribute on
// the nav button. Steps whose target isn't present in the current layout
// are dropped at open time.
const DEFAULT_STEPS = [
  {
    target: 'Library',
    title: 'Your Library',
    body: 'This is home base. Click here any time to return to your full game library.',
  },
  {
    target: 'Add',
    title: 'Add Games',
    body: 'Import titles into Atlas from your disk or a supported source. Pick a source, then scan and confirm what to add.',
  },
  {
    target: 'List',
    title: 'List & Grid',
    body: 'Toggle the side game list on or off, and switch between a compact list and the banner grid.',
  },
  {
    target: 'Favorites',
    title: 'Favorites',
    body: 'Quick access to the titles you\u2019ve hearted so your go-to games are always one click away.',
  },
  {
    target: 'Updates',
    title: 'Check for Updates',
    body: 'Refresh metadata, tags, and version info from your configured online sources.',
  },
  {
    target: 'Filters',
    title: 'Filters',
    body: 'Narrow your library by tags, engine, rating, release date, and more \u2014 then save filter sets you use often.',
  },
  {
    target: 'Settings',
    title: 'Settings',
    body: 'Customize themes, library paths, metadata sources, launchers, and everything else about how Atlas behaves.',
  },
  {
    target: 'About',
    title: 'About & Help',
    body: 'Find community links, help docs, and this tour again whenever you need it. That\u2019s the tour \u2014 enjoy Atlas!',
  },
]

const TOOLTIP_WIDTH = 300
const EDGE_PAD = 16 // min gap from viewport edge
const TARGET_PAD = 6 // spotlight padding around the target
const GAP = 14 // gap between target and tooltip

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

const WelcomeTour = ({ open, onClose, steps = DEFAULT_STEPS, onStepChange }) => {
  const [activeSteps, setActiveSteps] = useState([])
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState(null)
  const [placement, setPlacement] = useState('bottom')
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 })
  const [arrowLeft, setArrowLeft] = useState(TOOLTIP_WIDTH / 2)
  const tooltipRef = useRef(null)

  // Resolve which steps have a present target, whenever the tour opens.
  // Steps that declare a `tab` are kept even if their target isn't in the DOM
  // yet — the host switches tabs (via onStepChange) which mounts the target.
  useEffect(() => {
    if (!open) return
    const resolved = steps.filter((step) =>
      step.tab || document.querySelector(`[data-tour="${step.target}"]`),
    )
    setActiveSteps(resolved)
    setIndex(0)
  }, [open, steps])

  // Notify the host when the active step changes so it can switch tabs, etc.
  useEffect(() => {
    if (!open) return
    const step = activeSteps[index]
    if (step) onStepChange?.(step, index)
  }, [open, index, activeSteps, onStepChange])

  const finish = useCallback(() => {
    try {
      window.localStorage?.setItem(WELCOME_TOUR_SEEN_KEY, 'true')
    } catch {
      // best-effort persistence only
    }
    onClose?.()
  }, [onClose])

  // Recompute the spotlight + tooltip position for the current step. If the
  // target isn't in the DOM yet (e.g. a tab-gated step whose tab is still
  // switching), retry on the next few frames rather than giving up.
  const recompute = useCallback((attempt = 0) => {
    const step = activeSteps[index]
    if (!step) return
    const el = document.querySelector(`[data-tour="${step.target}"]`)
    if (!el) {
      setRect(null)
      if (attempt < 20) requestAnimationFrame(() => recompute(attempt + 1))
      return
    }
    // Bring the target into view (settings content scrolls).
    try { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) } catch { /* ignore */ }
    const r = el.getBoundingClientRect()
    setRect({
      top: r.top - TARGET_PAD,
      left: r.left - TARGET_PAD,
      width: r.width + TARGET_PAD * 2,
      height: r.height + TARGET_PAD * 2,
      centerX: r.left + r.width / 2,
    })
  }, [activeSteps, index])

  useLayoutEffect(() => {
    if (!open) return
    recompute()
  }, [open, index, activeSteps, recompute])

  // Reposition the tooltip once we know both the target rect and the
  // tooltip's own measured height.
  useLayoutEffect(() => {
    if (!rect) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const th = tooltipRef.current?.offsetHeight || 160
    const tw = Math.min(TOOLTIP_WIDTH, vw - EDGE_PAD * 2)

    // Prefer below the target; flip above if there isn't room.
    const belowTop = rect.top + rect.height + GAP
    const fitsBelow = belowTop + th + EDGE_PAD <= vh
    const nextPlacement = fitsBelow ? 'bottom' : 'top'
    const top = fitsBelow ? belowTop : rect.top - GAP - th

    const left = clamp(rect.centerX - tw / 2, EDGE_PAD, vw - tw - EDGE_PAD)
    const arrow = clamp(rect.centerX - left, 20, tw - 20)

    setPlacement(nextPlacement)
    setTooltipPos({ top: clamp(top, EDGE_PAD, vh - th - EDGE_PAD), left })
    setArrowLeft(arrow)
  }, [rect, index])

  // Keep positions correct on resize.
  useEffect(() => {
    if (!open) return
    const handle = () => recompute()
    window.addEventListener('resize', handle)
    return () => window.removeEventListener('resize', handle)
  }, [open, recompute])

  // Keyboard: Esc skips, arrows navigate.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') finish()
      else if (e.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, activeSteps.length - 1))
      else if (e.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, activeSteps.length, finish])

  if (!open || activeSteps.length === 0) return null

  const step = activeSteps[index]
  const isLast = index === activeSteps.length - 1
  const isFirst = index === 0
  const tw = Math.min(TOOLTIP_WIDTH, window.innerWidth - EDGE_PAD * 2)

  return (
    <div className="fixed inset-0 z-[3000] select-none">
      {/* Dim + spotlight. The huge box-shadow spreading out from the
          transparent hole darkens everything except the highlighted
          button. A click on the dark area does nothing (the tour is
          driven by the tooltip controls). */}
      {rect && (
        <div
          className="absolute rounded-buttonTheme pointer-events-none transition-all duration-200"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.62)',
            outline: '2px solid var(--color-accent)',
            outlineOffset: '2px',
          }}
        />
      )}

      {/* A full-screen catcher below the tooltip so clicks outside don't
          leak to the app, but Esc/controls still work. */}
      <div className="absolute inset-0" onClick={finish} />

      {/* Tooltip card */}
      <div
        ref={tooltipRef}
        className="absolute bg-secondary text-text rounded-cardTheme border border-border shadow-lg"
        style={{ top: tooltipPos.top, left: tooltipPos.left, width: tw }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Arrow */}
        <div
          className="absolute w-3 h-3 bg-secondary border-border rotate-45"
          style={
            placement === 'bottom'
              ? {
                  top: -6,
                  left: arrowLeft - 6,
                  borderLeft: '1px solid var(--color-border)',
                  borderTop: '1px solid var(--color-border)',
                }
              : {
                  bottom: -6,
                  left: arrowLeft - 6,
                  borderRight: '1px solid var(--color-border)',
                  borderBottom: '1px solid var(--color-border)',
                }
          }
        />

        <div className="p-4">
          <div className="flex items-start justify-between gap-3 mb-1">
            <h3 className="text-sm font-semibold text-accent">{step.title}</h3>
            <button
              type="button"
              onClick={finish}
              className="text-xs text-muted hover:text-text transition-colors flex-shrink-0"
            >
              Skip
            </button>
          </div>
          <p className="text-sm text-text/90 leading-relaxed">{step.body}</p>

          <div className="flex items-center justify-between mt-4">
            {/* Step dots */}
            <div className="flex items-center gap-1.5">
              {activeSteps.map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 rounded-themePill transition-all ${
                    i === index ? 'w-4 bg-accent' : 'w-1.5 bg-border'
                  }`}
                />
              ))}
            </div>

            {/* Prev / Next */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIndex((i) => Math.max(i - 1, 0))}
                disabled={isFirst}
                aria-label="Previous"
                className={`w-8 h-8 flex items-center justify-center rounded-buttonTheme transition-colors ${
                  isFirst
                    ? 'text-muted opacity-40 cursor-default'
                    : 'text-text bg-button hover:bg-buttonHover'
                }`}
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {isLast ? (
                <button
                  type="button"
                  onClick={finish}
                  className="h-8 px-3 flex items-center justify-center rounded-buttonTheme bg-accent hover:bg-accentHover text-white text-sm font-medium transition-colors"
                >
                  Done
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setIndex((i) => Math.min(i + 1, activeSteps.length - 1))}
                  aria-label="Next"
                  className="w-8 h-8 flex items-center justify-center rounded-buttonTheme bg-accent hover:bg-accentHover text-white transition-colors"
                >
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default WelcomeTour
