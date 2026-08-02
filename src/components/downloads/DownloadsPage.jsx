import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toMediaSrc } from '../../utils/mediaSrc.js'

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
  downloading: 'Downloading',
  paused: 'Paused',
  awaiting_file: 'Waiting for your browser download',
  verifying: 'Verifying',
  extracting: 'Extracting',
  importing: 'Adding to library',
  done: 'Complete',
  failed: 'Failed',
  canceled: 'Canceled',
}

const ACTIVE_STATES = ['downloading', 'verifying', 'extracting', 'importing']
const WAITING_STATES = ['queued', 'paused', 'awaiting_file', 'failed']
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

// Wide capsule, same proportions Steam uses in this list.
function Cover({ game, title }) {
  const src = game?.banner_url ? toMediaSrc(game.banner_url) : ''
  return (
    <div className="w-[120px] sm:w-[160px] aspect-[184/69] shrink-0 rounded overflow-hidden bg-tertiary border border-border">
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          className="w-full h-full object-cover"
          onError={(event) => { event.currentTarget.style.display = 'none' }}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-muted">
          <i className="fas fa-gamepad text-lg" aria-hidden="true"></i>
        </div>
      )}
      <span className="sr-only">{title}</span>
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

function Stat({ label, value, accent }) {
  return (
    <div className="min-w-[86px]">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted">
        <span className={`inline-block w-2 h-[3px] rounded-full ${accent}`} />
        {label}
      </div>
      <div className="text-sm text-text font-medium mt-0.5">{value}</div>
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

export default function DownloadsPage({ gamesByRecordId = {}, onOpenGame }) {
  const [items, setItems] = useState([])
  const [rates, setRates] = useState({})
  const [busyId, setBusyId] = useState(null)
  const [folder, setFolder] = useState('')
  const samplesRef = useRef(new Map())
  const peakRef = useRef(0)

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
          setRates((prev) => ({ ...prev, [item.id]: gained / elapsed }))
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

  const act = useCallback(async (action, id) => {
    setBusyId(id)
    try {
      await window.electronAPI.downloadsAction?.({ action, id })
    } finally {
      setBusyId(null)
    }
  }, [])

  const { current, upNext, finished } = useMemo(() => ({
    current: items.filter((item) => ACTIVE_STATES.includes(item.state)),
    upNext: items.filter((item) => WAITING_STATES.includes(item.state)),
    finished: items.filter((item) => FINISHED_STATES.includes(item.state)),
  }), [items])

  // Combined throughput across live transfers, plus a session peak. Peak is
  // kept in a ref so it survives re-renders without becoming state churn.
  const totalRate = current.reduce((sum, item) => sum + (rates[item.id] || 0), 0)
  if (totalRate > peakRef.current) peakRef.current = totalRate

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
    const game = item.recordId ? gamesByRecordId[item.recordId] : null
    const rate = rates[item.id] || 0
    const remaining = item.totalBytes > 0 && rate > 0
      ? (item.totalBytes - item.receivedBytes) / rate
      : null
    const transferring = item.state === 'downloading'
    const working = WORKING_STATES.includes(item.state)
    const tone = item.state === 'failed' ? 'danger' : item.state === 'done' ? 'success' : 'accent'

    return (
      <div key={item.id} className="flex items-center gap-3 sm:gap-4 py-3 border-b border-border/60 last:border-b-0">
        <button
          type="button"
          onClick={() => game && onOpenGame?.(game)}
          disabled={!game}
          className={game ? 'cursor-pointer' : 'cursor-default'}
        >
          <Cover game={game} title={item.title} />
        </button>

        <div className="flex-1 min-w-0">
          <div className={`truncate text-text ${featured ? 'text-base' : 'text-sm'}`}>
            {item.title}
            {item.version && <span className="text-muted text-sm"> · {item.version}</span>}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
            <span className={item.state === 'failed' ? 'text-danger' : ''}>
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
            {item.host && <span>{item.host}</span>}
            {item.onComplete === 'add' && <span>keeps both versions</span>}
            {item.state === 'done' && item.completedAt && (
              <span>{formatWhen(item.completedAt)}</span>
            )}
          </div>

          {item.error && <div className="mt-1 text-xs text-danger break-words">{item.error}</div>}

          {item.state === 'awaiting_file' && (
            // The masked-link case. Says plainly what Atlas is waiting on, so
            // this does not read as a stalled transfer.
            <div className="mt-1 text-xs text-muted">
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

          {(transferring || working || item.state === 'paused') && (
            <div className="mt-2 max-w-2xl">
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

  const Section = ({ title, count, children, action }) => (
    <section className="mt-6 first:mt-0">
      <div className="flex items-center gap-3">
        <h2 className="text-lg text-text whitespace-nowrap">
          {title} <span className="text-muted text-base">({count})</span>
        </h2>
        <div className="flex-1 h-px bg-border" />
        {action}
      </div>
      <div className="mt-1">{children}</div>
    </section>
  )

  return (
    <div className="h-full overflow-y-auto">
      {/* Header: throughput, mirroring Steam's network/peak/disk row. */}
      <div className="sticky top-0 z-10 bg-primary/95 backdrop-blur border-b border-border">
        <div className="px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <h1 className="text-xl text-text">Downloads</h1>
          <div className="flex items-center gap-4 sm:gap-6">
            <Stat label="Network" value={formatRate(totalRate)} accent="bg-accent" />
            <Stat label="Peak" value={formatRate(peakRef.current)} accent="bg-accent/60" />
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
      </div>

      <div className="px-4 sm:px-6 py-4 pb-10 max-w-6xl">
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
    </div>
  )
}
