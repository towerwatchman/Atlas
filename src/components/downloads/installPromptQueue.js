// ── Install prompt queue ─────────────────────────────────────────────────────
//
// With "prompt to install when a download finishes" on, a finished download
// wants to put a dialog on screen. It cannot always have one: the user may be
// mid-way through the update-all run, or reading the About box, and a second
// overlay dropped on top of the first steals the click that was meant for the
// first.
//
// So finished downloads wait in line here and the host asks, on every state
// change, whether it is allowed to present one yet. The rules are separated
// from the component because "may this be shown now" is five conditions ANDed
// together and that is exactly the kind of thing that quietly grows a sixth
// wrong one inside a JSX file.

// Add a finished download to the line.
//
// Guarded on `installable` rather than on state: that flag is the main
// process's own answer (a file on disk, never installed, in a finished state -
// see electron/db/downloads.js), and it is already what the Install button on
// the downloads page is gated on. Recomputing the rule here would be a second
// copy free to disagree.
//
// De-duplicated by id AND against ids already prompted this session, because
// download-updated fires repeatedly for the same row - a percent tick, a
// completed_at write, an install failure - and every one of those events arrives
// with installable still true. Without the second guard, declining a prompt
// re-raises it on the next event, which is a dialog the user cannot get rid of.
export function enqueueInstallPrompt(queue = [], item, prompted = new Set()) {
  if (!item?.id || item.installable !== true) return queue
  if (prompted.has(item.id)) return queue
  if (queue.some((entry) => entry.id === item.id)) return queue
  return [...queue, item]
}

// Whether the host may raise the next prompt.
//
// `blocked` is App's answer for its own modals. `installing` is the main
// process's constraint rather than a presentation one: downloads-install
// refuses a second concurrent install, so prompting for the next archive while
// one is extracting produces a dialog whose only possible outcome is "another
// install is already running".
export function canPresentInstall({
  queue = [],
  blocked = false,
  installing = false,
  activeTarget = null,
  pendingPrompt = false,
} = {}) {
  if (queue.length === 0) return false
  if (blocked) return false
  if (installing) return false
  if (activeTarget) return false
  if (pendingPrompt) return false
  return true
}

// Pop the head. Returns both halves so the caller does not have to remember to
// do the slice itself in two different places.
export function takeNextInstall(queue = []) {
  if (queue.length === 0) return { item: null, rest: queue }
  return { item: queue[0], rest: queue.slice(1) }
}

// Drop a row that is no longer installable — it was installed elsewhere, removed
// from the list, or its archive was cleared. A queue entry is a snapshot taken
// when the download finished, so without this the host can present a dialog for
// an archive that stopped existing while it waited its turn.
export function dropInstallPrompt(queue = [], id) {
  if (id == null) return queue
  return queue.filter((entry) => entry.id !== id)
}
