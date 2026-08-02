import { useCallback, useEffect, useMemo, useState } from 'react'

// ── External library import step ─────────────────────────────────────────────
//
// Entry screen for importing another tool's library (F95Checker today). Opened
// from Settings -> Import, not from the importer's own source dropdown, so the
// importer stays a short list of ways to add a game.
//
// Its job is to make the mapping VISIBLE before anything is written. An import
// like this silently moves a lot of personal data — ratings, notes, finished
// state, groupings — and the two places it can't map cleanly (a 0-5 rating into
// eight categories, and a game finished at a build that isn't installed) are
// exactly the places a user would notice later and assume Atlas got it wrong.
// So the field mapping is shown as a table with live counts off their own data,
// and the two lossy mappings are explained where they happen.
//
// Nothing here writes: it produces rows and hands them to the importer's normal
// review table, where every row can still be corrected or removed.

const CHECK = 'accent-accent h-4 w-4 rounded border-border bg-tertiary'

// What goes where. `count` reads off the summary so the numbers are the user's
// own, not a generic promise. Rows with no destination are listed too — leaving
// them out would be the same as hiding that they're dropped.
const buildMappingRows = (summary, tabCount) => [
  {
    from: 'Game + developer',
    to: 'Title and creator',
    detail: 'Matched against the Atlas catalog by thread ID',
    count: summary.imported,
  },
  {
    from: 'Installed version + executable',
    to: 'Version, game path, executable',
    detail: 'Left where they are on disk — nothing is moved or copied',
    count: summary.installed,
  },
  {
    from: 'Finished version',
    to: 'Playstate "finished"',
    detail: 'Set on the matching version where possible',
    count: summary.withFinished,
  },
  {
    from: 'Last launched',
    to: 'Last played',
    detail: 'F95Checker stores no playtime, so playtime stays empty',
    count: summary.withRating >= 0 ? summary.imported : 0,
    muted: true,
  },
  {
    from: 'Rating (0-5)',
    to: 'Story rating (0-10)',
    detail: 'Doubled to the Atlas scale — see the note below',
    count: summary.withRating,
  },
  {
    from: 'Notes',
    to: 'Notes',
    detail: 'Editable afterwards under the game\u2019s Record tab',
    count: summary.withNotes,
  },
  {
    from: 'Labels',
    to: 'Tags',
    detail: 'Added alongside the catalog tags, not replacing them',
    count: summary.withLabels,
  },
  {
    from: 'Tabs',
    to: 'Collections',
    detail: tabCount ? `${tabCount} collection${tabCount === 1 ? '' : 's'} will be created or reused` : 'No tabs in this library',
    count: summary.withTab,
  },
  {
    from: 'Tracked, nothing on disk',
    to: 'Watchlist',
    detail: 'Pre-ticked on the review screen — untick any you want in the library',
    count: summary.watchlist,
  },
  {
    from: 'Status, type, tags, description, score',
    to: 'Not imported',
    detail: 'Atlas already has these from its own catalog and keeps them updated',
    count: null,
    muted: true,
  },
]

function SummaryPill({ label, value, tone = 'default' }) {
  const tones = {
    default: 'border-border text-text',
    warn: 'border-amber-500/40 text-amber-400',
    muted: 'border-border/60 text-muted',
  }
  return (
    <div className={`rounded border px-2.5 py-1.5 ${tones[tone]}`}>
      <div className="text-base leading-none font-medium">{value}</div>
      <div className="text-[10px] leading-tight text-muted mt-0.5">{label}</div>
    </div>
  )
}

