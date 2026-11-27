import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import SafeImage from '../ui/SafeImage.jsx'
import { useImageFallback } from '../../hooks/useImageFallback.js'
import HostIcon from './HostIcon.jsx'
import { toMediaSrc } from '../../utils/mediaSrc.js'
import { describeBuild } from './linkSections.js'
import { threadUrlForGame } from './threadUrl.js'
import { keepsBothVersions, downloadBannerTarget, downloadCatalogRef } from './cardFacts.js'

// ── Downloads page ───────────────────────────────────────────────────────────
//
// Full library view, laid out like Steam's downloads screen: throughput stats
// pinned to the header, the active transfer given the top slot with a wide
// progress bar, then "Up next" in queue order, then "Completed" with a clear
// button.
//
// This replaces the floating panel that was here before. A panel was fine
// while the queue was a stub, but downloads are long-running and people leave
// this screen open to watch them - that wants a real view with room for cover
// art and per-item detail, not something anchored over the library.
//
// Throughput is computed here rather than in the main process. The backend
// throttles progress to a few updates a second on purpose, and rate is a
// presentation concern - deriving it from consecutive samples keeps timing
// code out of the transfer loop.

const STATE_LABELS = {
  queued: 'Queued',
  ready: 'Ready to install',
  downloading: 'Downloading',
  paused: 'Paused',
  awaiting_file: 'Waiting for your browser download',
  verifying: 'Verifying',
  extracting: 'Extracting',
  importing: 'Adding to library',
  done: 'Complete',
  failed: 'Failed',
  // Distinct from `failed`: the archive downloaded fine and is still on disk,
  // only the install stumbled. Retry must NOT be offered here -- it deletes
  // the archive -- but Install must stay available.
  install_failed: 'Install failed — archive kept',
  canceled: 'Canceled',
}

const ACTIVE_STATES = ['downloading', 'verifying', 'extracting', 'importing']
const WAITING_STATES = ['queued', 'paused', 'awaiting_file', 'failed', 'install_failed', 'ready']
const FINISHED_STATES = ['done', 'canceled']

// Item events carry one row at a time, not a full ordered list. Re-sort on each
// event to keep the rendered order equal to what listDownloads returns.
const sortItems = (list) => list.slice().sort((a, b) => {
  const aDone = FINISHED_STATES.includes(a.state) ? 1 : 0
  const bDone = FINISHED_STATES.includes(b.state) ? 1 : 0
  if (aDone !== bDone) return aDone - bDone
  const order = (a.queueOrder || 0) - (b.queueOrder || 0)
  return order || (a.id || 0) - (b.id || 0)
})

// How long the scrollbar stays up after the last scroll event, or after the
// cursor leaves the scroll zone. Long enough that a pause mid-scroll or a small
// overshoot past the edge does not flicker it, short enough that it does not
// linger over the list.
const SCROLLBAR_HIDE_DELAY_MS = 500
// Width of the right-side band that counts as "reaching for the scrollbar".
// Wider than the 12px bar itself so the bar appears before the cursor is on
// top of it -- it cannot be aimed at while invisible.
const SCROLLBAR_ZONE_PX = 60
const WORKING_STATES = ['verifying', 'extracting', 'importing']

const formatBytes = (value) => {
  const bytes = Number(value) || 0
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const scaled = bytes / 1024 ** index
  return `${scaled.toFixed(index === 0 ? 0 : scaled >= 10 ? 1 : 2)} ${units[index]}`
}

const formatRate = (bytesPerSecond) =>
  bytesPerSecond > 0 ? `${formatBytes(bytesPerSecond)}/s` : '0 B/s'

