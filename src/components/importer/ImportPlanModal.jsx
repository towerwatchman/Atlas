import { useEffect, useRef } from 'react'

// ── Import plan / result modal ───────────────────────────────────────────────
//
// Pressing Import used to commit immediately. For a folder scan that is fine —
// the review table is right there and shows every row. For an external library
// import it is not: 2,000 rows do not fit on screen, they split across two
// different destinations, and some are skipped entirely. Nobody can audit that
// from a scrolling table, so this states the outcome in three numbers before
// anything is written.
//
// It also reports afterwards, which is the only place that can honestly happen.
// The main process closes the importer window as soon as the library import
// commits, so anything shown after that point would appear in a window that is
// already gone. The wishlist runs BEFORE the library import, so its result is
// shown here, in this window, while it still exists.
//
// Three phases in one component rather than three modals, because they describe
// one operation and a stack of dialogs reads as a series of unrelated
// interruptions.

const PHASES = ['plan', 'working', 'result']

function Row({ label, value, tone = 'default', detail = null }) {
  const tones = {
    default: 'text-text',
    good: 'text-success',
    warn: 'text-amber-400',
    muted: 'text-muted',
  }
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <div className={`text-sm ${tones[tone]}`}>{label}</div>
        {detail && <div className="text-[11px] text-muted mt-0.5">{detail}</div>}
      </div>
      <div className={`text-lg font-medium tabular-nums shrink-0 ${tones[tone]}`}>{value}</div>
    </div>
  )
}

