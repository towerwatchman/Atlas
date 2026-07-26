import { useState, useEffect, useCallback } from 'react'

// Settings → Database. Lets the user audit the local library for games whose
// Atlas mapping is no longer valid (remote-removed, orphaned, or never mapped)
// and remap them inline without leaving the page.
//
// Detection lives entirely in the backend (run-db-audit, a read-only query).
// The remap flow reuses the same searchAtlas / addAtlasMapping IPC as the game
// properties Find Match feature.

const REASON_LABELS = {
  removed: 'Removed from remote',
  orphaned: 'Orphaned mapping',
  unmapped: 'Never mapped',
}

const REASON_HELP = {
  removed: 'The catalog entry this game was mapped to no longer exists on the remote. Metadata is now stale.',
  orphaned: 'This game is mapped to a catalog ID that is no longer in the local database.',
  unmapped: 'This game was never matched to a catalog entry.',
}

const REASON_BADGE = {
  removed: 'bg-danger/20 text-danger border-danger/40',
  orphaned: 'bg-amber-500/20 text-amber-400 border-amber-500/40',
  unmapped: 'bg-secondary text-muted border-border',
}

function formatRemovedDate(value) {
  if (!value) return null
  // removed_from_server is stored as the snapshot date (may be a unix seconds
  // value or an ISO/date string depending on the package). Render best-effort.
  const asNum = Number(value)
  let date = null
  if (Number.isFinite(asNum) && asNum > 0) {
    date = new Date(asNum < 1e12 ? asNum * 1000 : asNum)
  } else {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) date = parsed
  }
  if (!date || Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString()
}

