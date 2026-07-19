import { useState, useEffect, useMemo, useCallback } from 'react'

// Owned-library browser for the Steam importer source. Shows the full owned
// library (from the cached Steam Web API pull), each game tagged with whether
// it's locally installed. Phase 1: browse + filter only. Install / launch /
// uninstall handoff buttons come in Phase 2.
//
// Responsive by design (per project convention): single-column list on narrow
// widths, multi-column card grid on wider ones, via CSS grid auto-fill.

// Steam's community CDN serves the small library icon by app + icon hash.
const iconUrl = (appid, hash) =>
  hash
    ? `https://media.steampowered.com/steamcommunity/public/images/apps/${appid}/${hash}.jpg`
    : null

const fmtPlaytime = (minutes) => {
  if (!minutes) return 'Never played'
  if (minutes < 60) return `${minutes} min`
  const hours = minutes / 60
  return hours < 10 ? `${hours.toFixed(1)} hrs` : `${Math.round(hours)} hrs`
}

const fmtWhen = (ts) => {
  if (!ts) return ''
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return ''
  }
}

const SteamLibraryStep = ({ onBack }) => {
  const [state, setState] = useState({ status: 'loading' }) // loading | ready | error | disconnected
  const [games, setGames] = useState([])
  const [meta, setMeta] = useState({ fetchedAt: null, fromCache: false, stale: false })
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all') // all | installed | notInstalled
  const [refreshing, setRefreshing] = useState(false)
  const [added, setAdded] = useState(() => new Set()) // appids added to Atlas this session
  const [addingIds, setAddingIds] = useState(() => new Set()) // in-flight single adds
  const [bulk, setBulk] = useState(null) // { done, total, text } while bulk running
  const [bulkMenuOpen, setBulkMenuOpen] = useState(false)

  const markAdded = useCallback((appids) => {
    setAdded((prev) => {
      const next = new Set(prev)
      for (const id of appids) next.add(String(id))
      return next
    })
  }, [])

  const addOne = useCallback(async (game) => {
    const id = String(game.appid)
    setAddingIds((prev) => new Set(prev).add(id))
    try {
      const r = await window.electronAPI.steamAddOwnedGame({ appid: id, name: game.name })
      if (r?.ok) markAdded([id])
    } catch (err) {
      console.error('Add to Atlas failed:', err)
    } finally {
      setAddingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }, [markAdded])

  // Bulk-add games in the current view (respects search + filter), scoped to
  // 'all' | 'installed' | 'notInstalled'. Already-added games are skipped.
  const bulkAdd = useCallback(async (candidates, scope = 'all') => {
    let pool = candidates
    if (scope === 'installed') pool = candidates.filter((g) => g.installed)
    else if (scope === 'notInstalled') pool = candidates.filter((g) => !g.installed)
    const targets = pool.filter((g) => !added.has(String(g.appid)))
    if (targets.length === 0) return
    const scopeLabel =
      scope === 'installed' ? 'installed' : scope === 'notInstalled' ? 'not-installed' : ''
    const ok = window.confirm(
      `Add ${targets.length} ${scopeLabel ? scopeLabel + ' ' : ''}game${targets.length === 1 ? '' : 's'} to Atlas?\n\n` +
      'This creates library records with Steam artwork and details. No files are downloaded — ' +
      'you can install any not-installed game later from its detail page.',
    )
    if (!ok) return
    setBulk({ done: 0, total: targets.length, text: 'Starting…' })
    try {
      const r = await window.electronAPI.steamAddOwnedBulk({
        games: targets.map((g) => ({ appid: g.appid, name: g.name })),
      })
      if (r?.ok) markAdded(targets.map((g) => g.appid))
    } catch (err) {
      console.error('Bulk add failed:', err)
    } finally {
      setBulk(null)
    }
  }, [added, markAdded])

  useEffect(() => {
    if (!window.electronAPI.onSteamBulkProgress) return undefined
    const unsub = window.electronAPI.onSteamBulkProgress((data) => {
      setBulk((cur) => (cur ? { ...cur, done: data.done, total: data.total, text: data.text } : cur))
    })
    return unsub
  }, [])

  const load = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) setRefreshing(true)
    else setState({ status: 'loading' })
    try {
      const status = await window.electronAPI.steamStatus()
      if (!status?.connected) {
        setState({ status: 'disconnected' })
        return
      }
      const result = await window.electronAPI.steamOwnedGames({ forceRefresh })
      if (result?.ok) {
        setGames(Array.isArray(result.games) ? result.games : [])
        setMeta({
          fetchedAt: result.fetchedAt || null,
          fromCache: Boolean(result.fromCache),
          stale: Boolean(result.stale),
        })
        setState({ status: 'ready' })
      } else {
        setState({ status: 'error', error: result?.error || 'Could not load your Steam library.', code: result?.code })
      }
    } catch (err) {
      setState({ status: 'error', error: err.message || 'Could not load your Steam library.' })
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    load(false)
  }, [load])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = games
    if (filter === 'installed') list = list.filter((g) => g.installed)
    else if (filter === 'notInstalled') list = list.filter((g) => !g.installed)
    if (q) list = list.filter((g) => g.name.toLowerCase().includes(q))
    // Installed first, then by playtime desc, then name.
    return [...list].sort((a, b) => {
      if (a.installed !== b.installed) return a.installed ? -1 : 1
      if (b.playtimeForever !== a.playtimeForever) return b.playtimeForever - a.playtimeForever
      return a.name.localeCompare(b.name)
    })
  }, [games, query, filter])

  const installedCount = useMemo(() => games.filter((g) => g.installed).length, [games])

  // ── Non-ready states ────────────────────────────────────────────────────
  if (state.status === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text/60 gap-3">
        <i className="fas fa-spinner fa-spin text-2xl" />
        <span>Loading your Steam library…</span>
      </div>
    )
  }

  if (state.status === 'disconnected') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center gap-3 px-6">
        <i className="fab fa-steam text-4xl text-text/40" />
        <p className="text-text font-semibold">Steam isn't connected yet</p>
        <p className="text-sm text-text/60 max-w-md">
          Connect your Steam account in Settings → Accounts to browse your owned
          library here. Once connected, your games — installed or not — show up in
          this view.
        </p>
        {onBack && (
          <button
            onClick={onBack}
            className="mt-2 px-4 py-2 text-sm rounded bg-secondary border border-border hover:bg-highlight transition-colors"
          >
            Back
          </button>
        )}
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center gap-3 px-6">
        <i className="fas fa-exclamation-triangle text-3xl text-danger" />
        <p className="text-text font-semibold">Couldn't load your library</p>
        <p className="text-sm text-text/60 max-w-md">{state.error}</p>
        <div className="flex gap-2 mt-2">
          <button
            onClick={() => load(true)}
            className="px-4 py-2 text-sm rounded bg-accent text-white hover:opacity-90 transition-opacity"
          >
            Try again
          </button>
          {onBack && (
            <button
              onClick={onBack}
              className="px-4 py-2 text-sm rounded bg-secondary border border-border hover:bg-highlight transition-colors"
            >
              Back
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── Ready ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full text-text">
      {/* Toolbar */}
      <div className="flex flex-col gap-2 p-3 border-b border-border">
        <div className="flex items-center gap-2 flex-wrap">
          <i className="fab fa-steam text-lg" />
          <span className="font-semibold">Steam Library</span>
          <span className="text-xs text-text/50">
            {games.length} owned · {installedCount} installed
          </span>
          <div className="flex-1" />
          <div className="relative">
            <button
              onClick={() => setBulkMenuOpen((v) => !v)}
              disabled={Boolean(bulk) || refreshing}
              className="px-3 py-1 text-sm rounded bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-40 inline-flex items-center gap-1"
              title="Add games to Atlas in bulk"
            >
              {bulk ? (
                <><i className="fas fa-spinner fa-spin mr-1" /> Adding {bulk.done}/{bulk.total}</>
              ) : (
                <><i className="fas fa-plus mr-1" /> Add to Atlas <i className="fas fa-caret-down ml-0.5" /></>
              )}
            </button>
            {bulkMenuOpen && !bulk && (
              <>
                <div className="fixed inset-0 z-[1590]" onClick={() => setBulkMenuOpen(false)} />
                <div className="absolute right-0 top-[calc(100%+6px)] z-[1600] w-52 border border-border bg-primary shadow-lg rounded p-1 text-text">
                  {[
                    { scope: 'all', label: 'Add all games', icon: 'fa-layer-group', n: visible.filter((g) => !added.has(String(g.appid))).length },
                    { scope: 'installed', label: 'Add all installed', icon: 'fa-check', n: visible.filter((g) => g.installed && !added.has(String(g.appid))).length },
                    { scope: 'notInstalled', label: 'Add all not-installed', icon: 'fa-cloud', n: visible.filter((g) => !g.installed && !added.has(String(g.appid))).length },
                  ].map((opt) => (
                    <button
                      key={opt.scope}
                      onClick={() => { setBulkMenuOpen(false); bulkAdd(visible, opt.scope) }}
                      disabled={opt.n === 0}
                      className="w-full flex items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-tertiary disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <i className={`fas ${opt.icon} w-4 text-center text-text/60`} />
                      <span className="flex-1">{opt.label}</span>
                      <span className="text-[11px] text-text/40">{opt.n}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button
            onClick={() => load(true)}
            disabled={refreshing || Boolean(bulk)}
            className="px-3 py-1 text-sm rounded bg-secondary border border-border hover:bg-highlight transition-colors disabled:opacity-40"
            title="Fetch the latest library from Steam"
          >
            <i className={`fas fa-sync-alt mr-1 ${refreshing ? 'fa-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {bulk && (
          <div className="text-[11px] text-text/50">{bulk.text}</div>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-text/40 text-sm" />
            <input
              type="text"
              placeholder="Search your library…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-primary border border-border text-text rounded pl-9 pr-3 py-2 text-sm"
            />
          </div>
          <div className="flex gap-1">
            {[
              { id: 'all', label: 'All' },
              { id: 'installed', label: 'Installed' },
              { id: 'notInstalled', label: 'Not installed' },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`px-3 py-2 text-sm rounded border transition-colors ${
                  filter === f.id
                    ? 'bg-accent text-white border-accent'
                    : 'bg-primary border-border hover:bg-highlight'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {meta.fetchedAt && (
          <div className="text-[11px] text-text/40">
            {meta.stale
              ? 'Showing cached library (couldn\u2019t reach Steam) — '
              : meta.fromCache
                ? 'Cached '
                : 'Updated '}
            {fmtWhen(meta.fetchedAt)}
          </div>
        )}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-3">
        {visible.length === 0 ? (
          <div className="text-center text-text/50 mt-8 text-sm">
            {query || filter !== 'all'
              ? 'No games match your search or filter.'
              : 'No games found in your library.'}
          </div>
        ) : (
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}
          >
            {visible.map((g) => (
              <div
                key={g.appid}
                className="flex items-center gap-3 rounded border border-border bg-primary p-2 hover:bg-highlight/50 transition-colors"
              >
                <div className="w-8 h-8 shrink-0 rounded overflow-hidden bg-secondary flex items-center justify-center">
                  {iconUrl(g.appid, g.iconHash) ? (
                    <img
                      src={iconUrl(g.appid, g.iconHash)}
                      alt=""
                      className="w-full h-full object-cover"
                      onError={(e) => { e.currentTarget.style.display = 'none' }}
                    />
                  ) : (
                    <i className="fas fa-gamepad text-text/30 text-xs" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate" title={g.name}>{g.name}</div>
                  <div className="text-[11px] text-text/50">{fmtPlaytime(g.playtimeForever)}</div>
                </div>
                <div className="shrink-0 flex items-center gap-1.5">
                  {g.installed ? (
                    <span className="inline-flex items-center gap-1 text-[10px] text-green-500 border border-green-500/40 rounded px-1.5 py-0.5">
                      <i className="fas fa-check" /> Installed
                    </span>
                  ) : (
                    <span className="text-[10px] text-text/40 border border-border rounded px-1.5 py-0.5">
                      Not installed
                    </span>
                  )}
                  {added.has(String(g.appid)) ? (
                    <span className="inline-flex items-center gap-1 text-[10px] text-accent border border-accent/40 rounded px-1.5 py-0.5">
                      <i className="fas fa-check" /> Added
                    </span>
                  ) : (
                    <button
                      onClick={() => addOne(g)}
                      disabled={addingIds.has(String(g.appid)) || Boolean(bulk)}
                      className="inline-flex items-center gap-1 text-[10px] rounded px-1.5 py-0.5 bg-secondary border border-border hover:bg-accent hover:text-white transition-colors disabled:opacity-40"
                      title="Create an Atlas library record for this game"
                    >
                      {addingIds.has(String(g.appid))
                        ? <><i className="fas fa-spinner fa-spin" /> Adding</>
                        : <><i className="fas fa-plus" /> Add</>}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default SteamLibraryStep