export default function ExternalLibraryStep({
  sourceId = 'f95checker',
  onRows,
  onBack,
}) {
  const [info, setInfo] = useState(null)
  const [dbPath, setDbPath] = useState('')
  const [loading, setLoading] = useState(true)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [importLabelsAsTags, setImportLabelsAsTags] = useState(true)
  const [importTabsAsCollections, setImportTabsAsCollections] = useState(true)

  const label = info?.label || 'External library'

  // Auto-detect on mount. Detection failing is a normal outcome (portable
  // install, custom data dir, database copied from another machine), so it shows
  // where we looked rather than just reporting failure.
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const described = await window.electronAPI.describeExternalLibrary?.(sourceId)
        if (cancelled) return
        if (described?.success) {
          setInfo(described)
          setDbPath(described.detectedPath || '')
        } else {
          setError(described?.error || 'Could not check for an external library')
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not check for an external library')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [sourceId])

  const browse = useCallback(async () => {
    try {
      const picked = await window.electronAPI.selectExternalLibraryFile?.(sourceId)
      if (picked?.success && picked.path) {
        setDbPath(picked.path)
        setResult(null)
        setError('')
      }
    } catch (err) {
      setError(err.message || 'Could not open the file picker')
    }
  }, [sourceId])

  const read = useCallback(async () => {
    setReading(true)
    setError('')
    setResult(null)
    try {
      const scanned = await window.electronAPI.scanExternalLibrary?.({ id: sourceId, path: dbPath })
      if (!scanned?.success) {
        setError(scanned?.error || 'Could not read the library')
        return
      }
      setResult(scanned)
      if (scanned.dbPath) setDbPath(scanned.dbPath)
    } catch (err) {
      setError(err.message || 'Could not read the library')
    } finally {
      setReading(false)
    }
  }, [sourceId, dbPath])

  const summary = result?.summary
  const mappingRows = useMemo(
    () => (summary ? buildMappingRows(summary, (result?.tabs || []).length) : []),
    [summary, result],
  )

  const proceed = () => {
    if (!result?.rows?.length) return
    onRows?.(result.rows, { importLabelsAsTags, importTabsAsCollections })
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-muted text-sm">
        Looking for your library&hellip;
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4 scroll-window-inset">
      <div>
        <h2 className="text-lg font-medium text-text">Import from {label}</h2>
        <p className="text-xs text-muted mt-1 max-w-2xl">
          Atlas reads a copy of the {label} database and never writes to it. Your
          games stay where they are on disk.
        </p>
      </div>

      {/* ── Source file ──────────────────────────────────────────────────── */}
      <div className="rounded border border-border bg-primary p-3 space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <label className="text-sm sm:w-24 sm:shrink-0" htmlFor="external-db-path">
            Database
          </label>
          <input
            id="external-db-path"
            type="text"
            value={dbPath}
            onChange={(event) => { setDbPath(event.target.value); setResult(null) }}
            placeholder={`Path to ${info?.databaseName || 'the database file'}`}
            className="flex-1 min-w-0 bg-tertiary border border-border rounded p-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={browse}
              className="h-8 px-3 text-xs rounded-buttonTheme bg-tertiary hover:bg-selected text-text"
            >
              Browse&hellip;
            </button>
            <button
              type="button"
              onClick={read}
              disabled={!dbPath || reading}
              className={`h-8 px-3 text-xs rounded-buttonTheme text-white ${
                !dbPath || reading
                  ? 'bg-tertiary text-muted cursor-not-allowed opacity-70'
                  : 'bg-accent hover:bg-accentHover'
              }`}
            >
              {reading ? 'Reading\u2026' : 'Read library'}
            </button>
          </div>
        </div>

        {info && !info.detected && !result && (
          <div className="text-xs text-muted">
            <p className="text-amber-400">No {label} database found automatically.</p>
            <p className="mt-1">Atlas looked in:</p>
            <ul className="mt-0.5 space-y-0.5 font-mono text-[11px]">
              {(info.searchedDirs || []).map((dir) => <li key={dir}>{dir}</li>)}
            </ul>
            <p className="mt-1">Use Browse to point at the file yourself.</p>
          </div>
        )}

        {error && <p className="text-xs text-danger">{error}</p>}
      </div>

      {/* ── What was found + how it maps ─────────────────────────────────── */}
      {summary && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            <SummaryPill label="games to import" value={summary.imported} />
            <SummaryPill label="installed on disk" value={summary.installed} />
            <SummaryPill
              label="archived, skipped"
              value={summary.archived}
              tone={summary.archived ? 'warn' : 'muted'}
            />
            <SummaryPill
              label="install path missing"
              value={summary.missingInstall}
              tone={summary.missingInstall ? 'warn' : 'muted'}
            />
            <SummaryPill
              label="custom entries"
              value={summary.custom}
              tone={summary.custom ? 'warn' : 'muted'}
            />
            <SummaryPill label="to watchlist" value={summary.watchlist ?? 0} />
            <SummaryPill
              label="no source link"
              value={summary.unidentified ?? 0}
              tone={summary.unidentified ? 'warn' : 'muted'}
            />
          </div>

          <div className="rounded border border-border bg-primary overflow-hidden">
            <div className="px-3 py-2 border-b border-border">
              <h3 className="text-sm font-medium text-text">How your data will be mapped</h3>
              <p className="text-[11px] text-muted mt-0.5">
                Counts are from your own library. Nothing is written until you
                confirm on the next screen.
              </p>
            </div>
            {/* Table on wide windows, stacked cards on narrow ones — the importer
                window can be resized well below a usable table width. */}
            <div className="divide-y divide-border">
              {mappingRows.map((row) => (
                <div
                  key={row.from}
                  className={`px-3 py-2 grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-x-3 gap-y-0.5 items-baseline ${
                    row.muted ? 'text-muted' : 'text-text'
                  }`}
                >
                  <div className="text-xs">{row.from}</div>
                  <div className="text-xs">
                    <span className="sm:hidden text-muted">&rarr; </span>
                    {row.to}
                    <span className="block text-[11px] text-muted">{row.detail}</span>
                  </div>
                  <div className="text-xs text-muted sm:text-right whitespace-nowrap">
                    {row.count === null ? '\u2014' : `${row.count} game${row.count === 1 ? '' : 's'}`}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Caveats, shown only when they actually apply ───────────────── */}
          <div className="space-y-2">
            {summary.withRating > 0 && (
              <div className="rounded border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-text">
                <p className="font-medium text-amber-400">About imported ratings</p>
                <p className="mt-1">
                  {label} stores one overall star rating. Atlas rates eight
                  categories separately, so your rating is imported into{' '}
                  <span className="font-medium">Story</span> (doubled from 0-5 to
                  0-10). Until you rate the other categories, a game&rsquo;s
                  overall score will be based on Story alone &mdash; so rating
                  another category later can make the overall number go down.
                  Ratings you have already set in Atlas are never overwritten.
                </p>
              </div>
            )}

            {result.journalPresent && (
              <div className="rounded border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-text">
                <p className="font-medium text-amber-400">{label} looks like it&rsquo;s still open</p>
                <p className="mt-1">
                  It saves changes every 30 seconds, so anything you changed in
                  the last half minute may be missing. Close {label} and read the
                  library again for a complete snapshot.
                </p>
              </div>
            )}

            {summary.custom > 0 && (
              <div className="rounded border border-border p-3 text-xs text-muted">
                <span className="text-text font-medium">{summary.custom}</span>{' '}
                {summary.custom === 1 ? 'entry was' : 'entries were'} created by
                hand in {label} rather than from a forum thread, so the entry ID
                is not a thread ID.
                {summary.recoveredIds > 0 && (
                  <>
                    {' '}
                    <span className="text-text font-medium">{summary.recoveredIds}</span>{' '}
                    of {summary.custom === 1 ? 'them' : 'those'} still link to a
                    real thread, so Atlas reads the ID out of the link and
                    matches on it exactly.
                  </>
                )}
                {summary.unidentified > 0 && (
                  <>
                    {' '}
                    <span className="text-text font-medium">{summary.unidentified}</span>{' '}
                    {summary.unidentified === 1 ? 'has' : 'have'} no F95 or
                    LewdCorner link at all and will be matched by title and
                    developer &mdash; check {summary.unidentified === 1 ? 'it' : 'those'}{' '}
                    on the next screen.
                  </>
                )}
              </div>
            )}

            {summary.missingInstall > 0 && (
              <div className="rounded border border-border p-3 text-xs text-muted">
                <span className="text-text font-medium">{summary.missingInstall}</span>{' '}
                {summary.missingInstall === 1 ? 'game has' : 'games have'} an
                install path recorded in {label} that Atlas could not find. The
                full path it looked for is shown in the Executable column on the
                next screen.
                {summary.relativePaths > 0 && (
                  <>
                    {' '}
                    {label} stores most paths relative to its games folder
                    {result?.exeBaseDir
                      ? <> (<span className="text-text font-mono">{result.exeBaseDir}</span>)</>
                      : ', which is not set in this database'}
                    . If that folder is on a drive that is not connected right
                    now, reconnect it and scan again rather than importing these
                    without a path.
                  </>
                )}
              </div>
            )}
          </div>

          {/* ── Opt-in mappings ───────────────────────────────────────────── */}
          <div className="rounded border border-border bg-primary p-3 space-y-3">
            <h3 className="text-sm font-medium text-text">Optional</h3>

            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={importTabsAsCollections}
                onChange={(event) => setImportTabsAsCollections(event.target.checked)}
                className={`${CHECK} mt-0.5`}
              />
              <span className="text-xs">
                <span className="text-text">Recreate tabs as collections</span>
                <span className="block text-muted">
                  {(result.tabs || []).length > 0
                    ? `Creates or reuses: ${result.tabs.join(', ')}`
                    : 'No tabs found in this library'}
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={importLabelsAsTags}
                onChange={(event) => setImportLabelsAsTags(event.target.checked)}
                className={`${CHECK} mt-0.5`}
              />
              <span className="text-xs">
                <span className="text-text">Import labels as tags</span>
                {/* Worth stating plainly: this is the one optional mapping with a
                    lasting side effect, because any tag edit pins the list. */}
                <span className="block text-muted">
                  Labels are added alongside the catalog tags. Because editing a
                  game&rsquo;s tags marks the list as yours, those games will stop
                  picking up new tags from catalog updates.
                </span>
              </span>
            </label>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2 pb-2">
            <button
              type="button"
              onClick={proceed}
              disabled={!result.rows?.length}
              className={`h-9 px-4 rounded-buttonTheme text-white text-sm ${
                result.rows?.length
                  ? 'bg-accent hover:bg-accentHover'
                  : 'bg-tertiary text-muted cursor-not-allowed opacity-70'
              }`}
            >
              Continue to review ({summary.imported})
            </button>
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="h-9 px-4 rounded-buttonTheme bg-tertiary hover:bg-selected text-text text-sm"
              >
                Back
              </button>
            )}
            <p className="text-[11px] text-muted sm:ml-2">
              You can still change matches or drop rows on the review screen.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
