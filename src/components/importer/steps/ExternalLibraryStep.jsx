import { useCallback, useEffect, useMemo, useState } from 'react'

// ── External library import step ─────────────────────────────────────────────
//
// Entry screen for importing another tool's library. Opened from Settings ->
// Import, not from the importer's own source dropdown, so the importer stays a
// short list of ways to add a game.
//
// Its job is to make the mapping VISIBLE before anything is written. An import
// like this silently moves a lot of personal data — ratings, notes, progress,
// playtime, groupings — and the places it cannot map cleanly (a 0-5 rating into
// eight categories, a game finished at a build that is not installed, a
// category the destination has no home for) are exactly the places a user would
// notice later and assume Atlas got it wrong.
//
// The mapping table itself comes from the READER, not from here. Each provider
// describes what it maps, what it drops and the count behind each row, because
// only the reader knows: F95Checker has tabs and no playtime, XLibrary has
// playtime and no tabs. A table hardcoded here was accurate for exactly one
// provider and quietly wrong for the next one added.
//
// Nothing here writes: it produces rows and hands them to the importer's normal
// review table, where every row can still be corrected or removed.

const CHECK = 'accent-accent h-4 w-4 rounded border-border bg-tertiary'

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
  // Keyed by the option's `key` as declared by the reader, so a provider can
  // offer none, one or several without this component knowing which.
  const [optionValues, setOptionValues] = useState({})

  const label = info?.label || 'External library'
  const sourceNoun = info?.sourceNoun || 'database'

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
      // Defaults come from the reader's own declaration rather than from state
      // initialised before we knew which provider this is.
      setOptionValues(
        Object.fromEntries(
          (scanned.optionalMappings || []).map((option) => [option.key, option.default !== false]),
        ),
      )
      if (scanned.dbPath) setDbPath(scanned.dbPath)
    } catch (err) {
      setError(err.message || 'Could not read the library')
    } finally {
      setReading(false)
    }
  }, [sourceId, dbPath])

  const summary = result?.summary
  const mappingRows = useMemo(() => result?.mapping || [], [result])
  const optionalMappings = useMemo(() => result?.optionalMappings || [], [result])

  const proceed = () => {
    if (!result?.rows?.length) return
    onRows?.(result.rows, { ...optionValues })
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
          Atlas reads the {label} {sourceNoun} and never writes to it. Your games
          stay where they are on disk.
        </p>
      </div>

      {/* ── Source file ──────────────────────────────────────────────────── */}
      <div className="rounded border border-border bg-primary p-3 space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <label className="text-sm sm:w-24 sm:shrink-0 capitalize" htmlFor="external-db-path">
            {sourceNoun}
          </label>
          <input
            id="external-db-path"
            type="text"
            value={dbPath}
            onChange={(event) => { setDbPath(event.target.value); setResult(null) }}
            placeholder={
              info?.pickerHint
                ? `Path to ${info.pickerHint}`
                : `Path to ${info?.databaseName || `the ${sourceNoun}`}`
            }
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

        {/* Detection failing is a normal outcome — a portable install, a custom
            data directory, or a library copied off another machine — so this
            shows the exact paths that were tested rather than only the
            directories. A directory plus a bare filename can describe a path
            detection never tried, which sends the user looking in the wrong
            place. Either way the picker above is always available. */}
        {info && !info.detected && !result && (
          <div className="text-xs text-muted">
            <p className="text-amber-400">No {label} {sourceNoun} found automatically.</p>
            <p className="mt-1">Atlas looked for:</p>
            <ul className="mt-0.5 space-y-0.5 font-mono text-[11px] break-all">
              {(info.searchedPaths?.length ? info.searchedPaths : info.searchedDirs || [])
                .map((target) => <li key={target}>{target}</li>)}
            </ul>
            <p className="mt-1">
              Use <span className="text-text">Browse</span> to pick the file
              yourself, or paste its path above. A copy from another machine works
              here too.
            </p>
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
            <SummaryPill label="to wishlist" value={summary.wishlist ?? 0} />
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
                {summary.withCategoryRatings > 0 && (
                  <p className="mt-2">
                    <span className="font-medium">{summary.withCategoryRatings}</span>{' '}
                    {summary.withCategoryRatings === 1 ? 'game also has' : 'games also have'}{' '}
                    per-category scores. Those map onto the matching Atlas categories by
                    name and take precedence over the overall figure for the categories
                    they cover.
                    {summary.droppedRatingCategories > 0 && (
                      <>
                        {' '}
                        <span className="font-medium">{summary.droppedRatingCategories}</span>{' '}
                        {summary.droppedRatingCategories === 1 ? 'score is' : 'scores are'} in a
                        category Atlas does not have and{' '}
                        {summary.droppedRatingCategories === 1 ? 'is' : 'are'} not imported,
                        rather than being folded into a category where{' '}
                        {summary.droppedRatingCategories === 1 ? 'it' : 'they'} would skew
                        the average.
                      </>
                    )}
                  </p>
                )}
              </div>
            )}

            {/* An export cannot tell us how stale it is beyond its own
                timestamp, so the timestamp is what gets shown. */}
            {result.exportedAt && (
              <div className="rounded border border-border p-3 text-xs text-muted">
                This export was written{' '}
                <span className="text-text">
                  {new Date(result.exportedAt).toLocaleString()}
                </span>
                . Anything you changed in {label} after that is not in the file —
                export again if that matters.
              </div>
            )}

            {result.schemaNewerThanKnown && (
              <div className="rounded border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-text">
                <p className="font-medium text-amber-400">Newer {label} export format</p>
                <p className="mt-1">
                  This file reports format version{' '}
                  <span className="font-mono">{result.schemaVersion}</span>, and Atlas
                  was written against version{' '}
                  <span className="font-mono">{result.knownSchemaVersion}</span>. It has
                  been read anyway, but check the counts below against what you expect
                  before continuing.
                </p>
              </div>
            )}

            {summary.unknownCompletionStatus > 0 && (
              <div className="rounded border border-border p-3 text-xs text-muted">
                <span className="text-text font-medium">{summary.unknownCompletionStatus}</span>{' '}
                {summary.unknownCompletionStatus === 1 ? 'game has' : 'games have'} a
                progress status Atlas does not recognise, so{' '}
                {summary.unknownCompletionStatus === 1 ? 'it keeps' : 'they keep'} no
                playstate rather than being guessed at.
              </div>
            )}

            {summary.otherFolderConfigs > 0 && (
              <div className="rounded border border-border p-3 text-xs text-muted">
                <span className="text-text font-medium">{summary.otherFolderConfigs}</span>{' '}
                {summary.otherFolderConfigs === 1 ? 'game has' : 'games have'} launch
                entries in more than one folder, which is a second install of the same
                game. One Atlas version points at one folder, so the default launch
                entry is used and the others are left out — add them as extra versions
                afterwards if you want them.
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

            {(summary.wishlistMissingPath > 0 || summary.wishlistNoLaunchable > 0) && (
              <div className="rounded border border-border p-3 text-xs text-muted">
                <span className="text-text font-medium">
                  {(summary.wishlistMissingPath || 0) + (summary.wishlistNoLaunchable || 0)}
                </span>{' '}
                of the {summary.wishlist} going to the wishlist{' '}
                {(summary.wishlistMissingPath || 0) + (summary.wishlistNoLaunchable || 0) === 1
                  ? 'is a game'
                  : 'are games'}{' '}
                {label} thinks you have installed, but Atlas could not find anything to
                launch. They go to the wishlist rather than being skipped, so nothing is
                lost either way — but if the drive they live on is not connected right
                now, reconnect it and read the library again to import them properly.
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
          {/* Declared by the reader. Only mappings with a consequence beyond the
              import itself are optional — creating collections, and pinning a
              game's tag list. Everything else always comes across. */}
          {optionalMappings.length > 0 && (
            <div className="rounded border border-border bg-primary p-3 space-y-3">
              <h3 className="text-sm font-medium text-text">Optional</h3>
              {optionalMappings.map((option) => (
                <label key={option.key} className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={optionValues[option.key] !== false}
                    onChange={(event) =>
                      setOptionValues((prev) => ({ ...prev, [option.key]: event.target.checked }))}
                    className={`${CHECK} mt-0.5`}
                  />
                  <span className="text-xs">
                    <span className="text-text">{option.label}</span>
                    {option.detail && (
                      <span className="block text-muted">{option.detail}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}

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
