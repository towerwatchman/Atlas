'use strict'

// ── Database update progress ─────────────────────────────────────────────────
//
// Turns "which package, which phase, how many bytes so far" into the single
// number the progress bar draws, plus the line of text above it.
//
// The bar used to be handed `processed` — a count of packages that had finished
// EVERYTHING. So it moved once per package and sat frozen in between, and the
// longest freeze was the one nobody could explain: the network transfer, where
// the text said "Downloading Database Update 3/25" and nothing moved until the
// whole package had landed. On a slow link that is indistinguishable from a
// hang.
//
// Progress is now fractional within a package. The download owns the first half
// of each package's share and advances with the bytes; the three metadata insert
// phases split the rest.
//
// ── Why the download gets half ───────────────────────────────────────────────
//
// Not measured, chosen. The real split varies wildly — a fat snapshot package on
// a fast connection is nearly all insert time, the same package abroad is nearly
// all transfer. Half is the honest compromise: neither phase can stall the bar
// for more than half a package's width, which is the property that matters. It
// is a progress bar, not a stopwatch.

const PHASE_STARTS = {
  download: 0,
  atlas: 0.5,
  f95: 0.67,
  lewdcorner: 0.84,
  // Reconciliation only runs for snapshot packages, so it shares the tail with
  // lewdcorner rather than claiming a slice every package would have to pay for.
  reconcile: 0.92,
  done: 1,
}

// The download's share of one package. The remainder is the insert phases.
const DOWNLOAD_SHARE = PHASE_STARTS.atlas

/**
 * Where the bar should sit, in units of packages.
 *
 * @param {number} processed     Packages fully finished before this one.
 * @param {string} phase         A key of PHASE_STARTS.
 * @param {number} byteFraction  0..1, only meaningful during 'download'.
 * @returns {number}             processed <= value < processed + 1
 */
function packageProgress(processed = 0, phase = 'download', byteFraction = 0) {
  const base = Number.isFinite(processed) && processed > 0 ? processed : 0
  const start = PHASE_STARTS[phase] ?? 0

  if (phase !== 'download') return base + start

  // Guard the fraction rather than trusting it: axios reports `total` as
  // undefined when the server omits Content-Length, and loaded/undefined is
  // NaN. A NaN here silently blanks the bar (width: NaN%), which is how a
  // missing header would have turned into an invisible progress bar.
  const fraction = Number(byteFraction)
  if (!Number.isFinite(fraction) || fraction <= 0) return base
  return base + Math.min(fraction, 1) * DOWNLOAD_SHARE
}

/**
 * Bytes to a short human string. Deliberately coarse — this sits in a 300px
 * label next to a counter, and a second decimal place is noise at that size.
 */
function formatUpdateBytes(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value <= 0) return null
  const mb = value / (1024 * 1024)
  if (mb >= 1) return `${mb.toFixed(1)} MB`
  return `${Math.max(1, Math.round(value / 1024))} KB`
}

/**
 * The line above the bar during a transfer.
 *
 * Falls back to the bare "Downloading Database Update 3/25" when the size is
 * unknown, which happens whenever the server omits Content-Length. Showing
 * "4.2 MB of 0 MB" would be worse than showing nothing.
 */
function downloadText(position, total, loaded = 0, size = 0) {
  const head = `Downloading Database Update ${position}/${total}`
  const totalText = formatUpdateBytes(size)
  if (!totalText) return head
  // The loaded side is allowed to read 0 — a transfer that has not started is a
  // true statement, and it makes the first tick visible rather than jumping.
  const loadedMb = Math.max(0, Number(loaded) || 0) / (1024 * 1024)
  return `${head} (${loadedMb.toFixed(1)} / ${totalText})`
}

/**
 * Which package the counter under the bar should name.
 *
 * Progress is fractional now, so the raw value would render as "Update 3.4/25".
 * Floor-plus-one names the package being WORKED ON rather than the count
 * completed — which also fixes the old bar opening on "Update 0/25" before
 * anything had a chance to finish.
 */
function currentPackageNumber(progress, total) {
  const value = Number(progress)
  const count = Number(total)
  if (!Number.isFinite(value) || !Number.isFinite(count) || count <= 0) return 0
  if (value >= count) return count
  return Math.min(Math.floor(Math.max(value, 0)) + 1, count)
}

module.exports = {
  PHASE_STARTS,
  DOWNLOAD_SHARE,
  packageProgress,
  formatUpdateBytes,
  downloadText,
  currentPackageNumber,
}
