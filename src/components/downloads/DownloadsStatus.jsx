import { useEffect, useState } from 'react'

// ── Downloads status line ────────────────────────────────────────────────────
//
// The footer indicator, modelled on Steam's: an icon, a short summary, and a
// thin progress bar, the whole thing clickable to open the Downloads view.
//
// This replaces the floating round button that sat over the library. That was
// a stopgap put there to avoid touching App.jsx's view routing before the
// backend existed; now there is a real Downloads view, so this behaves like
// what it is - a status line that navigates - rather than a widget that opens
// a panel on top of whatever you were doing.
//
// It stays quiet when nothing is happening. Rendering "0 downloads" forever in
// the corner of the window is noise, so with an empty queue it collapses to
// the icon alone and only speaks up when there is something to report.

export default function DownloadsStatus({ onOpen, active = false }) {
  const [summary, setSummary] = useState({
    active: 0, running: 0, awaitingFile: 0, failed: 0, percent: null,
  })
  const [completed, setCompleted] = useState(0)

  useEffect(() => {
    // Seed from the queue so the footer is correct on first paint, not only
    // after the next push from the main process.
    const load = async () => {
      try {
        const result = await window.electronAPI.downloadsList?.({ includeFinished: true })
        if (!result?.success) return
        const items = result.items || []
        const live = items.filter((item) => !['done', 'canceled'].includes(item.state))
        const running = live.filter((item) => item.state === 'downloading')
        const totalBytes = running.reduce((sum, item) => sum + (item.totalBytes || 0), 0)
        const received = running.reduce((sum, item) => sum + (item.receivedBytes || 0), 0)
        setCompleted(items.filter((item) => item.state === 'done').length)
        setSummary({
          active: live.length,
          running: running.length,
          awaitingFile: live.filter((item) => item.state === 'awaiting_file').length,
          failed: live.filter((item) => item.state === 'failed').length,
          percent: totalBytes > 0 ? Math.round((received / totalBytes) * 100) : null,
        })
      } catch {
        // Footer status is cosmetic; a failure here must not surface.
      }
    }
    load()

    const offs = [
      window.electronAPI.onDownloadsSummary?.((next) => {
        if (next) setSummary((prev) => ({ ...prev, ...next }))
      }),
      window.electronAPI.onDownloadComplete?.(() => {
        setCompleted((value) => value + 1)
      }),
      window.electronAPI.onDownloadsChanged?.(load),
    ]
    return () => offs.forEach((off) => { if (typeof off === 'function') off() })
  }, [])

  const { active: activeCount, running, failed, awaitingFile, percent } = summary

  let label = ''
  if (running > 0) {
    label = percent === null
      ? `Downloading ${running} item${running === 1 ? '' : 's'}`
      : `Downloading — ${percent}%`
  } else if (failed > 0) {
    label = `${failed} failed`
  } else if (awaitingFile > 0) {
    label = `${awaitingFile} waiting for your browser`
  } else if (activeCount > 0) {
    label = `${activeCount} queued`
  } else if (completed > 0) {
    label = `${completed} of ${completed} complete`
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      title="Downloads"
      className={`h-full px-2.5 inline-flex items-center gap-2 text-xs transition-colors ${
        active ? 'text-text bg-selected' : 'text-muted hover:text-text hover:bg-tertiary'
      }`}
    >
      <span className="relative inline-flex items-center">
        <i className="fas fa-download text-sm" aria-hidden="true"></i>
        {failed > 0 && (
          <span className="absolute -top-1 -right-1.5 w-1.5 h-1.5 rounded-full bg-danger" />
        )}
      </span>
      {label && (
        <span className="hidden sm:inline whitespace-nowrap">{label}</span>
      )}
      {running > 0 && (
        <span className="hidden md:block w-20">
          <span className="block h-1 rounded-full bg-tertiary overflow-hidden">
            {percent === null ? (
              <span className="block h-full w-1/3 bg-accent animate-pulse" />
            ) : (
              <span
                className="block h-full bg-accent transition-[width] duration-300"
                style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
              />
            )}
          </span>
        </span>
      )}
    </button>
  )
}