export default function ImportPlanModal({
  phase = 'plan',
  plan = null,
  result = null,
  busyLabel = '',
  onContinue,
  onCancel,
  onClose,
}) {
  const confirmRef = useRef(null)

  // Focus the primary action so the whole thing is keyboard-operable, and Escape
  // cancels — a modal that traps someone mid-import is worse than no modal.
  useEffect(() => {
    confirmRef.current?.focus()
  }, [phase])

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      if (phase === 'plan') onCancel?.()
      if (phase === 'result') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, onCancel, onClose])

  if (!PHASES.includes(phase)) return null

  const libraryCount = plan?.library ?? 0
  const wishlistCount = plan?.wishlist ?? 0
  const skippedCount = plan?.skipped ?? 0
  const pendingCount = plan?.pending ?? 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3">
      {/* Sized for a narrow importer window as well as a maximised one: the
          wizard is resizable well below a comfortable dialog width. */}
      <div className="w-full max-w-lg max-h-full overflow-y-auto rounded border border-border bg-primary shadow-xl">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-base font-medium text-text">
            {phase === 'plan' && 'Confirm import'}
            {phase === 'working' && 'Importing\u2026'}
            {phase === 'result' && 'Import summary'}
          </h2>
          {phase === 'plan' && (
            <p className="text-[11px] text-muted mt-0.5">
              Nothing has been written yet. This is exactly what will happen.
            </p>
          )}
        </div>

        <div className="px-4 py-3">
          {phase === 'plan' && (
            <>
              <div className="divide-y divide-border">
                <Row
                  label="Imported to your library"
                  value={libraryCount}
                  tone={libraryCount ? 'good' : 'muted'}
                  detail={
                    libraryCount
                      ? 'Games with something launchable on disk. Files are not moved.'
                      : 'Nothing on disk to import.'
                  }
                />
                <Row
                  label="Added to your wishlist"
                  value={wishlistCount}
                  tone={wishlistCount ? 'good' : 'muted'}
                  detail={
                    wishlistCount
                      ? 'Tracked games with nothing launchable here. Already-owned games are skipped automatically.'
                      : null
                  }
                />
                {skippedCount > 0 && (
                  <Row
                    label="Skipped entirely"
                    value={skippedCount}
                    tone="warn"
                    detail={
                      plan?.skipReasons?.length
                        ? `Not imported and not wishlisted. ${plan.skipReasons.slice(0, 3).join('; ')}${plan.skipReasons.length > 3 ? '; \u2026' : ''}`
                        : 'Not imported and not added to the wishlist.'
                    }
                  />
                )}
                {pendingCount > 0 && (
                  <Row
                    label="Still being matched"
                    value={pendingCount}
                    tone="warn"
                    detail="These would be skipped. Wait for matching to finish, or cancel it, before importing."
                  />
                )}
              </div>

              {/* What personal data comes across. Stated because an external
                  library import moves a lot of it and the user cannot see it in
                  the row table. */}
              {plan?.carries?.length > 0 && (
                <div className="mt-3 rounded border border-border p-2.5">
                  <p className="text-[11px] text-muted">
                    Also copied across, where {plan.sourceLabel || 'the source'} has it:{' '}
                    <span className="text-text">{plan.carries.join(', ')}</span>. Anything you
                    have already set in Atlas is never overwritten.
                  </p>
                </div>
              )}

              {plan?.warnings?.map((warning) => (
                <div
                  key={warning}
                  className="mt-2 rounded border border-amber-500/40 bg-amber-500/5 p-2.5 text-[11px] text-text"
                >
                  {warning}
                </div>
              ))}
            </>
          )}

          {phase === 'working' && (
            <div className="py-4 text-center">
              <i className="fas fa-spinner fa-spin text-accent text-xl" aria-hidden="true"></i>
              <p className="text-sm text-text mt-3">{busyLabel || 'Working\u2026'}</p>
              <p className="text-[11px] text-muted mt-1">
                Large libraries take a moment. Please don&rsquo;t close this window.
              </p>
            </div>
          )}

          {phase === 'result' && (
            <>
              <div className="divide-y divide-border">
                <Row
                  label="Added to your wishlist"
                  value={result?.wishlist?.added ?? 0}
                  tone={result?.wishlist?.added ? 'good' : 'muted'}
                />
                {(result?.wishlist?.skipped ?? 0) > 0 && (
                  <Row
                    label="Already in your library"
                    value={result.wishlist.skipped}
                    tone="muted"
                    detail="A game you own is not added to the wishlist."
                  />
                )}
                {(result?.wishlist?.failures?.length ?? 0) > 0 && (
                  <Row
                    label="Could not be added"
                    value={result.wishlist.failures.length}
                    tone="warn"
                    detail={result.wishlist.failures
                      .slice(0, 3)
                      .map((failure) => failure.title)
                      .join(', ')}
                  />
                )}
                {(result?.library ?? 0) > 0 && (
                  <Row
                    label="Now importing to your library"
                    value={result.library}
                    tone="good"
                    detail="Progress continues in the main window."
                  />
                )}
              </div>
              <p className="text-[11px] text-muted mt-3">
                Wishlist entries appear under Wishlist in the library sidebar.
              </p>
            </>
          )}
        </div>

        <div className="px-4 py-3 border-t border-border flex flex-col sm:flex-row-reverse gap-2">
          {phase === 'plan' && (
            <>
              <button
                ref={confirmRef}
                type="button"
                onClick={onContinue}
                disabled={libraryCount + wishlistCount === 0}
                className={`h-9 px-4 rounded-buttonTheme text-sm font-medium ${
                  libraryCount + wishlistCount === 0
                    ? 'bg-tertiary text-muted cursor-not-allowed opacity-70'
                    : 'bg-success hover:bg-successHover text-white'
                }`}
              >
                Continue
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="h-9 px-4 rounded-buttonTheme bg-tertiary hover:bg-selected text-text text-sm"
              >
                Exit
              </button>
            </>
          )}
          {phase === 'result' && (
            <button
              ref={confirmRef}
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-buttonTheme bg-accent hover:bg-accentHover text-white text-sm font-medium"
            >
              {(result?.library ?? 0) > 0 ? 'Continue' : 'Done'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
