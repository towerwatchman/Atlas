import { useCallback, useEffect, useState } from 'react'
import HostIcon from './HostIcon.jsx'
import { buildThreadUrl } from './threadUrl.js'

// ── Update modal ─────────────────────────────────────────────────────────────
//
// Opened by the UPDATE button. Fetches the game's F95 thread under the user's
// own session, shows the mirrors they can actually use, and hands the chosen
// one to the resolver.
//
// Why a fetch every time rather than the catalog: masked links embed the
// requesting account's user id in a signed payload, so a link scraped under
// the scraper's account opens for nobody else. Each user mints their own. The
// main process caches per session, so reopening this is free.
//
// The empty state is a real outcome, not an error. Until a host plugin exists
// there is nothing Atlas can take delivery of, and a game whose thread offers
// only unsupported hosts genuinely has no options here - saying so plainly
// beats an empty list that looks broken.

const prettyHost = (host) => String(host || '').replace(/^www\./, '')

export default function UpdateModal({ game, open, onClose, onQueued }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState('')
  const [data, setData] = useState(null)
  const [resolvingUrl, setResolvingUrl] = useState('')

  const threadId = game?.f95_id || game?.f95Id || null
  const title = game?.title || 'this game'

  // Where "Open thread" goes. See threadUrl.js for why this is not a template
  // string built from an id that may not exist.
  const threadUrl = buildThreadUrl({
    siteUrl: game?.siteUrl || game?.site_url,
    lewdCornerSiteUrl: game?.lewdCornerSiteUrl || game?.lewdcornerSiteUrl,
    f95Id: data?.threadId || threadId,
    lcId: game?.lc_id || game?.lcId || game?.lewdCornerId,
  })

  const load = useCallback(async (force = false) => {
    if (!threadId) {
      setError('This game has no F95zone thread linked, so Atlas cannot look up download links.')
      return
    }
    setLoading(true)
    setError('')
    setErrorCode('')
    try {
      const result = await window.electronAPI.updateLinksGet?.({ threadId, force })
      if (result?.ok) setData(result)
      else {
        setError(result?.error || 'Could not load download links')
        setErrorCode(result?.code || '')
      }
    } catch (err) {
      setError(err.message || 'Could not load download links')
    } finally {
      setLoading(false)
    }
  }, [threadId])

  useEffect(() => {
    if (open) load(false)
    else { setData(null); setError(''); setResolvingUrl('') }
  }, [open, load])

  // Resolving opens a real browser window where the user clears F95's gate
  // themselves. Atlas reads the destination and queues it.
  const choose = async (link) => {
    setResolvingUrl(link.url)
    setError('')
    try {
      const resolved = await window.electronAPI.downloadsResolveMasked?.({
        url: link.url,
        title,
      })
      if (!resolved?.ok) {
        if (!resolved?.canceled) {
          setError(resolved?.error || 'Could not get the download link')
        }
        return
      }
      const queued = await window.electronAPI.downloadsEnqueue?.({
        recordId: game?.record_id ?? null,
        title,
        creator: game?.creator || '',
        version: game?.latestVersion || game?.latest_version || '',
        url: resolved.url,
        host: resolved.host || link.host,
        source: 'f95',
        // Nothing to replace when the game is not in the library yet: a browse
        // row has no record and no installed build, so 'replace' would be a
        // request Atlas could not honour.
        onComplete: game?.record_id ? 'replace' : 'add',
      })
      if (queued?.success) {
        onQueued?.(queued.item)
        onClose?.()
      } else {
        setError(queued?.error || 'Could not add this to the download queue')
      }
    } catch (err) {
      setError(err.message || 'Could not start this download')
    } finally {
      setResolvingUrl('')
    }
  }

  if (!open) return null

  const links = data?.links || []
  const hidden = data?.hiddenMultiPart

  return (
    <div
      className="fixed inset-0 z-[1500] bg-black/60 flex items-center justify-center p-4"
      onClick={(event) => { if (event.target === event.currentTarget) onClose?.() }}
    >
      <div className="w-full max-w-lg max-h-[80vh] flex flex-col rounded-lg border border-border bg-primary shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base text-text truncate">Update {title}</h2>
            {game?.latestVersion && (
              <p className="text-xs text-muted mt-0.5">
                Latest version {game.latestVersion}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="h-7 w-7 shrink-0 inline-flex items-center justify-center rounded text-muted hover:text-text hover:bg-tertiary"
          >
            <i className="fas fa-xmark" aria-hidden="true"></i>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
          {loading && (
            <div className="py-10 text-center text-sm text-muted">
              <i className="fas fa-circle-notch fa-spin mr-2" aria-hidden="true"></i>
              Loading download links&hellip;
            </div>
          )}

          {!loading && error && (
            <div className="rounded border border-danger/40 bg-danger/5 p-3 text-xs text-text">
              <p className="text-danger font-medium">Couldn&rsquo;t load links</p>
              <p className="mt-1">{error}</p>
              {/* A session problem is fixable by the user, so say where. */}
              {(errorCode === 'NO_SESSION' || errorCode === 'NOT_LOGGED_IN') && (
                <p className="mt-1 text-muted">
                  Settings &rsaquo; Accounts is where F95zone sign-in lives.
                </p>
              )}
              <button
                type="button"
                onClick={() => load(true)}
                className="mt-2 h-7 px-3 text-xs rounded-buttonTheme bg-button hover:bg-buttonHover text-text"
              >
                Try again
              </button>
            </div>
          )}

          {!loading && !error && links.length === 0 && (
            <div className="py-8 text-center">
              <i className="fas fa-link-slash text-2xl text-muted/50" aria-hidden="true"></i>
              <p className="mt-3 text-sm text-text">No supported download hosts</p>
              <p className="mt-1 text-xs text-muted max-w-sm mx-auto">
                This thread doesn&rsquo;t offer a mirror Atlas can download from
                yet. You can still grab it from the thread yourself.
              </p>
              {threadUrl ? (
                <button
                  type="button"
                  onClick={() => window.electronAPI.openExternal?.(threadUrl)}
                  className="mt-3 h-8 px-3 text-xs rounded-buttonTheme bg-button hover:bg-buttonHover text-text"
                >
                  Open thread
                </button>
              ) : (
                // No link to offer. Saying so beats a button that goes nowhere.
                <p className="mt-3 text-[11px] text-muted">
                  Atlas has no thread link stored for this game either, so there is
                  nothing to open. Refresh its metadata to pick one up.
                </p>
              )}
            </div>
          )}

          {!loading && !error && links.length > 0 && (
            <>
              <p className="text-xs text-muted">
                Choose a mirror. F95zone will ask you to confirm in a browser
                window before the download starts.
              </p>
              <div className="space-y-1.5">
                {links.map((link) => {
                  const busy = resolvingUrl === link.url
                  return (
                    <button
                      key={link.url}
                      type="button"
                      onClick={() => choose(link)}
                      disabled={Boolean(resolvingUrl)}
                      className={`w-full flex items-center gap-3 rounded border border-border p-2.5 text-left transition-colors ${
                        resolvingUrl && !busy
                          ? 'opacity-50 cursor-not-allowed'
                          : 'hover:bg-tertiary'
                      }`}
                    >
                      <HostIcon host={link.host} className="w-5 h-5 text-muted" />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-text truncate">
                          {prettyHost(link.host)}
                        </span>
                        <span className="block text-[11px] text-muted truncate">
                          {[link.group || 'Unlabeled',
                            link.compressed ? 'compressed build' : null,
                          ].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      {busy ? (
                        <i className="fas fa-circle-notch fa-spin text-sm text-accent" aria-hidden="true"></i>
                      ) : (
                        <i className="fas fa-chevron-right text-xs text-muted" aria-hidden="true"></i>
                      )}
                    </button>
                  )
                })}
              </div>
            </>
          )}

          {/* Only shown when split archives were actually found. */}
          {!loading && hidden?.sets > 0 && (
            <div className="rounded border border-border p-3 text-xs text-muted">
              <span className="text-text font-medium">
                {hidden.sets} split {hidden.sets === 1 ? 'download' : 'downloads'}
              </span>{' '}
              {hidden.sets === 1 ? 'was' : 'were'} left out. Multi-part archives
              aren&rsquo;t supported in the client yet &mdash; you can still
              download {hidden.sets === 1 ? 'it' : 'them'} from the thread.
            </div>
          )}
        </div>

        <div className="px-4 py-2.5 border-t border-border flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => load(true)}
            disabled={loading || Boolean(resolvingUrl)}
            className="text-[11px] text-muted hover:text-text disabled:opacity-40"
          >
            Refresh links
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-8 px-3 text-xs rounded-buttonTheme bg-button hover:bg-buttonHover text-text"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
