// ── Update-all queue ─────────────────────────────────────────────────────────
//
// The bookkeeping behind "Update all games": which records go in the run, where
// the user is in it, and what the counters say. Kept out of the component
// because the counters are the part that has to be right — "23 games have
// updates, 4 done, 19 left" is the only thing on screen telling the user how
// much of their evening this will take, and an off-by-one there is invisible in
// a render test but obvious to someone halfway through.
//
// Nothing here touches the network or React. The session component owns the
// fetching; this owns the arithmetic.

// A game is in the run if the library says it has an update. Deliberately NOT
// also filtered on having an f95 thread id: LewdCorner download support is next
// and the filter would then have to be found and widened, which is the kind of
// hidden rule that outlives the reason for it. A record with no thread reaches
// the modal and gets its own explanatory empty state, which is a better answer
// than being silently dropped from a count the user is watching.
//
// Sorted by title so two runs over the same library present the same order —
// the library list arrives in whatever order the query produced, and a user who
// cancels at "12 of 30" and restarts should meet the same first twelve rather
// than a reshuffle.
export function buildUpdateQueue(games = []) {
  const seen = new Set()
  const queue = []
  for (const game of games) {
    if (!game || game.isUpdateAvailable !== true) continue
    // record_id is the identity here rather than the title: two records can
    // legitimately share a name, and a Set keyed on the name would drop one.
    const key = game.record_id ?? game.recordId ?? game.localRecordId ?? null
    if (key == null) continue
    if (seen.has(String(key))) continue
    seen.add(String(key))
    queue.push(game)
  }
  return queue.sort((a, b) =>
    String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' }),
  )
}

// What the header prints. `position` is 1-based because it is shown to a human;
// `remaining` counts the current game as remaining, since it has not been dealt
// with yet — a run showing "0 left" while a modal is still asking for a mirror
// is the confusing version of this.
export function queueProgress({ queue = [], index = 0, queued = 0, skipped = 0 } = {}) {
  const total = queue.length
  const clamped = Math.min(Math.max(index, 0), total)
  return {
    total,
    position: total === 0 ? 0 : Math.min(clamped + 1, total),
    remaining: Math.max(total - clamped, 0),
    done: clamped,
    queued,
    skipped,
  }
}

// Advance past the current game. Split from the component because "the run is
// over" and "show the next game" differ only by whether the new index has run
// off the end, and getting that wrong either hangs on a blank modal or ends the
// run one game early.
//
// `outcome` records why we moved on: 'queued' (a download was started) or
// 'skipped' (the user passed, or the game had nothing to offer). The tallies
// feed the summary shown when the run finishes, which is the only place the
// user finds out that six of their thirty games had no supported mirror.
export function advanceQueue(state, outcome = 'skipped') {
  const nextIndex = state.index + 1
  return {
    ...state,
    index: nextIndex,
    queued: state.queued + (outcome === 'queued' ? 1 : 0),
    skipped: state.skipped + (outcome === 'queued' ? 0 : 1),
    finished: nextIndex >= state.queue.length,
  }
}

// The game whose links should be fetched in the background while the user works
// on the current one. Returns null at the end of the run rather than wrapping —
// a prefetch of the first game again would be a wasted authenticated request to
// F95 at exactly the moment the run is winding down.
export function prefetchTarget(state) {
  const next = state.queue[state.index + 1]
  return next || null
}

export function createSession(games = []) {
  const queue = buildUpdateQueue(games)
  return { queue, index: 0, queued: 0, skipped: 0, finished: queue.length === 0 }
}
