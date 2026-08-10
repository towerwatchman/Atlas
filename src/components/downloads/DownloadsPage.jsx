import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import SafeImage from '../ui/SafeImage.jsx'
import { useImageFallback } from '../../hooks/useImageFallback.js'
import HostIcon from './HostIcon.jsx'
import { toMediaSrc } from '../../utils/mediaSrc.js'
import InstallModal from './InstallModal.jsx'
import LibraryFolderModal from './LibraryFolderModal.jsx'
import LibraryStructureModal from './LibraryStructureModal.jsx'
import { describeBuild } from './linkSections.js'
import { threadUrlForGame } from './threadUrl.js'
import { keepsBothVersions, bannerTargetFor } from './cardFacts.js'
import { getLibraryConfig } from '../../utils/librarySettings.js'

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
function Section({ title, count, children, action }) {
  return (
    <section className="mt-6 first:mt-0">
      <div className="flex items-center gap-3">
        <h2 className="text-lg text-text whitespace-nowrap">
          {title} <span className="text-muted text-base">({count})</span>
        </h2>
        <div className="flex-1 h-px bg-border" />
        {action}
      </div>
      <div className="mt-2">{children}</div>
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

export default function DownloadsPage({ gamesByRecordId = new Map(), onOpenGame }) {
  const [items, setItems] = useState([])
  const [rates, setRates] = useState({})
  // Mirror of `rates` for the sampling interval, so the timer is created once
  // rather than torn down and rebuilt on every progress update.
  const ratesRef = useRef({})
  const [busyId, setBusyId] = useState(null)
  const [folder, setFolder] = useState('')
  // The item awaiting install confirmation, plus the version Atlas suggests
  // for it. Null when the modal is closed.
  const [installTarget, setInstallTarget] = useState(null)
  // A one-off notice after installing: currently only "the old version was not
  // removed, and here is why".
  const [installNotice, setInstallNotice] = useState(null)
  // ── Setup prompts standing between Install and the install ────────────────
  //
  // Both are settings the install NEEDS and that have never been answered, so
  // both are raised here rather than in InstallModal: they gate whether the
  // install dialog should open at all, and a dialog that opens only to be
  // covered by another dialog is worse than one that waits its turn.
  //
  // Each holds the pending item so the flow can be picked up where it stopped
  // once the setting is answered. Null when closed.
  const [folderPrompt, setFolderPrompt] = useState(null)
  const [structurePrompt, setStructurePrompt] = useState(null)
  const samplesRef = useRef(new Map())
  const peakRef = useRef(0)
  // 60 one-second samples of aggregate throughput. Kept in state rather than a
  // ref because the graph has to re-render as it fills.
  const [speedHistory, setSpeedHistory] = useState(() => new Array(60).fill(0))

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

  useEffect(() => {
    const applyItem = (item) => {
      if (!item?.id) return
      setItems((prev) => {
        const index = prev.findIndex((entry) => entry.id === item.id)
        if (index === -1) return [...prev, item]
        const next = prev.slice()
        next[index] = item
        return next
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

  // Combined throughput across live transfers, plus a session peak. Peak is
  // kept in a ref so it survives re-renders without becoming state churn.
  const totalRate = current.reduce((sum, item) => sum + (rates[item.id] || 0), 0)
  if (totalRate > peakRef.current) peakRef.current = totalRate

  // The version suggestion is derived in the main process, where the parser
  // and the catalog version both live; the modal only presents it.
  const showInstallModal = useCallback(async (item) => {
    let suggestion = null
    try {
      suggestion = await window.electronAPI.downloadsSuggestVersion?.({ id: item.id })
    } catch {
      // A failed suggestion is not fatal - the field is editable anyway.
    }
    setInstallTarget({ item, suggestion: suggestion?.ok ? suggestion : null })
  }, [])

  // Ordered, one question at a time. The folder comes first because it is the
  // only one that actually blocks — without it there is nowhere to unpack — and
  // because the structure preview is meaningless until there is a root path to
  // show it under.
  //
  // A config read that fails resolves to {}, which reads as "neither answered"
  // and would raise both prompts against a working install. gameFolder is
  // therefore only treated as missing when the read produced SOMETHING, so a
  // broken config falls through to the install and its existing failure path
  // rather than being interrupted by a dialog it cannot honour.
  const openInstall = useCallback(async (item) => {
    const library = await getLibraryConfig()
    const known = Object.keys(library).length > 0

    if (known && !String(library.gameFolder || '').trim()) {
      setFolderPrompt({ item, reason: 'preflight' })
      return
    }
    if (known && library.structurePrompted !== true) {
      setStructurePrompt({ item, gameFolder: String(library.gameFolder || '') })
      return
    }
    await showInstallModal(item)
  }, [showInstallModal])

  const move = async (id, direction) => {
    const ordered = [...current, ...upNext].map((item) => item.id)
    const index = ordered.indexOf(id)
    const target = index + direction
    if (index === -1 || target < 0 || target >= ordered.length) return
    const next = ordered.slice()
    ;[next[index], next[target]] = [next[target], next[index]]
    await window.electronAPI.downloadsReorder?.({ ids: next })
    refresh()
  }

  const renderItem = (item, { featured = false } = {}) => {
    // gamesByRecordId is a Map keyed by Number(record_id), not a plain object.
    // Bracket access on a Map silently returns undefined, which is why the
    // cover art never appeared.
    const game = item.recordId ? gamesByRecordId.get(Number(item.recordId)) || null : null
    const rate = rates[item.id] || 0
    const remaining = item.totalBytes > 0 && rate > 0
      ? (item.totalBytes - item.receivedBytes) / rate
      : null
    const transferring = item.state === 'downloading'
    // Where the banner goes. Installed titles open inside Atlas; everything else
    // opens the thread it came from, which is the page a user wants while they
    // are still deciding. A download with no library record -- Browse, wishlist --
    // has neither, and the banner stays inert rather than becoming a dead link.
    const gameThreadUrl = threadUrlForGame(game)
    // The download's own page on the host, behind the host name. Guarded on the
    // scheme: a row can carry a non-http url and opening one externally is not
    // something to do on the strength of a substring.
    const hostUrl = /^https?:\/\//i.test(String(item.url || '')) ? item.url : ''
    const bannerTarget = bannerTargetFor({ game, threadUrl: gameThreadUrl, hostUrl })
    const working = WORKING_STATES.includes(item.state)
    const errored = item.state === 'failed' || item.state === 'install_failed'
    const tone = errored ? 'danger' : item.state === 'done' ? 'success' : 'accent'

    return (
      <div
        key={item.id}
        className="group flex items-center gap-3 sm:gap-4 p-3 mb-2 rounded-lg border border-border bg-secondary transition-colors cursor-default hover:bg-selected hover:border-accent"
      >
        <button
          type="button"
          onClick={() => {
            if (bannerTarget === 'game') onOpenGame?.(game)
            else if (bannerTarget === 'thread') window.electronAPI.openExternalUrl?.(gameThreadUrl)
            else if (bannerTarget === 'host') window.electronAPI.openExternalUrl?.(hostUrl)
          }}
          disabled={!bannerTarget}
          // Said out loud, because one control doing two different things with
          // no visible difference is otherwise a coin flip for the user.
          title={
            bannerTarget === 'game'
              ? `Open ${item.title} in Atlas`
              : bannerTarget === 'thread'
                ? `Open the ${item.title} thread in your browser`
                : bannerTarget === 'host'
                  ? `Open this download's page on ${item.host || 'the host'}`
                  : undefined
          }
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
          {describeBuild(item.buildLabel) && (
            <div className="mt-1">
              <span className="inline-block max-w-full truncate rounded border border-border bg-tertiary/50 px-1.5 py-0.5 text-[11px] text-text">
                {describeBuild(item.buildLabel)}
              </span>
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
              onClick={() => openInstall(item)}
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
          {WAITING_STATES.includes(item.state) && (
            <>
              <Action icon="fa-chevron-up" title="Move up" onClick={() => move(item.id, -1)} />
              <Action icon="fa-chevron-down" title="Move down" onClick={() => move(item.id, 1)} />
            </>
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
    // No scroll container here. #gameGrid is already overflow-y-auto, and
    // nesting a second scroller inside it meant two reserved scrollbar
    // gutters - the inner one showing as dead space down the right of the
    // page. CollectionsView, the sibling view, sets no overflow for the
    // same reason and lets the grid do the scrolling.
    //
    // The sticky header still works: it now sticks against #gameGrid
    // rather than against a nested box, which is what was wanted anyway.
    <div>
      {/* Header: throughput, mirroring Steam's network/peak/disk row. */}
      {/* Header uses the same surface as a hovered card, so it reads as a
          distinct band above the list rather than blending into it. Opaque
          rather than the previous translucent bg-primary/95, which let the
          list show through while scrolling underneath. */}
      <div className="sticky top-0 z-10 bg-selected border-b border-border">
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

      <div className="px-4 sm:px-6 py-4 pb-10">

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
          <Section title="In progress" count={current.length}>
            {current.map((item) => renderItem(item, { featured: true }))}
          </Section>
        )}

        {(upNext.length > 0 || current.length > 0) && (
          <Section title="Up next" count={upNext.length}>
            {upNext.length > 0
              ? upNext.map((item) => renderItem(item))
              : <p className="py-3 text-sm text-muted">There are no downloads in the queue</p>}
          </Section>
        )}

        {finished.length > 0 && (
          <Section
            title="Completed"
            count={finished.length}
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

      {installNotice && (
        <div className="fixed inset-0 z-[1500] bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-primary shadow-2xl">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-base text-text">Installed{installNotice.title ? ` ${installNotice.title}` : ''}</h2>
            </div>
            <p className="px-4 py-3 text-xs text-text">{installNotice.message}</p>
            <div className="px-4 py-3 border-t border-border flex justify-end">
              <button
                type="button"
                onClick={() => setInstallNotice(null)}
                className="h-8 px-4 text-xs rounded-buttonTheme bg-accent hover:bg-accentHover text-white"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      <InstallModal
        item={installTarget?.item}
        suggestion={installTarget?.suggestion}
        open={Boolean(installTarget)}
        onClose={() => setInstallTarget(null)}
        onInstalled={(result) => {
          setInstallTarget(null)
          refresh()
          // The new version installs either way, so a declined replace is a
          // notice rather than an error — but the user asked for the old build
          // to go, and saying nothing about it staying is what made this read as
          // broken rather than as a refusal.
          if (result?.busy) {
            setInstallNotice({
              title: '',
              message: result.error || 'Another install is already running.',
            })
            return
          }
          // Not a notice — a question with an answer. The item stays installable
          // (fail() parks it in install_failed with the archive intact), so
          // setting the folder and retrying costs nothing but the click.
          if (result?.step === 'no-library-folder') {
            const pending = installTarget?.item
            if (pending) setFolderPrompt({ item: pending, reason: 'failed' })
            return
          }
          // A download promoted onto a record that matched by TITLE rather than
          // by any id is the one outcome here worth interrupting for: no atlas,
          // f95, LewdCorner or Steam id linked these two, only the name did, so
          // it may not be the game that was meant. Everything else about a
          // promotion is the expected result and needs no dialog.
          if (result?.success && result.attachedByTitle) {
            setInstallNotice({
              title: result.version || '',
              message:
                `Atlas added this version to the existing library entry for `
                + `"${result.promotedTitle || installTarget?.item?.title || 'this game'}", which matched by `
                + `name only — no store or thread id linked them. If that is a different `
                + `game, move the version from its page.`
                + (result.replaceMessage ? ` ${result.replaceMessage}` : ''),
            })
            return
          }
          if (result?.success && result.replaceMessage) {
            setInstallNotice({ title: result.version || '', message: result.replaceMessage })
          }
        }}
      />

      {/* The reactive half of the folder prompt. openInstall checks the setting
          up front, but the folder can be cleared between that check and the
          install actually running, and the main process is the only thing that
          knows the difference between "not set" and "set but unusable". `step`
          is what fail() puts on the refusal, so branching on it here is reading
          the main process's own classification rather than matching its prose. */}
      <LibraryFolderModal
        open={Boolean(folderPrompt)}
        reason={folderPrompt?.reason || 'preflight'}
        title={folderPrompt?.item?.title || ''}
        onCancel={() => setFolderPrompt(null)}
        onChosen={async () => {
          const pending = folderPrompt?.item
          setFolderPrompt(null)
          // Straight back into openInstall rather than into the install modal:
          // the structure question may still be outstanding, and this is the
          // only place that decides the order between them.
          if (pending) await openInstall(pending)
        }}
      />

      <LibraryStructureModal
        open={Boolean(structurePrompt)}
        gameFolder={structurePrompt?.gameFolder || ''}
        onDone={async () => {
          const pending = structurePrompt?.item
          setStructurePrompt(null)
          // showInstallModal, not openInstall: the flag has just been written and
          // re-reading it would be a race with no upside, and both questions are
          // now answered by construction.
          if (pending) await showInstallModal(pending)
        }}
      />
    </div>
  )
}
