import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import UpdateModal from './UpdateModal.jsx'
import { advanceQueue, createSession, prefetchTarget, queueProgress } from './updateAllQueue.js'

// ── Update all games ─────────────────────────────────────────────────────────
//
// Walks every library record the database says has a newer version, showing the
// normal update dialog for each one, and stops whenever the user says so.
//
// The run is a walkthrough, not a batch job. Each game still needs a person:
// which build, which mirror, and then F95's own gate in a browser window. What
// the run removes is the twenty round trips back to the library grid to find
// the next game with an update badge on it.
//
// Stopping is a first-class outcome rather than an error path. Someone who does
// ten of thirty and stops has got what they came for; the ten downloads keep
// going, because the run only ever produced queue entries and the queue does not
// care where its entries came from.

export default function UpdateAllSession({ open, games = [], onClose, onQueued }) {
  const [state, setState] = useState(() => createSession([]))
  // Set when the run ends, so the summary can be shown over the library rather
  // than the run vanishing and leaving the user to guess what it did.
  const [summary, setSummary] = useState(null)
  // Thread ids we have already asked the main process to warm. update-links-get
  // caches per session, so a repeat call is cheap - but it is still an
  // authenticated request to F95 if the cache missed, and firing one per render
  // would be a request storm on a slow fetch.
  const prefetchedRef = useRef(new Set())

  useEffect(() => {
    if (!open) return
    setSummary(null)
    prefetchedRef.current = new Set()
    setState(createSession(games))
    // games is deliberately not a dependency. The list is snapshotted when the
    // run starts: the library refetches after every queued download, and a
    // reactive queue would reshuffle and re-number itself under the user
    // mid-run - the counter would go backwards and games already dealt with
    // would reappear.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const current = state.queue[state.index] || null
  const progress = useMemo(() => queueProgress(state), [state])

  // Warm the NEXT game's links while the user is busy with this one. The fetch
  // is the slow half of each step (a full thread page under the user's session),
  // so paying for it during a click the user was going to make anyway is the
  // difference between a run that pauses at every game and one that does not.
  //
  // Failure is ignored on purpose: this is a cache warm, and the real fetch that
  // follows owns the error reporting. Surfacing a prefetch failure would report
  // the NEXT game's problem while the user is looking at the current one.
  useEffect(() => {
    if (!open || state.finished) return
    const next = prefetchTarget(state)
    const threadId = next?.f95_id || next?.f95Id || null
    if (!threadId) return
    const key = String(threadId)
    if (prefetchedRef.current.has(key)) return
    prefetchedRef.current.add(key)
    window.electronAPI.updateLinksGet?.({ threadId, force: false })?.catch?.(() => {})
  }, [open, state])

  const finish = useCallback((next) => {
    setSummary({
      total: next.queue.length,
      queued: next.queued,
      skipped: next.skipped,
      done: next.index,
      stopped: next.index < next.queue.length,
    })
  }, [])

  const step = useCallback((outcome) => {
    setState((previous) => {
      const next = advanceQueue(previous, outcome)
      if (next.finished) finish(next)
      return next
    })
  }, [finish])

  const stop = useCallback(() => {
    setState((previous) => {
      finish({ ...previous, finished: true })
      return { ...previous, finished: true }
    })
  }, [finish])

  if (!open) return null

  if (summary) {
    return (
      <div className="fixed inset-0 z-[1500] bg-black/60 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-lg border border-border bg-primary shadow-2xl">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-base text-text">
              {summary.stopped ? 'Stopped checking for updates' : 'Finished checking for updates'}
            </h2>
          </div>
          <div className="px-4 py-3 text-xs text-text space-y-1">
            <p>
              {summary.queued} {summary.queued === 1 ? 'download' : 'downloads'} added to the queue
              {summary.skipped > 0 && `, ${summary.skipped} skipped`}.
            </p>
            {/* Said explicitly. "Stop" is the word on the button the user just
                pressed, and the reasonable reading of it is that everything
                stops - including the transfers they spent the last ten minutes
                starting. */}
            <p className="text-muted">
              Downloads already queued keep going. You can watch them on the
              Downloads page.
            </p>
            {summary.stopped && summary.total - summary.done > 0 && (
              <p className="text-muted">
                {summary.total - summary.done} {summary.total - summary.done === 1 ? 'game was' : 'games were'} not
                checked.
              </p>
            )}
          </div>
          <div className="px-4 py-3 border-t border-border flex justify-end">
            <button
              type="button"
              onClick={() => { setSummary(null); onClose?.() }}
              className="h-8 px-4 text-xs rounded-buttonTheme bg-accent hover:bg-accentHover text-white"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!current) return null

  return (
    <UpdateModal
      game={current}
      open
      // The X in the corner ends the run, same as the labelled button. Both are
      // the user asking to leave, and having one of them do something subtly
      // different is how a dialog earns a reputation for being unpredictable.
      onClose={stop}
      onQueued={(item) => { onQueued?.(item); step('queued') }}
      session={{
        position: progress.position,
        total: progress.total,
        remaining: progress.remaining,
        onSkip: () => step('skipped'),
        onStop: stop,
      }}
    />
  )
}