const formatEta = (seconds) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  if (seconds < 60) return `${Math.round(seconds)} sec left`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min left`
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  return `${hours} hr ${minutes} min left`
}

const formatWhen = (timestamp) => {
  if (!timestamp) return ''
  const date = new Date(timestamp * 1000)
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return sameDay
    ? `Today ${time}`
    : `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`
}

// Banners can be video as well as still images. Matching the library's
// convention: GIF is an image and animates in an <img> on its own, only
// mp4/webm need a <video>. Rendering a video url in an <img> yields a broken
// icon, which is what the downloads list was doing.
const VIDEO_EXTENSIONS = /\.(mp4|webm|m4v|mov)$/i
const isVideoUrl = (url) =>
  typeof url === 'string' && VIDEO_EXTENSIONS.test(url.split(/[?#]/)[0])

// Wide capsule, same proportions Steam uses in this list.
// Same chain GameBanner uses. banner_candidates lists every known source for
// a game's art in preference order; banner_url is just its head, and for a
// Steam-sourced entry that head is a CDN url that does not load.
const bannerChainFor = (game) =>
  game?.banner_candidates || (game?.banner_url ? [game.banner_url] : [])

// The game object first, the download row second.
//
// `game` comes out of gamesByRecordId, which is built from the library list the
// renderer currently has LOADED AND FILTERED. When it has the game, its chain is
// the better one: it has been through db/mediaSources.js applyMediaSources(),
// which reorders candidates per the user's Metadata.sourceOrder. The row's chain
// (db/downloadArt.js) resolves the same sources but in the SQL default order,
// because source order is config the queue layer has no business reading.
//
// So preferring `game` means nothing that worked before changes, and falling
// back to the row means everything that showed a grey gamepad icon now shows
// art: a download for a game outside the current filter, and any Browse or
// wishlist download, which has no record_id to look up at all.
const coverChainFor = (game, item) => {
  const fromGame = bannerChainFor(game)
  if (fromGame.length > 0) return fromGame
  return item?.bannerCandidates || []
}

const Cover = memo(function Cover({ game, item, title }) {
  // Walks the chain and settles on the first url that actually loads, which is
  // exactly what the library grid does.
  const { src: raw } = useImageFallback(coverChainFor(game, item))
  const [failed, setFailed] = useState(false)
  const video = isVideoUrl(raw)

  return (
    <div className="w-[120px] sm:w-[160px] aspect-[184/69] shrink-0 rounded overflow-hidden bg-tertiary border border-border">
      {raw && !failed ? (
        video ? (
          // Only mp4/webm need a video element. Muted + playsInline so it can
          // autoplay; a banner that needs a click to move would be worse than
          // a still. toMediaSrc is applied here because SafeImage does it
          // internally and this branch bypasses it.
          <video
            src={toMediaSrc(raw)}
            className="w-full h-full object-cover"
            autoPlay
            loop
            muted
            playsInline
            onError={() => setFailed(true)}
          />
        ) : (
          // GIF, AVIF, WebP and stills all go through here. SafeImage handles
          // the scheme rewrite and its own fallback.
          <SafeImage
            src={raw}
            alt=""
            className="w-full h-full object-cover"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={() => {
              // Reached only when every candidate in the chain has failed.
              console.warn('[downloads] no usable banner', {
                title,
                tried: coverChainFor(game, item),
              })
            }}
          />
        )
      ) : (
        <div className="w-full h-full flex items-center justify-center text-muted">
          <i className="fas fa-gamepad text-lg" aria-hidden="true"></i>
        </div>
      )}
      <span className="sr-only">{title}</span>
    </div>
  )
})

// Declared at module scope, NOT inside DownloadsPage. A component defined in a
// render body is a brand new type every render, so React remounts its whole
// subtree rather than updating it - which reloads banners and restarts
// animations. That was the cause of the flashing GIFs.
function Section({ title, count, children, action, collapsed = false, onToggle, onReverse, sectionId, stuck = false }) {
  return (
    <section>
      {/* The tall fill belongs only to a stuck header; otherwise it paints over the previous section's last row. */}
      <div data-section-header={sectionId} className={`sticky top-0 z-20 -mx-4 px-4 sm:-mx-6 sm:px-6 bg-secondary pt-2 flex items-center gap-3 relative before:absolute before:inset-x-0 before:bottom-full ${stuck ? 'before:h-16' : 'before:h-2'} before:bg-secondary before:content-['']`}>
        <h2 className="text-lg text-text whitespace-nowrap flex items-center gap-2">
          {onToggle ? (
            <button
              type="button"
              onClick={onToggle}
              aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${title}`}
              className="flex items-center gap-1 text-lg text-text whitespace-nowrap"
            >
              {title} <span className="text-muted text-base">({count})</span>
              <i className={`fas fa-chevron-${collapsed ? 'down' : 'up'} text-xs text-muted`} aria-hidden="true" />
            </button>
          ) : (
            <>{title} <span className="text-muted text-base">({count})</span></>
          )}
          {onReverse && (
            <button
              type="button"
              onClick={onReverse}
              aria-label={`Reverse ${title} order`}
              title={`Reverse ${title} order`}
              className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-tertiary text-muted hover:text-text"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-arrow-up-down"><path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/></svg>
            </button>
          )}
        </h2>
        <div className="flex-1 h-px bg-border" />
        {action}
      </div>
      {!collapsed && <div className="mt-[13px]">{children}</div>}
    </section>
  )
}

// ── 4. Throughput graph ──────────────────────────────────────────────────────
// Aggregate across active transfers, matching Steam's. Per-item lines were the
// alternative; aggregate is what the screenshot shows and stays readable when
// several downloads run at once.
//
// Drawn as an SVG path rather than a canvas so it inherits theme colours and
// scales with the layout without a resize observer.
function SpeedGraph({ samples, current, peak }) {
  const width = 600
  const height = 64
  // Scale to the window's own peak, not the session peak: a graph flattened
  // by one earlier burst tells you nothing about what is happening now.
  const windowPeak = Math.max(1, ...samples)
  const step = samples.length > 1 ? width / (samples.length - 1) : width

  const points = samples.map((value, index) => {
    const x = index * step
    const y = height - (value / windowPeak) * (height - 6) - 3
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const line = points.length > 1 ? `M${points.join(' L')}` : ''
  const area = line ? `${line} L${width},${height} L0,${height} Z` : ''

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wide text-muted">Download speed</span>
        <span className="text-sm text-text tabular-nums">{formatRate(current)}</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full h-16 block"
        role="img"
        aria-label={`Download speed, currently ${formatRate(current)}`}
      >
        <defs>
          <linearGradient id="dlspeed" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((fraction) => (
          <line
            key={fraction}
            x1="0" x2={width}
            y1={height * fraction} y2={height * fraction}
            stroke="currentColor" strokeOpacity="0.08" strokeWidth="1"
            className="text-text"
          />
        ))}
        {area && <path d={area} fill="url(#dlspeed)" className="text-accent" />}
        {line && (
          <path
            d={line}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
            className="text-accent"
          />
        )}
      </svg>
      <div className="flex justify-between mt-1 text-[10px] text-muted">
        <span>60s</span>
        <span>peak {formatRate(peak)}</span>
      </div>
    </div>
  )
}

