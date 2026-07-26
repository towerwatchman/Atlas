import { useCallback, useEffect, useRef, useState } from 'react'
import GogIcon from '../../ui/GogIcon.jsx'

// Manual add & link.
//
// Exists because neither automatic path can reach every game. Steam's
// GetOwnedGames omits free titles regardless of include_played_free_games /
// include_free_sub / skip_unvetted_apps, and the appmanifest scan only sees games
// that are currently installed. An uninstalled title Steam refuses to list is
// therefore invisible to Atlas by any automatic route — this is the escape hatch.
//
// Two ways in: search the storefront by name, or paste an id if the search cannot
// find it (fully delisted apps have no store page to search). Either way the
// metadata and art are pulled from the source, so nothing is typed by hand.
//
// The local path is optional and asked per game: a title can be added purely for
// metadata (reads as not-installed, appears under the Uninstalled filter) or
// pointed at a folder to make it launchable now.

const SOURCES = [
  { id: 'steam', label: 'Steam', idLabel: 'App ID', idHint: 'e.g. 2845830' },
  { id: 'gog', label: 'GOG', idLabel: 'Product ID', idHint: 'e.g. 1207658930' },
]

export default function ManualAddStep({ onBack }) {
  const [source, setSource] = useState('steam')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [searched, setSearched] = useState(false)

  const [selected, setSelected] = useState(null)
  const [manualId, setManualId] = useState('')
  const [installDir, setInstallDir] = useState('')
  const [adding, setAdding] = useState(false)
  const [outcome, setOutcome] = useState(null)

  const searchInputRef = useRef(null)
  const activeSource = SOURCES.find((s) => s.id === source) || SOURCES[0]

  useEffect(() => { searchInputRef.current?.focus() }, [])

  // Switching storefront invalidates results and any selection, since ids are
  // per-source and a Steam appid means nothing to GOG.
  const switchSource = (next) => {
    if (next === source) return
    setSource(next)
    setResults([])
    setSearched(false)
    setSearchError('')
    setSelected(null)
    setManualId('')
    setOutcome(null)
  }

  const runSearch = useCallback(async () => {
    const term = query.trim()
    if (term.length < 2) {
      setSearchError('Enter at least two characters.')
      return
    }
    setSearching(true)
    setSearchError('')
    setOutcome(null)
    try {
      const result = await window.electronAPI.catalogSearch({ source, query: term })
      if (result?.ok) {
        setResults(Array.isArray(result.results) ? result.results : [])
        setSearchError('')
      } else {
        setResults([])
        setSearchError(result?.error || 'Search failed.')
      }
    } catch (err) {
      setResults([])
      setSearchError(err.message || 'Search failed.')
    } finally {
      setSearching(false)
      setSearched(true)
    }
  }, [query, source])

  const pickFolder = async () => {
    try {
      const result = await window.electronAPI.manualAddPickFolder?.()
      if (result?.ok && result.path) setInstallDir(result.path)
    } catch (err) {
      console.error('Folder pick failed:', err)
    }
  }

  // Either a search hit or a hand-entered id is enough to add.
  const effectiveId = selected?.id || manualId.trim()
  const effectiveName = selected?.name || ''
  const canAdd = /^\d+$/.test(effectiveId) && !adding

  const add = async () => {
    if (!canAdd) return
    setAdding(true)
    setOutcome(null)
    try {
      const result = await window.electronAPI.manualAddGame({
        source,
        id: effectiveId,
        name: effectiveName,
        installDir: installDir.trim(),
      })
      if (result?.ok) {
        setOutcome({
          ok: true,
          title: result.title || effectiveName || effectiveId,
          alreadyPresent: Boolean(result.alreadyPresent),
          installed: Boolean(result.installed),
        })
        setSelected(null)
        setManualId('')
        setInstallDir('')
      } else {
        setOutcome({ ok: false, error: result?.error || 'Could not add that game.' })
      }
    } catch (err) {
      setOutcome({ ok: false, error: err.message || 'Could not add that game.' })
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="h-full flex flex-col p-4 gap-4 overflow-y-auto">
      <div>
        <h2 className="text-lg">Add a Game Manually</h2>
        <p className="text-xs text-text/60 mt-1 max-w-2xl">
          For games the automatic importers can&rsquo;t reach &mdash; Steam leaves free titles
          out of its owned-games list, and the disk scan only finds games that are
          installed. Search below, or paste an ID if the store search can&rsquo;t find it.
          Metadata and artwork are pulled from the source.
        </p>
      </div>

      {/* Storefront selector */}
      <div className="flex items-center gap-2">
        {SOURCES.map((s) => (
          <button
            key={s.id}
            onClick={() => switchSource(s.id)}
            className={`h-9 px-4 inline-flex items-center gap-2 rounded-buttonTheme border transition-colors ${
              source === s.id
                ? 'bg-accent text-white border-accent'
                : 'bg-secondary text-text border-border hover:bg-selected'
            }`}
          >
            {s.id === 'steam' ? <i className="fab fa-steam" /> : <GogIcon size={16} />}
            {s.label}
          </button>
        ))}
      </div>

      {/* Search. Stacks on narrow windows, sits inline on wide ones. */}
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          ref={searchInputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') runSearch() }}
          placeholder={`Search ${activeSource.label} by title…`}
          className="flex-1 min-w-0 h-9 px-3 bg-primary border border-border rounded text-sm"
        />
        <button
          onClick={runSearch}
          disabled={searching}
          className="h-9 px-4 shrink-0 inline-flex items-center justify-center gap-2 bg-accent hover:bg-accentHover disabled:opacity-40 text-white rounded-buttonTheme transition-colors"
        >
          <i className={`fas ${searching ? 'fa-spinner fa-spin' : 'fa-magnifying-glass'}`} />
          Search
        </button>
      </div>

      {searchError && <p className="text-xs text-danger">{searchError}</p>}

      {/* Results */}
      {results.length > 0 && (
        <div className="border border-border rounded divide-y divide-border max-h-72 overflow-y-auto">
          {results.map((item) => {
            const isSelected = selected?.id === item.id
            return (
              <button
                key={`${item.source}-${item.id}`}
                onClick={() => { setSelected(item); setManualId(''); setOutcome(null) }}
                className={`w-full flex items-center gap-3 p-2 text-left transition-colors ${
                  isSelected ? 'bg-accent/20' : 'hover:bg-highlight/50'
                }`}
              >
                <div className="w-16 h-8 shrink-0 rounded overflow-hidden bg-secondary flex items-center justify-center">
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt=""
                      className="w-full h-full object-cover"
                      onError={(e) => { e.currentTarget.style.display = 'none' }}
                    />
                  ) : (
                    <i className="fas fa-gamepad text-text/30 text-xs" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate" title={item.name}>{item.name}</div>
                  <div className="text-[11px] text-text/50">
                    ID {item.id}
                    {item.type ? ` · ${item.type}` : ''}
                    {item.isFree === true ? ' · free' : ''}
                  </div>
                </div>
                {isSelected && <i className="fas fa-check text-accent shrink-0" />}
              </button>
            )
          })}
        </div>
      )}

      {searched && !searching && results.length === 0 && !searchError && (
        <p className="text-xs text-text/60">
          No store results. A fully delisted game has no store page to search &mdash; get its
          {' '}{activeSource.idLabel} from the {activeSource.label} client and enter it below.
        </p>
      )}

      {/* Direct id entry */}
      <div className="border border-border bg-primary/40 rounded p-3 space-y-2">
        <label className="block text-sm">
          Or enter a {activeSource.label} {activeSource.idLabel} directly
        </label>
        <input
          type="text"
          value={manualId}
          onChange={(e) => { setManualId(e.target.value.replace(/\D/g, '')); setSelected(null); setOutcome(null) }}
          placeholder={activeSource.idHint}
          inputMode="numeric"
          className="w-full sm:w-64 h-9 px-3 bg-primary border border-border rounded text-sm"
        />
        <p className="text-[11px] text-text/50">
          In the {activeSource.label} client, the ID is in the store page URL for the game.
        </p>
      </div>

      {/* Optional local path */}
      <div className="border border-border bg-primary/40 rounded p-3 space-y-2">
        <label className="block text-sm">Local game folder <span className="text-text/50">(optional)</span></label>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={installDir}
            onChange={(e) => setInstallDir(e.target.value)}
            placeholder="Leave empty to add metadata only"
            className="flex-1 min-w-0 h-9 px-3 bg-primary border border-border rounded text-sm"
          />
          <button
            onClick={pickFolder}
            className="h-9 px-4 shrink-0 inline-flex items-center justify-center gap-2 bg-secondary hover:bg-selected text-text rounded-buttonTheme border border-border transition-colors"
          >
            <i className="fas fa-folder-open" /> Browse
          </button>
        </div>
        <p className="text-[11px] text-text/50">
          With a folder set, the game reads as installed and can be launched. Left empty, it
          is added as a not-installed record you can point at files later.
        </p>
      </div>

      {/* Outcome */}
      {outcome && (
        <div
          className={`text-sm rounded p-3 border ${
            outcome.ok
              ? 'border-green-500/40 text-green-400 bg-green-500/10'
              : 'border-danger/40 text-danger bg-danger/10'
          }`}
        >
          {outcome.ok ? (
            <>
              <i className="fas fa-check mr-2" />
              {outcome.alreadyPresent
                ? `Updated the existing record for ${outcome.title}.`
                : `Added ${outcome.title}.`}
              {outcome.installed ? ' Linked to its local folder.' : ' Added without a local path.'}
            </>
          ) : (
            <><i className="fas fa-triangle-exclamation mr-2" />{outcome.error}</>
          )}
        </div>
      )}

      {/* Actions. Kept in-panel rather than in the wizard footer so the whole
          flow stays on one screen and repeated adds do not need navigation. */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
        <button
          onClick={add}
          disabled={!canAdd}
          className="h-9 px-4 inline-flex items-center justify-center gap-2 bg-accent hover:bg-accentHover disabled:opacity-40 text-white rounded-buttonTheme transition-colors"
        >
          <i className={`fas ${adding ? 'fa-spinner fa-spin' : 'fa-plus'}`} />
          {adding ? 'Adding…' : 'Add to Library'}
        </button>
        <button
          onClick={onBack}
          className="h-9 px-4 inline-flex items-center justify-center bg-secondary hover:bg-selected text-text rounded-buttonTheme border border-border transition-colors"
        >
          Back
        </button>
        {!canAdd && !adding && (
          <span className="text-xs text-text/50 sm:ml-2">
            Pick a search result or enter an ID to continue.
          </span>
        )}
      </div>
    </div>
  )
}
