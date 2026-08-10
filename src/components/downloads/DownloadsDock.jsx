import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { describeBuild } from './linkSections.js'
import { keepsBothVersions } from './cardFacts.js'

// ── Downloads dock ───────────────────────────────────────────────────────────
//
// The bottom-right status button and the panel it opens, together in one
// component so mounting it in App.jsx is a single line and the feature owns its
// own state instead of threading through the main view.
//
// Modelled on Steam's downloads screen: the transfer in progress gets the top
// slot with a large progress bar, throughput and time remaining; everything
// waiting sits under "Up next" in queue order and can be reordered; finished
// items collapse into a list at the bottom.
//
// Throughput is derived here rather than in the main process. The backend already
// throttles progress to a few updates a second, and rate is a presentation
// concern — computing it from consecutive samples keeps the transfer loop from
// carrying timing code it does not otherwise need.

const STATE_LABELS = {
  queued: 'Queued',
  downloading: 'Downloading',
  paused: 'Paused',
  awaiting_file: 'Waiting for your download',
  verifying: 'Verifying',
  extracting: 'Extracting',
  importing: 'Adding to library',
  done: 'Complete',
  failed: 'Failed',
  canceled: 'Canceled',
}

const ACTIVE_STATES = ['downloading', 'verifying', 'extracting', 'importing']
const FINISHED_STATES = ['done', 'canceled']

const formatBytes = (value) => {
  const bytes = Number(value) || 0
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const scaled = bytes / 1024 ** index
  return `${scaled.toFixed(index === 0 ? 0 : scaled >= 10 ? 1 : 2)} ${units[index]}`
}

const formatRate = (bytesPerSecond) =>
  bytesPerSecond > 0 ? `${formatBytes(bytesPerSecond)}/s` : ''