function ProgressBar({ percent, indeterminate = false, tone = 'accent' }) {
  const tones = { accent: 'bg-accent', success: 'bg-success', danger: 'bg-danger' }
  return (
    <div className="h-1.5 w-full rounded-full bg-tertiary overflow-hidden">
      {indeterminate ? (
        <div className={`h-full w-1/3 ${tones[tone]} animate-pulse`} />
      ) : (
        <div
          className={`h-full ${tones[tone]} transition-[width] duration-300`}
          style={{ width: `${Math.max(0, Math.min(100, percent || 0))}%` }}
        />
      )}
    </div>
  )
}

// `wide` reserves room for a throughput reading, whose width changes constantly
// as the rate moves - without it the header shifts on every sample. It is opt-in
// rather than applied to every Stat: "Active" is usually a single digit, and
// forcing 86px on it left an obvious dead gap before the folder button.
//
// tabular-nums keeps digits the same width, so a changing value no longer nudges
// its neighbours even within the reserved space.
function Stat({ label, value, accent, wide = false }) {
  return (
    <div className={wide ? 'min-w-[86px]' : ''}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted whitespace-nowrap">
        <span className={`inline-block w-2 h-[3px] rounded-full ${accent}`} />
        {label}
      </div>
      <div className="text-sm text-text font-medium mt-0.5 tabular-nums">{value}</div>
    </div>
  )
}

function Action({ icon, title, onClick, tone = 'default', disabled }) {
  const tones = { default: 'text-muted hover:text-text', danger: 'text-muted hover:text-danger' }
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className={`h-8 w-8 inline-flex items-center justify-center rounded hover:bg-tertiary disabled:opacity-40 disabled:cursor-not-allowed ${tones[tone]}`}
    >
      <i className={`fas ${icon} text-sm`} aria-hidden="true"></i>
    </button>
  )
}

