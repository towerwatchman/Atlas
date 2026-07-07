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
                    return (
                      <li key={atlasId} className="flex items-center justify-between gap-3 px-3 py-2">
                        <div className="min-w-0">
                          <div className="truncate">{r.title || r.name || `Atlas #${atlasId}`}</div>
                          <div className="text-xs text-muted truncate">
                            {(r.creator || r.developer || 'Unknown creator')}{r.version ? ` · v${r.version}` : ''}{atlasId ? ` · #${atlasId}` : ''}
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