export default function Database() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null) // { items, summary, total } or null
  const [error, setError] = useState('')
  const [hasRun, setHasRun] = useState(false)

  // Inline remap modal state
  const [remapTarget, setRemapTarget] = useState(null) // the audit item being remapped
  const [remapQuery, setRemapQuery] = useState({ title: '', creator: '' })
  const [remapResults, setRemapResults] = useState([])
  const [remapSearching, setRemapSearching] = useState(false)
  const [remapBusy, setRemapBusy] = useState(false)
  const [remapError, setRemapError] = useState('')

  // Season/version merge state
  const [mergeLoading, setMergeLoading] = useState(false)
  const [mergeItems, setMergeItems] = useState(null) // array or null (not run)
  const [mergeError, setMergeError] = useState('')
  const [mergeBusyId, setMergeBusyId] = useState(null) // atlasId currently merging
  const [mergeAllBusy, setMergeAllBusy] = useState(false)

  const runMergeAudit = useCallback(async () => {
    setMergeLoading(true)
    setMergeError('')
    try {
      const res = await window.electronAPI.auditSeasonMerges?.()
      if (!res || res.success === false) {
        setMergeError(res?.error || 'Scan failed')
        setMergeItems([])
      } else {
        setMergeItems(res.items || [])
      }
    } catch (err) {
      setMergeError(err.message || 'Scan failed')
      setMergeItems([])
    } finally {
      setMergeLoading(false)
    }
  }, [])

  const mergeGroup = async (item) => {
    setMergeBusyId(item.atlasId)
    setMergeError('')
    try {
      const res = await window.electronAPI.applySeasonMerge?.(item.atlasId, item.survivorRecordId)
      if (!res || res.success === false) {
        setMergeError(res?.error || 'Merge failed')
        return
      }
      setMergeItems((prev) => (prev || []).filter((i) => i.atlasId !== item.atlasId))
      window.dispatchEvent(new CustomEvent('atlas:library-changed'))
    } catch (err) {
      setMergeError(err.message || 'Merge failed')
    } finally {
      setMergeBusyId(null)
    }
  }

  const mergeAll = async () => {
    setMergeAllBusy(true)
    setMergeError('')
    try {
      const res = await window.electronAPI.applyAllSeasonMerges?.()
      if (!res || res.success === false) {
        setMergeError(res?.error || 'Merge failed')
        return
      }
      setMergeItems([])
      window.dispatchEvent(new CustomEvent('atlas:library-changed'))
    } catch (err) {
      setMergeError(err.message || 'Merge failed')
    } finally {
      setMergeAllBusy(false)
    }
  }

  const runAudit = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await window.electronAPI.runDbAudit?.()
      if (!res || res.success === false) {
        setError(res?.error || 'Audit failed')
        setResult(null)
      } else {
        setResult(res)
      }
      setHasRun(true)
    } catch (err) {
      setError(err.message || 'Audit failed')
      setResult(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const openRemap = async (item) => {
    setRemapTarget(item)
    setRemapQuery({ title: item.title || '', creator: item.creator || '' })
    setRemapResults([])
    setRemapError('')
    // Kick off an initial search using the game's own title/creator.
    await searchRemap(item.title || '', item.creator || '')
  }

  const searchRemap = async (title, creator) => {
    setRemapSearching(true)
    setRemapError('')
    try {
      const results = await window.electronAPI.searchAtlas?.(title, creator)
      setRemapResults(Array.isArray(results) ? results : [])
    } catch (err) {
      setRemapError(err.message || 'Search failed')
      setRemapResults([])
    } finally {
      setRemapSearching(false)
    }
  }

  const applyRemap = async (atlasId) => {
    if (!remapTarget) return
    setRemapBusy(true)
    setRemapError('')
    try {
      await window.electronAPI.addAtlasMapping?.(remapTarget.recordId, atlasId)
      // Remove the remapped game from the current list and refresh counts.
      setResult((prev) => {
        if (!prev) return prev
        const items = prev.items.filter((i) => i.recordId !== remapTarget.recordId)
        const summary = { ...prev.summary }
        if (summary[remapTarget.reason] > 0) summary[remapTarget.reason] -= 1
        return { ...prev, items, summary, total: items.length }
      })
      setRemapTarget(null)
    } catch (err) {
      setRemapError(err.message || 'Remap failed')
    } finally {
      setRemapBusy(false)
    }
  }

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !remapBusy) setRemapTarget(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [remapBusy])

  // ── Full client check ─────────────────────────────────────────────────────
  // Read-only audit first; every repair is opted into per section, and the
  // confirmation names exactly what that repair will change.
  const [auditRunning, setAuditRunning] = useState(false)
  const [auditReport, setAuditReport] = useState(null)
  const [auditErr, setAuditErr] = useState('')
  const [expandedSection, setExpandedSection] = useState(null)
  const [pendingRepair, setPendingRepair] = useState(null)
  const [repairBusyId, setRepairBusyId] = useState(null)
  const [repairResults, setRepairResults] = useState({})

  const runClientCheck = useCallback(async () => {
    setAuditRunning(true)
    setAuditErr('')
    setRepairResults({})
    setPendingRepair(null)
    try {
      const res = await window.electronAPI.runClientAudit?.()
      if (res?.success) setAuditReport(res)
      else setAuditErr(res?.error || 'Client check failed.')
    } catch (err) {
      setAuditErr(err?.message || String(err))
    } finally {
      setAuditRunning(false)
    }
  }, [])

  const applyRepair = useCallback(async (sectionId) => {
    setRepairBusyId(sectionId)
    setPendingRepair(null)
    try {
      const res = await window.electronAPI.repairClientAuditSection?.(sectionId)
      setRepairResults((prev) => ({
        ...prev,
        [sectionId]: res?.success
          ? { ok: true, changes: res.changes || [] }
          : { ok: false, error: res?.error || 'Repair failed.' },
      }))
    } catch (err) {
      setRepairResults((prev) => ({
        ...prev, [sectionId]: { ok: false, error: err?.message || String(err) },
      }))
    } finally {
      setRepairBusyId(null)
    }
  }, [])

  // ── Browse catalog index ──────────────────────────────────────────────────
  // Kept as an explicit control rather than something automatic-only, because a
  // stale index is invisible from the UI: Browse would still return results,
  // just in the wrong order or missing entries added since the last refresh.
  const [indexStatus, setIndexStatus] = useState(null)
  const [indexBusy, setIndexBusy] = useState(false)
  const [indexProgress, setIndexProgress] = useState(null)
  const [indexError, setIndexError] = useState('')
  const [indexResult, setIndexResult] = useState(null)

  const loadIndexStatus = useCallback(async () => {
    try {
      const res = await window.electronAPI.getCatalogIndexStatus?.()
      setIndexStatus(res || null)
    } catch (err) {
      setIndexError(err?.message || String(err))
    }
  }, [])

  useEffect(() => { loadIndexStatus() }, [loadIndexStatus])

  useEffect(() => {
    const off = window.electronAPI.onCatalogIndexProgress?.((payload) => {
      setIndexProgress(payload || null)
    })
    return () => { if (typeof off === 'function') off() }
  }, [])

  const rebuildIndex = useCallback(async () => {
    setIndexBusy(true)
    setIndexError('')
    setIndexResult(null)
    setIndexProgress(null)
    try {
      const res = await window.electronAPI.rebuildCatalogIndex?.()
      if (res?.success) setIndexResult(res)
      else setIndexError(res?.error || 'Rebuild failed.')
    } catch (err) {
      setIndexError(err?.message || String(err))
    } finally {
      setIndexBusy(false)
      setIndexProgress(null)
      loadIndexStatus()
    }
  }, [loadIndexStatus])

  const summary = result?.summary
  const items = result?.items || []

  return (
    <div className="p-6 space-y-5 text-text overflow-y-auto h-full">
      <div>
        <h1 className="text-xl font-semibold">Database</h1>
        <p className="text-sm text-muted mt-1 max-w-2xl">
          The remote catalog changes over time. When a catalog entry your library relied on is removed,
          the local metadata stays put but stops receiving updates. Run an audit to find games that need remapping.
        </p>
      </div>

      {/* ── Full client check ─────────────────────────────────────────────── */}
      <div className="border border-border rounded p-4 space-y-3" data-tour="ClientCheck">
        <div>
          <h2 className="text-base font-semibold">Full client check</h2>
          <p className="text-sm text-muted mt-1 max-w-2xl">
            Checks your configuration, database, library files, images and the Browse index.
            Nothing is changed by running it — each section reports what it found, and you
            approve any repair separately.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={runClientCheck}
            disabled={auditRunning}
            className="px-4 py-2 bg-accent hover:bg-accentHover text-white rounded-buttonTheme disabled:opacity-50"
          >
            {auditRunning ? 'Checking…' : 'Run full client check'}
          </button>
          {auditReport && !auditRunning && (
            <span className="text-sm text-muted">
              {auditReport.totalIssues === 0
                ? 'No problems found.'
                : `${auditReport.totalIssues.toLocaleString()} item(s) across ${
                    auditReport.sections.filter((x) => x.status !== 'ok').length} section(s).`}
              {' '}Took {((auditReport.durationMs || 0) / 1000).toFixed(1)}s.
            </span>
          )}
        </div>

        {auditErr && <div className="text-sm text-danger">{auditErr}</div>}

        {auditReport?.sections?.length > 0 && (
          <div className="divide-y divide-border border border-border rounded">
            {auditReport.sections.map((sec) => {
              const open = expandedSection === sec.id
              const repaired = repairResults[sec.id]
              const busy = repairBusyId === sec.id
              const badge =
                sec.status === 'error'
                  ? { text: 'Error', cls: 'border-danger text-danger' }
                  : sec.status === 'issues'
                    ? { text: `${sec.count}`, cls: 'border-accent text-accent' }
                    : { text: 'OK', cls: 'border-border text-muted' }
              return (
                <div key={sec.id} className="p-3">
                  <button
                    className="w-full flex items-start gap-3 text-left"
                    onClick={() => setExpandedSection(open ? null : sec.id)}
                    aria-expanded={open}
                  >
                    <span className={`mt-0.5 px-2 py-0.5 text-[11px] rounded border flex-shrink-0 ${badge.cls}`}>
                      {badge.text}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{sec.label}</span>
                      <span className="block text-xs text-muted mt-0.5">{sec.description}</span>
                    </span>
                    <i className={`fas fa-chevron-${open ? 'up' : 'down'} text-xs mt-1 text-muted`} aria-hidden="true" />
                  </button>

                  {open && (
                    <div className="mt-3 pl-1 space-y-3">
                      {sec.error && <div className="text-sm text-danger">{sec.error}</div>}

                      {sec.findings.map((f, i) => (
                        <div key={i} className="text-sm">
                          <div className="flex items-baseline gap-2">
                            {f.count > 0 && (
                              <span className="text-accent font-medium">{f.count.toLocaleString()}</span>
                            )}
                            <span>{f.label}</span>
                          </div>
                          {f.detail && <div className="text-xs text-muted mt-0.5">{f.detail}</div>}
                          {f.samples?.length > 0 && (
                            <ul className="mt-1 text-xs text-muted list-disc list-inside space-y-0.5">
                              {f.samples.map((sample, j) => <li key={j} className="truncate">{sample}</li>)}
                              {f.count > f.samples.length && (
                                <li className="italic">…and {(f.count - f.samples.length).toLocaleString()} more</li>
                              )}
                            </ul>
                          )}
                        </div>
                      ))}

                      {sec.repairable && !repaired && pendingRepair !== sec.id && (
                        <button
                          onClick={() => setPendingRepair(sec.id)}
                          disabled={busy}
                          className="px-3 py-1.5 text-sm bg-button hover:bg-buttonHover rounded-buttonTheme disabled:opacity-50"
                        >
                          {sec.repairLabel}
                        </button>
                      )}

                      {/* Approval step: state the effect before doing it. */}
                      {pendingRepair === sec.id && (
                        <div className="border border-accent rounded p-3 space-y-2">
                          <div className="text-sm font-medium">This will:</div>
                          <ul className="text-sm text-muted list-disc list-inside space-y-1">
                            {sec.willChange.map((line, i) => <li key={i}>{line}</li>)}
                          </ul>
                          <div className="flex items-center gap-2 pt-1">
                            <button
                              onClick={() => applyRepair(sec.id)}
                              disabled={busy}
                              className="px-3 py-1.5 text-sm bg-accent hover:bg-accentHover text-white rounded-buttonTheme disabled:opacity-50"
                            >
                              {busy ? 'Working…' : 'Continue'}
                            </button>
                            <button
                              onClick={() => setPendingRepair(null)}
                              disabled={busy}
                              className="px-3 py-1.5 text-sm bg-button hover:bg-buttonHover rounded-buttonTheme disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {repaired && (
                        <div className={`text-sm ${repaired.ok ? 'text-muted' : 'text-danger'}`}>
                          {repaired.ok ? (
                            <>
                              <div className="font-medium text-text">Done.</div>
                              <ul className="list-disc list-inside mt-1 space-y-0.5">
                                {repaired.changes.map((c, i) => <li key={i}>{c}</li>)}
                              </ul>
                              <div className="mt-1 text-xs">Re-run the check to confirm.</div>
                            </>
                          ) : repaired.error}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="border border-border rounded p-4 space-y-3">
        <div>
          <h2 className="text-base font-semibold">Browse catalog index</h2>
          <p className="text-sm text-muted mt-1 max-w-2xl">
            Browse filters and sorts against a compact index of the catalog instead of rebuilding
            the full metadata join on every query. It refreshes automatically as catalog updates
            arrive; rebuild it here if Browse looks out of date, is missing entries, or is sorted
            wrongly. Your library and metadata are not touched.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={rebuildIndex}
            disabled={indexBusy}
            className="px-4 py-2 bg-accent hover:bg-accentHover text-white rounded-buttonTheme disabled:opacity-50"
          >
            {indexBusy ? 'Rebuilding…' : 'Rebuild index'}
          </button>

          {indexStatus && !indexBusy && (
            <span className="text-sm text-muted">
              {indexStatus.ready
                ? `${(indexStatus.rowCount || 0).toLocaleString()} entries indexed`
                : indexStatus.rowCount > 0
                  ? `Out of date - ${(indexStatus.rowCount || 0).toLocaleString()} entries indexed`
                  : 'Not built yet'}
              {indexStatus.builtAt
                ? ` - last built ${new Date(indexStatus.builtAt).toLocaleString()}`
                : ''}
            </span>
          )}
        </div>

        {indexBusy && (
          <div className="space-y-1">
            <div className="text-sm text-muted">
              {indexProgress?.message || 'Preparing…'}
            </div>
            <div className="h-1.5 w-full max-w-md bg-tertiary rounded overflow-hidden">
              <div
                className="h-full bg-accent transition-[width] duration-200"
                style={{
                  width: indexProgress?.total
                    ? `${Math.min(100, Math.round((indexProgress.processed / indexProgress.total) * 100))}%`
                    : '15%',
                }}
                role="progressbar"
                aria-valuenow={indexProgress?.total ? indexProgress.processed : undefined}
                aria-valuemin={0}
                aria-valuemax={indexProgress?.total || undefined}
                aria-label="Rebuilding browse catalog index"
              />
            </div>
          </div>
        )}

        {indexResult && (
          <div className="text-sm text-muted">
            Rebuilt {(indexResult.totalRows || 0).toLocaleString()} entries in{' '}
            {((indexResult.durationMs || 0) / 1000).toFixed(1)}s
            {typeof indexResult.steamLinks === 'number'
              ? `, resolved ${indexResult.steamLinks.toLocaleString()} Steam links`
              : ''}
            .
          </div>
        )}

        {indexError && <div className="text-sm text-danger">{indexError}</div>}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={runAudit}
          disabled={loading}
          className="px-4 py-2 bg-accent hover:bg-accentHover text-white rounded disabled:opacity-50"
        >
          {loading ? 'Auditing…' : 'Run Database Audit'}
        </button>
        {summary && (
          <div className="flex items-center gap-2 text-sm">
            <span className={`px-2 py-0.5 rounded border ${REASON_BADGE.removed}`}>{summary.removed} removed</span>
            <span className={`px-2 py-0.5 rounded border ${REASON_BADGE.orphaned}`}>{summary.orphaned} orphaned</span>
            <span className={`px-2 py-0.5 rounded border ${REASON_BADGE.unmapped}`}>{summary.unmapped} unmapped</span>
          </div>
        )}
      </div>

      {error && <div className="text-sm text-danger">{error}</div>}

      {hasRun && !loading && !error && items.length === 0 && (
        <div className="text-sm text-muted border border-border rounded p-4">
          All mappings are valid — nothing needs remapping.
        </div>
      )}

      {items.length > 0 && (
        <div className="border border-border rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-muted">
              <tr>
                <th className="text-left font-medium px-3 py-2">Game</th>
                <th className="text-left font-medium px-3 py-2">Creator</th>
                <th className="text-left font-medium px-3 py-2">Issue</th>
                <th className="text-left font-medium px-3 py-2">Removed</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${item.recordId}-${item.reason}`} className="border-t border-border">
                  <td className="px-3 py-2">{item.title}</td>
                  <td className="px-3 py-2 text-muted">{item.creator}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded border text-xs ${REASON_BADGE[item.reason] || REASON_BADGE.unmapped}`} title={REASON_HELP[item.reason]}>
                      {REASON_LABELS[item.reason] || item.reason}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted">{formatRemovedDate(item.removedDate) || '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => openRemap(item)}
                      className="px-3 py-1 bg-button hover:bg-buttonHover rounded"
                    >
                      Remap
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Season / duplicate-game merge */}
      <div className="pt-6 mt-2 border-t border-border space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Merge duplicate games</h2>
          <p className="text-sm text-muted mt-1 max-w-2xl">
            Some games appear more than once in your library — most often Steam titles whose
            seasons are separate store entries but map to a single catalog game. Merging folds
            them into one game with each entry available as a selectable version. Per-version
            playtime is preserved. Only games linked to the same catalog entry are merged.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={runMergeAudit}
            disabled={mergeLoading || mergeAllBusy}
            className="px-4 py-2 bg-accent hover:bg-accentHover text-white rounded disabled:opacity-50"
          >
            {mergeLoading ? 'Scanning…' : 'Scan for duplicates'}
          </button>
          {Array.isArray(mergeItems) && mergeItems.length > 0 && (
            <button
              onClick={mergeAll}
              disabled={mergeAllBusy || mergeBusyId != null}
              className="px-4 py-2 bg-button hover:bg-buttonHover rounded disabled:opacity-50"
            >
              {mergeAllBusy ? 'Merging…' : `Merge all (${mergeItems.length})`}
            </button>
          )}
        </div>

        {mergeError && <div className="text-sm text-danger">{mergeError}</div>}

        {Array.isArray(mergeItems) && !mergeLoading && mergeItems.length === 0 && (
          <div className="text-sm text-muted border border-border rounded p-4">
            No duplicate games found — nothing to merge.
          </div>
        )}

        {Array.isArray(mergeItems) && mergeItems.length > 0 && (
          <div className="border border-border rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-muted">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Game</th>
                  <th className="text-left font-medium px-3 py-2">Duplicates</th>
                  <th className="text-left font-medium px-3 py-2 hidden sm:table-cell">Will merge into</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {mergeItems.map((item) => {
                  const survivor = item.records?.find((r) => r.isSurvivor)
                  return (
                    <tr key={item.atlasId} className="border-t border-border align-top">
                      <td className="px-3 py-2">
                        <div>{item.groupTitle}</div>
                        <div className="text-xs text-muted mt-0.5 sm:hidden">
                          → {survivor?.title || `record ${item.survivorRecordId}`}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-muted">
                        <div className="flex flex-col gap-0.5">
                          {(item.records || []).map((r) => (
                            <span key={r.recordId} className={r.isSurvivor ? 'text-text' : ''}>
                              {r.title}
                              {r.versionCount > 0 && (
                                <span className="text-xs text-muted"> · {r.versionCount} ver.</span>
                              )}
                              {r.isSurvivor && (
                                <span className="ml-1 text-xs px-1.5 py-0.5 rounded border border-accent/40 text-accent">
                                  kept
                                </span>
                              )}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-muted hidden sm:table-cell">
                        {survivor?.title || `record ${item.survivorRecordId}`}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => mergeGroup(item)}
                          disabled={mergeBusyId != null || mergeAllBusy}
                          className="px-3 py-1 bg-button hover:bg-buttonHover rounded disabled:opacity-50"
                        >
                          {mergeBusyId === item.atlasId ? 'Merging…' : 'Merge'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Inline remap modal */}
      {remapTarget && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4"
          onClick={() => { if (!remapBusy) setRemapTarget(null) }}
        >
          <div className="bg-secondary border border-border rounded-md max-w-2xl w-full p-4 shadow-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-1">Remap “{remapTarget.title}”</h2>
            <p className="text-xs text-muted mb-3">Search the catalog and pick the correct entry to map this game to.</p>

            <div className="flex items-end gap-2 mb-3">
              <label className="flex-1 text-sm">
                <span className="block mb-1">Title</span>
                <input
                  value={remapQuery.title}
                  onChange={(e) => setRemapQuery((q) => ({ ...q, title: e.target.value }))}
                  className="w-full bg-primary border border-border p-2 rounded"
                />
              </label>
              <label className="flex-1 text-sm">
                <span className="block mb-1">Creator</span>
                <input
                  value={remapQuery.creator}
                  onChange={(e) => setRemapQuery((q) => ({ ...q, creator: e.target.value }))}
                  className="w-full bg-primary border border-border p-2 rounded"
                />
              </label>
              <button
                onClick={() => searchRemap(remapQuery.title, remapQuery.creator)}
                disabled={remapSearching}
                className="px-4 py-2 bg-accent hover:bg-accentHover text-white rounded disabled:opacity-50"
              >
                {remapSearching ? 'Searching…' : 'Search'}
              </button>
            </div>

            {remapError && <div className="text-sm text-danger mb-2">{remapError}</div>}

            <div className="flex-1 min-h-0 overflow-y-auto border border-border rounded">
              {remapSearching ? (
                <div className="p-4 text-sm text-muted">Searching…</div>
              ) : remapResults.length === 0 ? (
                <div className="p-4 text-sm text-muted">No results. Adjust the title or creator and search again.</div>
              ) : (
                <ul className="divide-y divide-border">
                  {remapResults.map((r) => {
                    const atlasId = r.atlas_id ?? r.atlasId ?? r.id
                    const f95Id = r.f95_id ?? r.f95Id ?? null
                    const lcId = r.lc_id ?? r.lcId ?? r.lewdCornerId ?? null
                    return (
                      <li key={atlasId} className="flex items-center justify-between gap-3 px-3 py-2">
                        <div className="min-w-0">
                          <div className="truncate">{r.title || r.name || `Atlas #${atlasId}`}</div>
                          <div className="text-xs text-muted truncate">
                            {(r.creator || r.developer || 'Unknown creator')}{r.latestVersion || r.version ? ` · v${r.latestVersion || r.version}` : ''}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            {atlasId != null && (
                              <span className="px-1.5 py-0.5 rounded border border-border bg-secondary text-[10px] text-muted">Atlas {atlasId}</span>
                            )}
                            {f95Id ? (
                              <span className="px-1.5 py-0.5 rounded border border-border bg-secondary text-[10px] text-muted">F95 {f95Id}</span>
                            ) : null}
                            {lcId ? (
                              <span className="px-1.5 py-0.5 rounded border border-border bg-secondary text-[10px] text-muted">LC {lcId}</span>
                            ) : null}
                          </div>
                        </div>
                        <button
                          onClick={() => applyRemap(atlasId)}
                          disabled={remapBusy || !atlasId}
                          className="px-3 py-1 bg-accent hover:bg-accentHover text-white rounded disabled:opacity-50 flex-shrink-0"
                        >
                          {remapBusy ? 'Mapping…' : 'Map'}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <div className="flex justify-end mt-3">
              <button
                onClick={() => setRemapTarget(null)}
                disabled={remapBusy}
                className="px-4 py-1.5 bg-button hover:bg-buttonHover rounded disabled:opacity-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
