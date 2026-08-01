import { useCallback, useEffect, useState } from 'react'

// ── Settings -> Import ───────────────────────────────────────────────────────
//
// Where importing another tool's library lives. It is deliberately here rather
// than in the importer's own source dropdown: migrating from F95Checker is
// something you do once when you switch to Atlas, not something you reach for
// while adding a game, and keeping it out of the + menu is what stops that menu
// from growing a row per competing tool.
//
// The button opens the ordinary importer window with a source id, so there is no
// second import implementation behind this page — same window, same review
// table, same writer.

export default function ImportSources() {
  const [providers, setProviders] = useState([])
  const [details, setDetails] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const listed = await window.electronAPI.listExternalLibraries?.()
      if (!listed?.success) {
        setError(listed?.error || 'Could not load import sources')
        return
      }
      const list = listed.providers || []
      setProviders(list)
      // Detection status per tool, so the card can say whether Atlas can
      // already see the library before the user opens the importer.
      const described = await Promise.all(
        list.map((provider) =>
          window.electronAPI
            .describeExternalLibrary?.(provider.id)
            .catch(() => null),
        ),
      )
      const next = {}
      described.forEach((entry, index) => {
        if (entry?.success) next[list[index].id] = entry
      })
      setDetails(next)
    } catch (err) {
      setError(err.message || 'Could not load import sources')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const openImporter = (id) => {
    window.electronAPI.openImporter?.(id)
  }

  if (loading) {
    return <p className="text-sm text-muted">Checking for installed tools&hellip;</p>
  }

  return (
    <div className="space-y-4 max-w-3xl" data-tour="ExternalLibraries">
      <div>
        <h3 className="text-base font-medium text-text">External libraries</h3>
        <p className="text-xs text-muted mt-1">
          Already track your games in another tool? Atlas can read its library and
          bring across your games along with your ratings, notes, finished state,
          labels and groupings. Your games are not moved, and the other tool&rsquo;s
          data is only ever read.
        </p>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      <div className="space-y-2">
        {providers.map((provider) => {
          const detail = details[provider.id]
          const detected = Boolean(detail?.detected)
          return (
            <div
              key={provider.id}
              className="rounded border border-border bg-primary p-3 flex flex-col sm:flex-row sm:items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-text">{provider.label}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded border ${
                      detected
                        ? 'border-success/40 text-success'
                        : 'border-border text-muted'
                    }`}
                  >
                    {detected ? 'Library found' : 'Not found'}
                  </span>
                </div>
                {/* Show the resolved path when we have one, and where we looked
                    when we don't — "Not found" on its own gives the user nothing
                    to act on. */}
                {detected ? (
                  <p className="text-[11px] text-muted mt-1 font-mono break-all">
                    {detail.detectedPath}
                  </p>
                ) : (
                  <p className="text-[11px] text-muted mt-1">
                    No {provider.databaseName} in the usual location. You can point
                    Atlas at the file yourself in the importer.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => openImporter(provider.id)}
                className="h-8 px-3 shrink-0 text-xs rounded-buttonTheme bg-accent hover:bg-accentHover text-white transition-colors"
              >
                Import library&hellip;
              </button>
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={load}
          className="h-8 px-3 text-xs rounded-buttonTheme bg-button hover:bg-buttonHover text-text transition-colors"
        >
          <i className="fas fa-rotate mr-1.5" aria-hidden="true"></i>
          Check again
        </button>
        <p className="text-[11px] text-muted">
          Close the other tool before importing so its most recent changes are
          included.
        </p>
      </div>
    </div>
  )
}