// onRequestInstall hands an item to InstallFlowHost, which owns the install
// dialog and its setup prompts at App level now. They used to live here, which
// meant they could only be shown on this screen - and the whole point of the
// "prompt me when a download finishes" setting is that a download can finish
// while the user is somewhere else entirely. See InstallFlowHost.jsx.
export default function DownloadsPage({ gamesByRecordId = new Map(), onOpenGame, onRequestInstall }) {
  const [items, setItems] = useState([])
  const [rates, setRates] = useState({})
  // Mirror of `rates` for the sampling interval, so the timer is created once
  // rather than torn down and rebuilt on every progress update.
  const ratesRef = useRef({})
  const [busyId, setBusyId] = useState(null)
  const [folder, setFolder] = useState('')
  const samplesRef = useRef(new Map())
  const peakRef = useRef(0)
  // 60 one-second samples of aggregate throughput. Kept in state rather than a
  // ref because the graph has to re-render as it fills.
  const [speedHistory, setSpeedHistory] = useState(() => new Array(60).fill(0))

  const [showScrollbar, setShowScrollbar] = useState(false)
  // Session-only: a drag that never drops must not touch the persisted order.
  const [previewIds, setPreviewIds] = useState(null)
  // The commit frame must snap into place; the transition is only for the drag preview.
  const [settling, setSettling] = useState(false)
  // Native drag leaves :hover stuck. The landing slot keeps an inline
  // highlight until an ordinary mouse move gives hover back to CSS.
  const [highlightSlot, setHighlightSlot] = useState(null)
  // A native mousemove fires right after a drop. Ignore clears for a short
  // window so the slot highlight survives it, then let CSS hover take over.
  const suppressMouseMoveUntilRef = useRef(0)
  // Chromium hides dataTransfer data during dragover. The hover preview
  // reads the dragged id from here; drop still uses the transfer payload.
  const draggedIdRef = useRef(null)
  // Row boxes captured at drag start. Hit-testing against these stays stable
  // while the preview shifts rows visually. The target never becomes the
  // dragged row the way it did when native dragover followed the reordered DOM.
  const rowRectsRef = useRef([])
  // The captured tops are viewport-relative. Pointer Y needs the change in
  // scroll position since the boxes were taken before it can hit-test them.
  const scrollTopRef = useRef(0)
  const scrollRef = useRef(null)
  const [stuckHeader, setStuckHeader] = useState(null)
  // Collapse is session-only; the order itself is persisted by the reorder IPC.
  const [collapsed, setCollapsed] = useState({ upNext: false, completed: false })

  // A header counts as stuck only when it sits at the scroller's top padding.
  const refreshStuckHeader = useCallback(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const stuckTop = scroller.getBoundingClientRect().top + 8
    const header = [...scroller.querySelectorAll('[data-section-header]')].find((element) =>
      Math.abs(element.getBoundingClientRect().top - stuckTop) <= 1,
    )
    setStuckHeader(header?.dataset.sectionHeader ?? null)
  }, [])

  const toggleSection = (key) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))
    // A shorter section may not clamp scrollTop, leaving its sticky header
    // above the pane. Pull it back after layout.
    requestAnimationFrame(() => {
      const scroller = scrollRef.current
      const header = scroller?.querySelector(`[data-section-header="${key}"]`)
      if (header) {
        const delta = header.getBoundingClientRect().top - scroller.getBoundingClientRect().top
        if (delta < 0) scroller.scrollTop += delta
      }
      refreshStuckHeader()
    })
  }

  const refresh = useCallback(async () => {
    try {
      const result = await window.electronAPI.downloadsList?.({ includeFinished: true })
      if (result?.success) setItems(result.items || [])
    } catch (err) {
      console.warn('Could not load downloads:', err.message)
    }
  }, [])

  useEffect(() => {
    refresh()
    window.electronAPI.downloadsFolder?.().then((result) => {
      if (result?.success) setFolder(result.path)
    }).catch(() => {})
  }, [refresh])

  // The install dialog lives in InstallFlowHost at App level now, so it cannot
  // call this page's refresh() directly the way it did when it was mounted here.
  useEffect(() => {
    const onRefresh = () => refresh()
    window.addEventListener('atlas:downloads-refresh', onRefresh)
    return () => window.removeEventListener('atlas:downloads-refresh', onRefresh)
  }, [refresh])

  useEffect(() => {
    const applyItem = (item) => {
      if (!item?.id) return
      setItems((prev) => {
        const index = prev.findIndex((entry) => entry.id === item.id)
        if (index === -1) return sortItems([...prev, item])
        const next = prev.slice()
        next[index] = item
        return sortItems(next)
      })
      const previous = samplesRef.current.get(item.id)
      const stamp = Date.now()
      if (previous && item.state === 'downloading') {
        const elapsed = (stamp - previous.stamp) / 1000
        const gained = (item.receivedBytes || 0) - previous.bytes
        if (elapsed >= 0.25 && gained >= 0) {
          setRates((prev) => {
            const next = { ...prev, [item.id]: gained / elapsed }
            ratesRef.current = next
            return next
          })
        }
      }
      samplesRef.current.set(item.id, { bytes: item.receivedBytes || 0, stamp })
    }
    const offs = [
      window.electronAPI.onDownloadAdded?.(applyItem),
      window.electronAPI.onDownloadUpdated?.(applyItem),
      window.electronAPI.onDownloadRemoved?.(({ id }) => {
        setItems((prev) => prev.filter((entry) => entry.id !== id))
        samplesRef.current.delete(id)
      }),
      window.electronAPI.onDownloadsChanged?.(() => refresh()),
    ]
    return () => offs.forEach((off) => { if (typeof off === 'function') off() })
  }, [refresh])

  // Fixed 1s tick so the x-axis is real time. Sampling on progress events
  // instead would make the axis depend on transfer speed, which is exactly the
  // variable being plotted.
  useEffect(() => {
    const timer = setInterval(() => {
      const total = Object.values(ratesRef.current).reduce((sum, rate) => sum + rate, 0)
      setSpeedHistory((prev) => [...prev.slice(1), total])
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const act = useCallback(async (action, id) => {
    setBusyId(id)
    try {
      await window.electronAPI.downloadsAction?.({ action, id })
    } finally {
      setBusyId(null)
    }
  }, [])

  // Drop rate entries for anything no longer downloading, otherwise a finished
  // transfer keeps contributing its last speed to the aggregate indefinitely.
  useEffect(() => {
    const live = new Set(items.filter((i) => i.state === 'downloading').map((i) => i.id))
    const pruned = Object.fromEntries(
      Object.entries(ratesRef.current).filter(([id]) => live.has(Number(id))),
    )
    ratesRef.current = pruned
  }, [items])

  // Scrollbar visibility: hidden by default, shown via the `scrollbar-visible`
  // class while scrolling or while the cursor is in the right-side scroll zone.
  // SCROLLBAR_HIDE_DELAY_MS keeps it up briefly after scrolling stops or the
  // cursor leaves the zone, so a pause mid-scroll or a small overshoot past the
  // edge does not make it flicker. No CSS `:hover` -- that would show it
  // anywhere over the list rather than only near the scrollbar itself.
  const hideTimerRef = useRef(null)
  const scrollingRef = useRef(false)
  const inZoneRef = useRef(false)

  const updateVisibility = useCallback(() => {
    setShowScrollbar(scrollingRef.current || inZoneRef.current)
  }, [])

  // One place that schedules the hide, so the two triggers cannot drift apart.
  // Whichever reason is still true when it fires keeps the bar up, because
  // updateVisibility reads BOTH flags.
  const scheduleHide = useCallback((clear) => {
    clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => {
      clear()
      updateVisibility()
    }, SCROLLBAR_HIDE_DELAY_MS)
  }, [updateVisibility])

  const handleScroll = useCallback(() => {
    scrollingRef.current = true
    updateVisibility()
    refreshStuckHeader()
    scheduleHide(() => { scrollingRef.current = false })
  }, [updateVisibility, scheduleHide, refreshStuckHeader])

  const handleMouseMove = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const inZone = e.clientX >= rect.right - SCROLLBAR_ZONE_PX
    if (inZone === inZoneRef.current) {
      // No edge crossing. While in the zone the bar must not time out, so any
      // pending hide is cancelled on every move.
      if (inZone) clearTimeout(hideTimerRef.current)
      return
    }
    if (inZone) {
      inZoneRef.current = true
      clearTimeout(hideTimerRef.current)
      updateVisibility()
      return
    }
    // Left the zone. The flag stays TRUE until the timer clears it: clearing it
    // here would make a re-entry during the grace period read as a fresh edge
    // crossing rather than "still in the zone", restarting the whole cycle.
    scheduleHide(() => { inZoneRef.current = false })
  }, [updateVisibility, scheduleHide])

  const handleMouseLeave = useCallback(() => {
    // Only the zone is cleared here; a scroll still in its grace period keeps
    // the bar up on its own timer.
    if (!inZoneRef.current) return
    scheduleHide(() => { inZoneRef.current = false })
  }, [scheduleHide])

  useEffect(() => () => clearTimeout(hideTimerRef.current), [])

  // An install already running. The main process refuses a second one, so the
  // button reflects that instead of letting the user find out by clicking. The
  // states are the ones downloads-install sets while it works.
  const installingItem = useMemo(
    () => items.find((item) => item.state === 'extracting' || item.state === 'importing') || null,
    [items],
  )

  const { current, upNext, finished } = useMemo(() => ({
    current: items.filter((item) => ACTIVE_STATES.includes(item.state)),
    upNext: items.filter((item) => WAITING_STATES.includes(item.state)),
    finished: items.filter((item) => FINISHED_STATES.includes(item.state)),
  }), [items])

  // A section can vanish without a scroll (Clear All), leaving its header
  // flagged after it unmounts. Recompute once layout settles.
  useEffect(() => {
    const frame = requestAnimationFrame(() => refreshStuckHeader())
    return () => cancelAnimationFrame(frame)
  }, [current.length, upNext.length, finished.length, collapsed, refreshStuckHeader])

  // Combined throughput across live transfers, plus a session peak. Peak is
  // kept in a ref so it survives re-renders without becoming state churn.
  const totalRate = current.reduce((sum, item) => sum + (rates[item.id] || 0), 0)
  if (totalRate > peakRef.current) peakRef.current = totalRate

  const commitOrder = async (ids) => {
    await window.electronAPI.downloadsReorder?.({ ids })
    // Read the rewritten order before the next action can use it.
    await refresh()
  }

  const reverseOrder = (ids) => commitOrder([...ids].reverse())

  // Preview and drop share this so the rows shift to exactly where the
  // released order will put them. Reading upNext (not the preview) keeps the
  // result aligned with what is stored after a Reverse or a live event.
  const proposeOrder = (draggedId, targetId) => {
    if (!Number.isInteger(draggedId)) return null
    const ids = upNext.map((row) => row.id)
    if (!ids.includes(draggedId) || draggedId === targetId) return null
    const next = ids.filter((id) => id !== draggedId)
    if (!next.includes(targetId)) return null
    // A downward drag starts above the target and must land after it.
    // Inserting before would leave the order unchanged until the next row.
    const afterTarget = ids.indexOf(draggedId) < ids.indexOf(targetId)
    next.splice(next.indexOf(targetId) + (afterTarget ? 1 : 0), 0, draggedId)
    if (next.every((id, index) => id === ids[index])) return null
    return next
  }

  // Geometry comes from the boxes captured when the drag began, not from the
  // element under the pointer: during a preview the DOM keeps its order while
  // rows move visually. Hit-testing the live element picks the dragged row.
  const targetFromPointer = (clientY) => {
    const rows = rowRectsRef.current
    const scrollDelta = (scrollRef.current?.scrollTop || 0) - scrollTopRef.current
    const y = clientY + scrollDelta
    let target = null
    if (rows.length) {
      target = y < rows[0].top
        ? rows[0].id
        : rows.find((row) => y >= row.top && y < row.top + row.pitch)?.id
          ?? rows[rows.length - 1].id
    }
    return target
  }

  // Each row stays in its committed slot and travels to the slot it will hold
  // after the drop. Distances are the captured slot pitches (top to next top),
  // which include the gap between rows. Rows land where the drop puts them.
  const pitchById = new Map(rowRectsRef.current.map(({ id, pitch }) => [id, pitch]))
  const displayIds = previewIds || upNext.map((row) => row.id)
  const offsetFor = (item, pitches) => {
    if (!previewIds) return 0
    const committed = upNext.map((row) => row.id)
    const from = committed.indexOf(item.id)
    const to = previewIds.indexOf(item.id)
    if (from < 0 || to < 0) return 0
    const pitchOf = (id) => pitches.get(id) || 0
    const slotTop = (ids, index) => ids.slice(0, index).reduce((sum, id) => sum + pitchOf(id), 0)
    return slotTop(previewIds, to) - slotTop(committed, from)
  }

  useEffect(() => {
    if (!settling) return
    const frame = requestAnimationFrame(() => setSettling(false))
    return () => cancelAnimationFrame(frame)
  }, [settling])

  const handleDragOver = (event) => {
    event.preventDefault()
    if (!previewIds) return
    const targetId = targetFromPointer(event.clientY)
    setHighlightSlot(upNext.findIndex((row) => row.id === targetId))
    const next = proposeOrder(draggedIdRef.current, targetId)
    if (!next) return
    setPreviewIds((prev) => (
      prev && prev.length === next.length && next.every((id, index) => id === prev[index])
        ? prev
        : next
    ))
  }

  const handleDrop = (event) => {
    event.preventDefault()
    const draggedId = Number(event.dataTransfer.getData('text/plain'))
    const targetId = targetFromPointer(event.clientY)
    const committed = upNext.map((row) => row.id)
    const targetIndex = committed.indexOf(targetId)
    const next = proposeOrder(draggedId, targetId)
    suppressMouseMoveUntilRef.current = performance.now() + 300
    setHighlightSlot(targetIndex)
    if (next) {
      // Show the dropped order while the IPC and its refresh are still in flight.
      setItems((prev) => {
        const byId = new Map(prev.map((item) => [item.id, item]))
        const moved = next.map((id, index) => ({ ...byId.get(id), queueOrder: index + 1 }))
        return sortItems([...moved, ...prev.filter((item) => !next.includes(item.id))])
      })
      commitOrder(next)
    }
    setSettling(true)
    setPreviewIds(null)
    rowRectsRef.current = []
    draggedIdRef.current = null
  }

  const renderItem = (item, { featured = false, draggable = false } = {}) => {
    // gamesByRecordId is a Map keyed by Number(record_id), not a plain object.
    // Bracket access on a Map silently returns undefined, which is why the
    // cover art never appeared.
    const game = item.recordId ? gamesByRecordId.get(Number(item.recordId)) || null : null
    const rate = rates[item.id] || 0
    const remaining = item.totalBytes > 0 && rate > 0
      ? (item.totalBytes - item.receivedBytes) / rate
      : null
    const transferring = item.state === 'downloading'
    // Banner stays in-app. Installed opens the library entry, otherwise the Browse entry when known.
    const catalogRef = downloadCatalogRef(item, game)
    const bannerTarget = downloadBannerTarget({ game, catalogRef })
    const hostUrl = /^https?:\/\//i.test(String(item.url || '')) ? item.url : ''
    const threadUrl = threadUrlForGame(game)
    const buildDesc = describeBuild(item.buildLabel)
    const buildChipClass = 'inline-block max-w-full truncate rounded border border-border bg-tertiary/50 px-1.5 py-0.5 text-[11px] text-text'
    const working = WORKING_STATES.includes(item.state)
    const errored = item.state === 'failed' || item.state === 'install_failed'
    const tone = errored ? 'danger' : item.state === 'done' ? 'success' : 'accent'

    return (
      <div
        key={item.id}
        data-download-row={draggable ? item.id : undefined}
        style={draggable ? {
          transform: `translateY(${offsetFor(item, pitchById)}px)`,
          transition: settling || (previewIds && draggedIdRef.current === item.id)
            ? 'none'
            : 'transform 180ms ease',
          ...(highlightSlot === displayIds.indexOf(item.id) ? {
            backgroundColor: 'var(--color-selected)',
            boxShadow: 'inset 0 0 0 1px var(--color-accent)',
          } : {}),
        } : undefined}
        className="group flex items-center gap-3 sm:gap-4 p-3 mb-2 rounded-lg border border-border bg-secondary transition-colors cursor-default hover:bg-selected hover:border-accent"
      >
        <button
          type="button"
          onClick={async () => {
            if (bannerTarget === 'game') onOpenGame?.(game)
            else if (bannerTarget === 'catalog') {
              const result = await window.electronAPI.getCatalogEntry?.(catalogRef)
              if (result?.success) onOpenGame?.(result.game)
            }
          }}
          disabled={!bannerTarget}
          title={bannerTarget ? 'Open game entry in Atlas' : undefined}
          className={bannerTarget ? 'cursor-pointer' : 'cursor-default'}
        >
          <Cover game={game} item={item} title={item.title} />
        </button>

        <div className="flex-1 min-w-0">
          <div className={`truncate text-text ${featured ? 'text-base' : 'text-sm'}`}>
            {item.title}
            {item.version && <span className="text-text text-sm"> · {item.version}</span>}
          </div>

          {/* WHICH build this is. A chip rather than more dot-separated text:
              version is the game's number and this is the poster's heading, and
              running them together is what made an old season, a compressed
              build and the current one three identical-looking rows. Rendered
              only when the row actually recorded one - see describeBuild. */}
          {buildDesc && (
            <div className="mt-1">
              {threadUrl || catalogRef ? (
                <button
                  type="button"
                  onClick={async () => {
                    const url = threadUrl
                      || threadUrlForGame((await window.electronAPI.getCatalogEntry?.(catalogRef))?.game)
                    if (url) window.electronAPI.openExternalUrl?.(url)
                  }}
                  title="Open source thread for this download"
                  className={`${buildChipClass} cursor-pointer hover:bg-highlight hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-accent`}
                >
                  {buildDesc}
                </button>
              ) : (
                <span className={buildChipClass}>{buildDesc}</span>
              )}
            </div>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-text">
            <span className={errored ? 'text-danger' : ''}>
              {STATE_LABELS[item.state] || item.state}
            </span>
            {item.totalBytes > 0 && (
              <span>
                {item.state === 'done'
                  ? `${formatBytes(item.totalBytes)} downloaded`
                  : `${formatBytes(item.receivedBytes)} / ${formatBytes(item.totalBytes)}`}
              </span>
            )}
            {transferring && <span className="text-text">{formatRate(rate)}</span>}
            {transferring && remaining && <span>{formatEta(remaining)}</span>}
            {item.host && (
              hostUrl ? (
                // -mx-1 px-1 py-0.5 keeps the text aligned with the other chips
                // in this row while giving the control a real hit area: the row
                // is text-xs, which is well under a comfortable touch target,
                // and bare text that is secretly clickable is worse than no
                // link at all.
                <button
                  type="button"
                  onClick={() => window.electronAPI.openExternalUrl?.(hostUrl)}
                  title={`Open this download's page on ${item.host}`}
                  className="-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 text-inherit hover:bg-highlight hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                >
                  <HostIcon host={item.host} />
                  {item.host}
                </button>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <HostIcon host={item.host} />
                  {item.host}
                </span>
              )
            )}
            {keepsBothVersions(item, game) && <span>keeps both versions</span>}
            {item.state === 'done' && item.completedAt && (
              <span>{formatWhen(item.completedAt)}</span>
            )}
            {item.state === 'done' && !item.installedAt && item.filePath && (
              <span className="text-amber-400">downloaded, not installed</span>
            )}
          </div>

          {item.error && <div className="mt-1 text-xs text-danger break-words">{item.error}</div>}

          {item.state === 'awaiting_file' && (
            // The masked-link case. Says plainly what Atlas is waiting on, so
            // this does not read as a stalled transfer.
            <div className="mt-1 text-xs text-text">
              Finish the download in your browser — Atlas will pick the file up
              from the downloads folder.
              <button
                type="button"
                onClick={() => window.electronAPI.downloadsAttachFile?.({ id: item.id })}
                className="ml-1 text-accent hover:underline"
              >
                Or choose the file
              </button>
            </div>
          )}

          {/* No width cap on the bar below. `max-w-2xl` stopped it well short of
              the card on any reasonably sized window; the details column already
              ends where the action buttons begin, so filling it is the full width
              actually available. */}
          {(transferring || working || item.state === 'paused') && (
            <div className="mt-2 w-full">
              <ProgressBar
                percent={item.percent ?? 0}
                indeterminate={working || (transferring && item.percent === null)}
                tone={tone}
              />
            </div>
          )}
        </div>

        <div className="flex items-center shrink-0">
          {draggable && (
            <button
              type="button"
              draggable
              title="Drag to reorder"
              aria-label="Drag to reorder"
              onDragStart={(event) => {
                event.dataTransfer.setData('text/plain', String(item.id))
                event.dataTransfer.effectAllowed = 'move'
                draggedIdRef.current = item.id
                scrollTopRef.current = scrollRef.current?.scrollTop || 0
                const rows = [...document.querySelectorAll('[data-download-row]')]
                const grabbedRow = rows.find((row) => Number(row.dataset.downloadRow) === item.id)
                if (grabbedRow) {
                  const rect = grabbedRow.getBoundingClientRect()
                  event.dataTransfer.setDragImage?.(
                    grabbedRow, event.clientX - rect.left, event.clientY - rect.top,
                  )
                }
                rowRectsRef.current = rows.map((row, index) => {
                  const rect = row.getBoundingClientRect()
                  const nextTop = rows[index + 1]?.getBoundingClientRect().top
                  const margin = parseFloat(getComputedStyle(row).marginBottom) || 0
                  return {
                    id: Number(row.dataset.downloadRow),
                    top: rect.top,
                    pitch: nextTop === undefined ? rect.height + margin : nextTop - rect.top,
                  }
                })
                setPreviewIds(upNext.map((row) => row.id))
              }}
              onDragEnd={() => {
                setPreviewIds(null)
                // A drop picked the landing slot; keep its highlight until the
                // mousemove guard expires and CSS hover takes over.
                if (performance.now() >= suppressMouseMoveUntilRef.current) setHighlightSlot(null)
                rowRectsRef.current = []
                draggedIdRef.current = null
              }}
              className="h-8 w-8 inline-flex items-center justify-center rounded hover:bg-tertiary disabled:opacity-40 disabled:cursor-not-allowed text-muted hover:text-text"
            >
              <i className="fas fa-grip-vertical text-sm" aria-hidden="true"></i>
            </button>
          )}
          {transferring && (
            <Action icon="fa-pause" title="Pause" onClick={() => act('pause', item.id)} disabled={busyId === item.id} />
          )}
          {item.state === 'paused' && (
            <Action icon="fa-play" title="Resume" onClick={() => act('resume', item.id)} disabled={busyId === item.id} />
          )}
          {item.state === 'failed' && (
            <Action icon="fa-rotate-right" title="Retry" onClick={() => act('retry', item.id)} disabled={busyId === item.id} />
          )}
          {/* `installable` covers both a fresh `ready` item and a `done` one
              whose archive is still on disk but was never installed - which is
              every download from before the install step existed. */}
          {item.installable && (
            <button
              type="button"
              onClick={() => onRequestInstall?.(item)}
              disabled={Boolean(installingItem)}
              title={installingItem
                ? `Installing ${installingItem.title || 'another game'} — one at a time`
                : 'Install this download'}
              className={`h-8 px-3 mr-1 text-xs rounded-buttonTheme whitespace-nowrap ${
                installingItem
                  ? 'bg-tertiary text-muted cursor-not-allowed'
                  : 'bg-accent hover:bg-accentHover text-white'
              }`}
            >
              Install
            </button>
          )}
          {item.state === 'done' && item.filePath && (
            <Action icon="fa-folder-open" title="Show in folder"
              onClick={() => window.electronAPI.downloadsReveal?.({ id: item.id })} />
          )}
          <Action
            icon="fa-xmark"
            title={FINISHED_STATES.includes(item.state) ? 'Remove from list' : 'Cancel'}
            tone="danger"
            onClick={() => FINISHED_STATES.includes(item.state)
              ? window.electronAPI.downloadsRemove?.({ id: item.id })
              : act('cancel', item.id)}
          />
        </div>
      </div>
    )
  }

  return (
    // This view owns its scrolling: the shared pane is overflow-hidden for
    // non-detail views and scrolls nothing. h-full (not min-h-full) so the list
    // wrapper gets a bounded box below the pinned header.
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header: throughput, mirroring Steam's network/peak/disk row. */}
      {/* Header uses the same surface as a hovered card, so it reads as a
          distinct band above the list rather than blending into it. Opaque
          rather than the previous translucent bg-primary/95, which let the
          list show through while scrolling underneath. */}
      <div className="shrink-0 bg-selected border-b border-border">
        <div className="px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <h1 className="text-xl text-text">Downloads</h1>
          <div className="flex items-center gap-4 sm:gap-5">
            <Stat label="Network" value={formatRate(totalRate)} accent="bg-accent" wide />
            <Stat label="Peak" value={formatRate(peakRef.current)} accent="bg-accent/60" wide />
            <Stat label="Active" value={String(current.length)} accent="bg-success" />
            <button
              type="button"
              onClick={() => window.electronAPI.downloadsOpenFolder?.()}
              title={folder ? `Open ${folder}` : 'Open downloads folder'}
              className="h-8 w-8 inline-flex items-center justify-center rounded bg-tertiary hover:bg-selected text-text"
            >
              <i className="fas fa-folder" aria-hidden="true"></i>
            </button>
          </div>
        </div>
        {/* Always rendered. Hiding it when idle made the header jump every time
            a download started or finished, and a flat line is itself
            information - it says nothing is transferring. */}
        <div className="px-4 sm:px-6 pb-3">
          <SpeedGraph
            samples={speedHistory}
            current={totalRate}
            peak={peakRef.current}
          />
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className={`flex-1 min-h-0 overflow-y-auto downloads-scroll px-4 sm:px-6 pt-2 pb-10${showScrollbar ? ' scrollbar-visible' : ''}`}
      >

        {items.length === 0 && (
          <div className="py-16 text-center">
            <i className="fas fa-download text-3xl text-muted/50" aria-hidden="true"></i>
            <p className="mt-3 text-sm text-muted">No downloads yet.</p>
            <p className="text-xs text-muted/80 mt-1">
              Updates you start from a game will appear here.
            </p>
          </div>
        )}

        {current.length > 0 && (
          <Section title="In progress" count={current.length} sectionId="inProgress" stuck={stuckHeader === 'inProgress'}>
            {current.map((item) => renderItem(item, { featured: true }))}
          </Section>
        )}

        {(upNext.length > 0 || current.length > 0) && (
          <Section
            title="Up next"
            count={upNext.length}
            sectionId="upNext"
            stuck={stuckHeader === 'upNext'}
            collapsed={collapsed.upNext}
            onToggle={() => toggleSection('upNext')}
            onReverse={upNext.length > 0
              ? () => reverseOrder(upNext.map((item) => item.id))
              : undefined}
          >
            <div
              // Native drag leaves :hover stuck on the grabbed row, and Chromium
              // does not recompute it until a real mouse move. Keep the scoped
              // rule on through the post-drop slot highlight as well.
              className={previewIds || highlightSlot !== null ? 'downloads-dragging' : undefined}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onMouseMove={() => {
                if (previewIds) return
                if (performance.now() < suppressMouseMoveUntilRef.current) return
                suppressMouseMoveUntilRef.current = 0
                setHighlightSlot(null)
              }}
              onMouseLeave={() => {
                if (previewIds) return
                if (performance.now() < suppressMouseMoveUntilRef.current) return
                suppressMouseMoveUntilRef.current = 0
                setHighlightSlot(null)
              }}
            >
              {upNext.length > 0
                ? upNext.map((item) => renderItem(item, { draggable: true }))
                : <p className="py-3 text-sm text-muted">There are no downloads in the queue</p>}
            </div>
          </Section>
        )}

        {finished.length > 0 && (
          <Section
            title="Completed"
            count={finished.length}
            sectionId="completed"
            stuck={stuckHeader === 'completed'}
            collapsed={collapsed.completed}
            onToggle={() => toggleSection('completed')}
            action={(
              <button
                type="button"
                onClick={async () => { await window.electronAPI.downloadsClearFinished?.(); refresh() }}
                className="h-8 px-3 text-xs rounded-buttonTheme bg-button hover:bg-buttonHover text-text whitespace-nowrap"
              >
                Clear All
              </button>
            )}
          >
            {finished.map((item) => renderItem(item))}
          </Section>
        )}
      </div>

    </div>
  )
}
