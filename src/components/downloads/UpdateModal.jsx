import { useCallback, useEffect, useState } from 'react'
import HostIcon from './HostIcon.jsx'
import { buildThreadUrl, threadUrlForGame } from './threadUrl.js'
import { buildDownloadOptions } from './linkSections.js'

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
  // Grouped into the BUILDS the poster offered, not a flat mirror list. See
  // linkSections.js: the choice is which build first, which mirror second, and a
  // flat list made "Season 1" and the current build look interchangeable.
  const options = buildDownloadOptions(data?.links)
  // threadUrlForGame owns the field-name variance; the only thing added here is
  // the freshly fetched thread id, which the modal has and the record may not.
  const threadUrl = data?.threadId
    ? buildThreadUrl({ siteUrl: game?.siteUrl || game?.site_url, f95Id: data.threadId })
      || threadUrlForGame(game)
    : threadUrlForGame(game)

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
        // Every browse row already knows whether it is in the library:
        // local_record_id is projected as localRecordId in all four branches of
        // the catalog union, resolved from the atlas / f95 / lewdcorner / steam
        // MAPPINGS — never from a title guess. Sending it means a download for a
        // game already in the library attaches to that record instead of being
        // treated as a catalog orphan.
        //
        // This was the duplicate-record risk: record_id here is `catalog:30956`
        // even when localRecordId is 412, so promoting on install would have
        // created a second record for a game already present.
        recordId:
          game?.localRecordId ?? game?.local_record_id ?? game?.record_id ?? null,
        // Sent unconditionally. For a library game this is a plain integer and
        // the main process rejects it as a ref; for a browse row it is the
        // `catalog:…` string that survives the record_id being nulled. Neither
        // side has to know which case it is in.
        // catalog_ref first: a wishlist row's record_id is `wishlist:<id>`,
        // which resolves to neither a record nor a ref, so the install had
        // nothing to work from. Browse rows carry the ref on record_id itself
        // and have no catalog_ref, so the fallback keeps them working.
        catalogRef: game?.catalog_ref ?? game?.record_id ?? null,
        title,
        creator: game?.creator || '',
        version: game?.latestVersion || game?.latest_version || '',
        url: resolved.url,
        host: resolved.host || link.host,
        source: 'f95',
        // Which build this is, in the poster's own words. The queue otherwise
        // shows the game title and the LATEST version on every row, so an old
        // season, a compressed build and the current one are three identical
        // lines and there is no way to tell which archive you are waiting for.
        //
        // The RAW heading, empty for the unlabeled block - the display name for
        // that case lives in linkSections.FULL_ARCHIVE and is applied by whoever
        // renders it, so the string still exists in exactly one place.
        buildLabel: link.group || '',
        // Left as 'replace'. A Browse row's record_id is a synthetic `catalog:…`
        // string rather than null, so testing it here was wrong — the main
        // process normalises the id and downgrades this to 'add' when there is no
        // library record, which keeps that rule in one place.
        onComplete: 'replace',
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
  const hiddenPlatform = data?.hiddenPlatform

  return (
    <div
      className="fixed inset-0 z-[1500] bg-black/60 flex items-center justify-center p-4"
      onClick={(event) => { if (event.target === event.currentTarget) onClose?.() }}
    >
      <div className="w-full max-w-xl max-h-[85vh] sm:max-h-[80vh] flex flex-col rounded-lg border border-border bg-primary shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-start justify-between gap-3">
          <div className="min-w-0">
            {/* The icon sits on the title's own line rather than in the corner
                beside Close: two 28px targets 8px apart is a misfire waiting to
                happen on a phone, and the one that closes the modal loses the
                fetched links. min-w-0 + truncate on the h2 keeps a long title
                from pushing the icon off the row. */}
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-base text-text truncate">Update {title}</h2>
              {/* Only when there is somewhere to go. A button that silently does
                  nothing is worse than no button - the same reasoning as the
                  "Open thread" fallback in the empty state below. */}
              {threadUrl && (
                <button
                  type="button"
                  onClick={() => window.electronAPI.openExternalUrl?.(threadUrl)}
                  title="Open this game's thread"
                  aria-label="Open this game's thread"
                  // h-8 w-8 on touch, h-6 w-6 from sm up: a 24px target is fine
                  // for a mouse and below the 44px guideline for a finger, so the
                  // padding is spent only where it is needed. -my-1 keeps the
                  // taller touch target from growing the header row.
                  className="shrink-0 -my-1 h-8 w-8 sm:h-6 sm:w-6 inline-flex items-center justify-center rounded text-muted hover:text-text hover:bg-tertiary focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                >
                  <i className="fas fa-link text-xs" aria-hidden="true"></i>
                </button>
              )}
            </div>
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
                  // openExternalUrl, not openExternal. The wrong name plus `?.` made
                  // this button do nothing at all: no error, no console warning,
                  // because optional chaining on a missing method is a silent no-op.
                  // scripts/check-preload-api.js now reconciles every call site
                  // against what preload exposes.
                  onClick={() => window.electronAPI.openExternalUrl?.(threadUrl)}
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
                {/* Every build unsupported is a real outcome, not an error, and
                    telling the user to "choose a mirror" when none is choosable
                    reads as a broken screen rather than a plain fact. */}
                {options.every((option) => option.unsupported)
                  ? 'This thread\u2019s builds are all on hosts Atlas cannot download from yet, so there is nothing to queue here.'
                  : options.length > 1
                    ? 'This thread offers more than one build. Pick the build first, then a mirror. F95zone will ask you to confirm in a browser window before the download starts.'
                    : 'Choose a mirror. F95zone will ask you to confirm in a browser window before the download starts.'}
              </p>
              {options.map((option) => (
                <div key={option.title} className="space-y-1.5">
                  {/* The build label only appears when there is a build to choose
                      between. With one option it is a caption on a list that has
                      no alternative, which is noise.

                      There is deliberately no "not the current build" warning any
                      more. It was written for the flat list, where nothing else
                      distinguished the sections; now the option is NAMED with the
                      poster's own heading, which says it better and says it for
                      the newest build too - where the old badge was simply wrong.

                      An unsupported build ALWAYS shows its name, even when it is
                      the only option: the explanation underneath is about a
                      specific build, and an unnamed one reads as a statement
                      about the whole thread. */}
                  {(options.length > 1 || option.unsupported) && (
                    <div className="flex items-baseline gap-2 pt-1">
                      <span className={`text-xs font-medium ${option.isUnlabeled ? 'text-accent' : 'text-text'}`}>
                        {option.title}
                      </span>
                      {/* Platform is an axis of its own now, so it is a badge on
                          the build rather than words inside its name. */}
                      {option.platforms.length > 0 && (
                        <span className="text-[10px] text-muted shrink-0">
                          {option.platforms.join(' \u00b7 ')}
                        </span>
                      )}
                      <span className="flex-1 h-px bg-border" />
                      <span className="text-[10px] text-muted shrink-0">
                        {option.unsupported
                          ? 'unavailable'
                          : `${option.links.length} ${option.links.length === 1 ? 'mirror' : 'mirrors'}`}
                      </span>
                    </div>
                  )}
                  {/* A build the thread offers but Atlas has no plugin for. Shown
                      rather than omitted - a missing build is one the user cannot
                      even report, and hiding the NEWEST build while older ones
                      remain is how someone updates to an older build by mistake.
                      Not rendered as chips: they are not choices, and anything
                      that looks like a button invites the click. */}
                  {option.unsupported ? (
                    <div className="rounded border border-border border-dashed bg-tertiary/30 px-2.5 py-2">
                      <p className="text-[11px] text-muted">
                        Posted only to{' '}
                        <span className="text-text">
                          {option.hosts.map(prettyHost).join(', ')}
                        </span>
                        {option.hosts.length === 1
                          ? ', which Atlas has no download plugin for yet.'
                          : ', none of which Atlas has a download plugin for yet.'}
                      </p>
                      {threadUrl && (
                        <button
                          type="button"
                          onClick={() => window.electronAPI.openExternalUrl?.(threadUrl)}
                          className="mt-1.5 text-[11px] text-accent hover:underline"
                        >
                          Open the thread to grab it yourself
                        </button>
                      )}
                    </div>
                  ) : (
                  /* Mirror chips, not full-width rows. A row per link made a
                      four-mirror build four screens tall while carrying one word
                      of information each; these are sized to fit the longest host
                      name in the data ("Buzzheavier.com") and wrap. On a narrow
                      window they fall back to one per row on their own, because
                      the basis is a min-width rather than a fraction. */
                  <div className="flex flex-wrap gap-1.5">
                    {option.links.map((link) => {
                      const busy = resolvingUrl === link.url
                      return (
                        <button
                          key={link.url}
                          type="button"
                          onClick={() => choose(link)}
                          disabled={Boolean(resolvingUrl)}
                          title={[prettyHost(link.host), option.title, link.compressed ? 'compressed build' : null]
                            .filter(Boolean).join(' \u2014 ')}
                          className={`grow sm:grow-0 basis-full sm:basis-[9.5rem] min-w-0 inline-flex items-center gap-2 rounded border border-border px-2.5 py-2 text-left transition-colors ${
                            resolvingUrl && !busy
                              ? 'opacity-50 cursor-not-allowed'
                              : 'hover:bg-tertiary hover:border-accent/50'
                          }`}
                        >
                          {busy ? (
                            <i className="fas fa-circle-notch fa-spin text-xs text-accent shrink-0" aria-hidden="true"></i>
                          ) : (
                            <HostIcon host={link.host} className="w-4 h-4 shrink-0 text-muted" />
                          )}
                          <span className="min-w-0 flex-1">
                            {/* The bare host, which is what the thread itself
                                shows. The subtitle that used to repeat the group
                                here is gone: it is the heading above now. */}
                            <span className="block text-xs text-text truncate">
                              {prettyHost(link.host)}
                            </span>
                            {link.compressed && (
                              <span className="block text-[10px] text-amber-400 truncate">
                                compressed
                              </span>
                            )}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  )}
                </div>
              ))}
            </>
          )}

          {/* Builds this machine cannot run. Shown as a count rather than as
              greyed rows: it is not a choice, so it should not look like one -
              but a thread that visibly has downloads while Atlas shows none of
              them needs to say why. */}
          {!loading && hiddenPlatform?.links > 0 && (
            <div className="rounded border border-border p-3 text-xs text-muted">
              <span className="text-text font-medium">
                {hiddenPlatform.links}{' '}
                {hiddenPlatform.links === 1 ? 'mirror' : 'mirrors'}
              </span>{' '}
              {hiddenPlatform.links === 1 ? 'was' : 'were'} posted for{' '}
              {hiddenPlatform.platforms.join(' / ') || 'another platform'}, which
              this machine can&rsquo;t run.
            </div>
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