const formatEta = (seconds) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  if (seconds < 60) return `${Math.round(seconds)}s left`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m left`
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  return `${hours}h ${minutes}m left`
}

function ProgressBar({ percent, indeterminate = false, tone = 'accent' }) {
  const tones = { accent: 'bg-accent', success: 'bg-success', danger: 'bg-danger', muted: 'bg-muted' }
  return (
    <div className="h-1.5 w-full rounded-full bg-tertiary overflow-hidden">
      {indeterminate ? (
        // No Content-Length from the host, so a percentage would be invented.
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

function IconButton({ icon, title, onClick, tone = 'default', disabled = false }) {
  const tones = {
    default: 'text-muted hover:text-text',
    danger: 'text-muted hover:text-danger',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className={`h-7 w-7 inline-flex items-center justify-center rounded hover:bg-tertiary disabled:opacity-40 disabled:cursor-not-allowed ${tones[tone]}`}
    >
      <i className={`fas ${icon} text-xs`} aria-hidden="true"></i>
    </button>
  )
}

export default function DownloadsDock() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [summary, setSummary] = useState({ active: 0, running: 0, percent: null, failed: 0 })
  const [showFinished, setShowFinished] = useState(false)
  const [busyId, setBusyId] = useState(null)
  // Previous byte samples per item, for the rate estimate.
  const samplesRef = useRef(new Map())
  const [rates, setRates] = useState({})

  const refresh = useCallback(async () => {
    try {
      const result = await window.electronAPI.downloadsList?.({ includeFinished: true })
      if (result?.success) setItems(result.items || [])
    } catch (err) {
      console.warn('Could not load downloads:', err.message)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // Live updates. The main process pushes per-item changes plus a summary, so the
  // badge stays accurate whether or not the panel is open.
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
      // Rate from the delta against the last sample for this item.
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
      window.electronAPI.onDownloadsSummary?.((next) => setSummary(next || {})),
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

  const { current, upNext, finished } = useMemo(() => {
    const active = items.filter((item) => ACTIVE_STATES.includes(item.state))
    const waiting = items.filter((item) =>
      ['queued', 'paused', 'awaiting_file', 'failed'].includes(item.state))
    return {
      current: active,
      upNext: waiting,
      finished: items.filter((item) => FINISHED_STATES.includes(item.state)),
    }
  }, [items])

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

  const renderRow = (item, { featured = false } = {}) => {
    const rate = rates[item.id] || 0
    const remaining = item.totalBytes > 0 && rate > 0
      ? (item.totalBytes - item.receivedBytes) / rate
      : null
    const isTransferring = item.state === 'downloading'
    const isWorking = ['verifying', 'extracting', 'importing'].includes(item.state)
    const tone = item.state === 'failed' ? 'danger' : item.state === 'done' ? 'success' : 'accent'

    return (
      <div
        key={item.id}
        className={`px-3 py-2.5 ${featured ? 'bg-tertiary/40' : ''} border-b border-border last:border-b-0`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className={`truncate ${featured ? 'text-sm' : 'text-xs'} text-text`}>
              {item.title}
              {item.version && <span className="text-muted"> · {item.version}</span>}
            </div>
            <div className="mt-0.5 text-[11px] text-muted flex flex-wrap items-center gap-x-2">
              <span className={item.state === 'failed' ? 'text-danger' : ''}>
                {STATE_LABELS[item.state] || item.state}
              </span>
              {/* Inline here rather than a chip on its own line: the dock is a
                  compact strip and a second row per item would halve how many
                  fit. text-text so it reads as an identifier among the greyed
                  status facts beside it. */}
              {describeBuild(item.buildLabel) && (
                <span className="text-text truncate max-w-[10rem]">
                  {describeBuild(item.buildLabel)}
                </span>
              )}
              {item.host && <span>{item.host}</span>}
              {item.totalBytes > 0 && (
                <span>
                  {formatBytes(item.receivedBytes)} / {formatBytes(item.totalBytes)}
                </span>
              )}
              {isTransferring && rate > 0 && <span>{formatRate(rate)}</span>}
              {isTransferring && remaining && <span>{formatEta(remaining)}</span>}
              {keepsBothVersions(item, null) && <span>keeps both versions</span>}
            </div>
            {item.error && (
              <div className="mt-0.5 text-[11px] text-danger break-words">{item.error}</div>
            )}
            {item.state === 'awaiting_file' && (
              // The masked-link case. Says plainly what Atlas is waiting for so
              // this does not look like a stalled download.
              <div className="mt-1 text-[11px] text-muted">
                Finish the download in your browser — Atlas will pick the file up
                from the downloads folder automatically.
                <button
                  type="button"
                  onClick={() => window.electronAPI.downloadsAttachFile?.({ id: item.id })}
                  className="ml-1 text-accent hover:underline"
                >
                  Or choose the file
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center shrink-0">
            {isTransferring && (
              <IconButton icon="fa-pause" title="Pause" onClick={() => act('pause', item.id)} disabled={busyId === item.id} />
            )}
            {item.state === 'paused' && (
              <IconButton icon="fa-play" title="Resume" onClick={() => act('resume', item.id)} disabled={busyId === item.id} />
            )}
            {item.state === 'failed' && (
              <IconButton icon="fa-rotate-right" title="Retry" onClick={() => act('retry', item.id)} disabled={busyId === item.id} />
            )}
            {['queued', 'paused', 'awaiting_file', 'failed'].includes(item.state) && (
              <>
                <IconButton icon="fa-chevron-up" title="Move up" onClick={() => move(item.id, -1)} />
                <IconButton icon="fa-chevron-down" title="Move down" onClick={() => move(item.id, 1)} />
              </>
            )}
            {item.state === 'done' && item.filePath && (
              <IconButton icon="fa-folder-open" title="Show in folder" onClick={() => window.electronAPI.downloadsReveal?.({ id: item.id })} />
            )}
            <IconButton
              icon="fa-xmark"
              title={FINISHED_STATES.includes(item.state) ? 'Remove from list' : 'Cancel'}
              tone="danger"
              onClick={() =>
                FINISHED_STATES.includes(item.state)
                  ? window.electronAPI.downloadsRemove?.({ id: item.id })
                  : act('cancel', item.id)
              }
            />
          </div>
        </div>

        {(isTransferring || isWorking || item.state === 'paused') && (
          <div className="mt-2">
            <ProgressBar
              percent={item.percent ?? 0}
              // A working item has no byte progress to show, and a transfer with
              // no declared length cannot have a real percentage.
              indeterminate={isWorking || (isTransferring && item.percent === null)}
              tone={tone}
            />
          </div>
        )}
      </div>
    )
  }

  const badgeCount = summary.active || 0

  return (
    <>
      {/* ── Status button, bottom right ──────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="Downloads"
        className="fixed bottom-3 right-3 z-[1400] flex items-center gap-2 rounded-full border border-border bg-primary/95 px-3 py-2 shadow-lg backdrop-blur hover:bg-tertiary transition-colors -webkit-app-region-no-drag"
      >
        <span className="relative flex items-center">
          <i className="fas fa-download text-sm text-text" aria-hidden="true"></i>
          {badgeCount > 0 && (
            <span className="absolute -top-2 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-accent text-white text-[10px] leading-4 text-center">
              {badgeCount}
            </span>
          )}
        </span>
        {/* Only shows numbers while something is actually moving, so the button
            stays quiet the rest of the time. */}
        {summary.running > 0 && (
          <span className="hidden sm:flex flex-col items-start w-24">
            <span className="text-[10px] leading-tight text-muted">
              {summary.percent === null ? 'Downloading' : `${summary.percent}%`}
            </span>
            <span className="w-full mt-0.5">
              <ProgressBar percent={summary.percent ?? 0} indeterminate={summary.percent === null} />
            </span>
          </span>
        )}
        {summary.running === 0 && summary.failed > 0 && (
          <span className="hidden sm:inline text-[10px] text-danger">
            {summary.failed} failed
          </span>
        )}
      </button>

      {/* ── Panel ───────────────────────────────────────────────────────── */}
      {open && (
        <>
          {/* Click-away rather than a modal backdrop: the library stays legible
              behind it, which is how Steam's downloads view behaves. */}
          <div className="fixed inset-0 z-[1390]" onClick={() => setOpen(false)} />
          <div className="fixed bottom-16 right-3 z-[1401] w-[calc(100vw-1.5rem)] sm:w-[480px] max-h-[70vh] flex flex-col rounded-lg border border-border bg-primary shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-medium text-text">Downloads</h2>
                {summary.active > 0 && (
                  <span className="text-[11px] text-muted">{summary.active} active</span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <IconButton
                  icon="fa-folder"
                  title="Open downloads folder"
                  onClick={() => window.electronAPI.downloadsOpenFolder?.()}
                />
                <IconButton icon="fa-xmark" title="Close" onClick={() => setOpen(false)} />
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto scroll-window-inset">
              {items.length === 0 && (
                <div className="px-3 py-8 text-center text-xs text-muted">
                  Nothing downloading. Updates you start from a game will show up
                  here.
                </div>
              )}

              {current.length > 0 && (
                <div>
                  <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-muted">
                    In progress
                  </div>
                  {current.map((item) => renderRow(item, { featured: true }))}
                </div>
              )}

              {upNext.length > 0 && (
                <div>
                  <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wide text-muted">
                    Up next
                  </div>
                  {upNext.map((item) => renderRow(item))}
                </div>
              )}

              {finished.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowFinished((value) => !value)}
                    className="w-full px-3 pt-3 pb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-muted hover:text-text"
                  >
                    <span>Completed ({finished.length})</span>
                    <i className={`fas ${showFinished ? 'fa-chevron-up' : 'fa-chevron-down'}`} aria-hidden="true"></i>
                  </button>
                  {showFinished && finished.map((item) => renderRow(item))}
                </div>
              )}
            </div>

            {finished.length > 0 && (
              <div className="shrink-0 border-t border-border px-3 py-2 flex justify-end">
                <button
                  type="button"
                  onClick={async () => {
                    await window.electronAPI.downloadsClearFinished?.()
                    refresh()
                  }}
                  className="text-[11px] text-muted hover:text-text"
                >
                  Clear completed
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </>
  )
}
