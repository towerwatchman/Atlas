import { Fragment, useCallback, useEffect, useState } from 'react'
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
//
// ── Session mode ─────────────────────────────────────────────────────────────
//
// "Update all games" runs this same dialog once per game rather than growing a
// parallel batch UI. The build-and-mirror choice is the whole reason this modal
// exists - an old season, a compressed build and the current one are different
// downloads - and a batch screen that picked for the user would be picking
// wrong on exactly the threads this modal was written to disambiguate.
//
// `session` only adds the frame around that: which game of how many, a way past
// this one, and a way out of the run. When it is set the modal does NOT close
// itself after queueing; the session decides what comes next, and a modal that
// closed itself would flash the library between every game.

const prettyHost = (host) => String(host || '').replace(/^www\./, '')

// Only folder hosts take the list-folder step. A Gofile share URL names a
// folder, so the listing picks between picker and single file. Other hosts
// queue the resolved URL untouched: probing their links rewrote good URLs
// (Buzzheavier lost its ?v= token and the CDN 403d) or dropped data the
// queue needs (Mega's decrypt spec). A future folder host opts in here.
const FOLDER_PICKER_HOST = /gofile/i

// Fresh loading, error and links slots for each tab.
const freshEntries = () => ({
  f95: { loading: false, error: '', errorCode: '', data: null },
  lewdcorner: { loading: false, error: '', errorCode: '', data: null },
})

const formatBytes = (value) => {
  const bytes = Number(value) || 0
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const scaled = bytes / 1024 ** index
  return `${scaled.toFixed(index === 0 ? 0 : scaled >= 10 ? 1 : 2)} ${units[index]}`
}

export default function UpdateModal({ game, open, onClose, onQueued, session = null }) {
  // Loading, error and links live per tab, so a failed fetch on one tab does not clear the other.
  const [bySource, setBySource] = useState(freshEntries)
  const [activeSource, setActiveSource] = useState('f95')
  const [resolvingUrl, setResolvingUrl] = useState('')
  const [folderChoices, setFolderChoices] = useState(null)

  const f95ThreadId = game?.f95_id || game?.f95Id || null
  const lcThreadId = game?.lc_id || game?.lcId || game?.lewdCornerId || null
  const title = game?.title || 'this game'

  // One entry per linked source. The tab row only renders when both ids exist.
  const sources = [
    ...(f95ThreadId ? [{ key: 'f95', id: f95ThreadId }] : []),
    ...(lcThreadId ? [{ key: 'lewdcorner', id: lcThreadId }] : []),
  ]
  const activeId = activeSource === 'lewdcorner' ? lcThreadId : f95ThreadId
  // The open tab's display name. Labels that act on one tab say which one.
  const activeSourceName = activeSource === 'lewdcorner' ? 'LewdCorner' : 'F95zone'
  // loading, error and data below come from the open tab.
  const { loading, error, errorCode, data } = bySource[activeSource]

  // Where "Open thread" goes. See threadUrl.js for why this is not a template
  // string built from an id that may not exist.
  // Grouped into the BUILDS the poster offered, not a flat mirror list. See
  // linkSections.js: the choice is which build first, which mirror second, and a
  // flat list made "Season 1" and the current build look interchangeable.
  const options = buildDownloadOptions(data?.links)
  // threadUrlForGame owns the field-name variance; the only thing added here is
  // the freshly fetched thread id, which the modal has and the record may not.
  // The thread button follows the open tab. data.threadId is that tab's own
  // id, so it builds an F95 URL on the F95 tab and an LC URL on the LC tab.
  const threadUrl = activeSource === 'lewdcorner'
    ? buildThreadUrl({ lewdCornerSiteUrl: game?.lewdCornerSiteUrl || game?.lewdcornerSiteUrl, lcId: data?.threadId || lcThreadId })
      || threadUrlForGame(game)
    : data?.threadId
      ? buildThreadUrl({ siteUrl: game?.siteUrl || game?.site_url, f95Id: data.threadId })
        || threadUrlForGame(game)
      : threadUrlForGame(game)

  // One loader for both tabs. updateLinksGet takes a threadId, lcLinksGet takes an lcId.
  const loadSource = useCallback(async (source, id, force = false) => {
    const sourceName = source === 'lewdcorner' ? 'LewdCorner' : 'F95zone'
    if (!id) {
      setBySource((prev) => ({
        ...prev,
        [source]: { loading: false, error: `This game has no ${sourceName} thread linked, so Atlas cannot look up download links.`, errorCode: '', data: null },
      }))
      return
    }
    setBySource((prev) => ({ ...prev, [source]: { ...prev[source], loading: true, error: '', errorCode: '' } }))
    try {
      const result = source === 'lewdcorner'
        ? await window.electronAPI.lcLinksGet?.({ lcId: id, force })
        : await window.electronAPI.updateLinksGet?.({ threadId: id, force })
      if (result?.ok) {
        setBySource((prev) => ({ ...prev, [source]: { loading: false, error: '', errorCode: '', data: result } }))
      } else {
        setBySource((prev) => ({
          ...prev,
          [source]: { loading: false, error: result?.error || `Could not load ${sourceName} links`, errorCode: result?.code || '', data: null },
        }))
      }
    } catch (err) {
      setBySource((prev) => ({ ...prev, [source]: { loading: false, error: err.message || `Could not load ${sourceName} links`, errorCode: '', data: null } }))
    }
  }, [])

  useEffect(() => {
    if (open) {
      // The linked tab loads on open; the other loads on first click. The ids
      // are dependencies so session mode refetches for each new game instead
      // of showing the last game's links.
      const first = f95ThreadId ? 'f95' : 'lewdcorner'
      setActiveSource(first)
      setBySource(freshEntries())
      setResolvingUrl('')
      setFolderChoices(null)
      loadSource(first, first === 'lewdcorner' ? lcThreadId : f95ThreadId, false)
    } else {
      setBySource(freshEntries())
      setResolvingUrl('')
      setFolderChoices(null)
    }
  }, [open, f95ThreadId, lcThreadId, loadSource])

  // Each tab fetches on first open and keeps its links until the modal closes.
  const selectSource = (source) => {
    setActiveSource(source)
    const entry = bySource[source]
    if (!entry.data && !entry.error && !entry.loading) {
      loadSource(source, source === 'lewdcorner' ? lcThreadId : f95ThreadId, false)
    }
  }

  // Resolve and queue errors belong to the open tab.
  const setActiveError = (message, code = '') => {
    setBySource((prev) => ({ ...prev, [activeSource]: { ...prev[activeSource], error: message, errorCode: code } }))
  }

  // Resolving opens a real browser window where the user clears F95's gate
  // themselves. Atlas reads the destination and queues it.
  const queueDownload = async (link, url, host) => {
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
        url,
        host,
        source: activeSource === 'lewdcorner' ? 'lewdcorner' : 'f95',
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
        setFolderChoices(null)
        onQueued?.(queued.item)
        // In a session the parent advances to the next game, which unmounts
        // this content anyway. Closing here as well would race that and leave
        // the run showing nothing.
        if (!session) onClose?.()
      } else {
        setActiveError(queued?.error || 'Could not add this to the download queue')
      }
  }

  const choose = async (link) => {
    setResolvingUrl(link.url)
    setActiveError('')
    setFolderChoices(null)
    try {
      const resolved = await window.electronAPI.downloadsResolveMasked?.({
        url: link.url,
        title,
      })
      if (!resolved?.ok) {
        if (!resolved?.canceled) {
          setActiveError(resolved?.error || 'Could not get the download link')
        }
        return
      }
      // Only folder hosts get a listing. The rest queue the resolved URL.
      if (!FOLDER_PICKER_HOST.test(link.host || '')) {
        await queueDownload(link, resolved.url, resolved.host || link.host)
        return
      }
      // The listing decides: choices present means pick, anything else queues.
      // Hosts with no plugin fall through to the queue instead of erroring.
      const folder = await window.electronAPI.downloadsListFolder?.({ url: resolved.url })?.catch(() => null)
      if (folder?.ok && folder.choices?.length) {
        setFolderChoices({ linkUrl: link.url, link, resolved, choices: folder.choices })
        return
      }
      if (folder && !folder.ok && !/no plugin/i.test(folder.error || '')) {
        setActiveError(folder.error || 'Could not read this folder')
        return
      }
      await queueDownload(link, folder?.directUrl || resolved.url, resolved.host || link.host)
    } catch (err) {
      setActiveError(err.message || 'Could not start this download')
    } finally {
      setResolvingUrl('')
    }
  }

  const chooseFile = async (choice) => {
    const picked = folderChoices
    if (!picked) return
    setResolvingUrl(picked.linkUrl)
    setActiveError('')
    try {
      await queueDownload(picked.link, choice.directUrl, picked.resolved.host || picked.link.host)
    } catch (err) {
      setActiveError(err.message || 'Could not start this download')
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
      // A backdrop click closes a single-game update, but during a run it would
      // throw away the walkthrough - the same click that costs one dialog
      // normally costs twenty games' worth of progress here. The run is ended
      // from its own labelled button instead.
      onClick={(event) => {
        if (session) return
        if (event.target === event.currentTarget) onClose?.()
      }}
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
            {/* Where the user is in the run. Both numbers, not a percentage: the
                decision this line supports is "do I keep going or stop", and
                "19 left" answers that where "21%" does not. */}
            {session && (
              <p className="text-xs text-accent mt-0.5">
                Game {session.position} of {session.total}
                <span className="text-muted"> &middot; {session.remaining} left</span>
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

        {sources.length > 1 && (
          <div role="tablist" aria-label="Download sources" className="px-4 flex gap-2 border-b border-border shrink-0">
            {sources.map((source) => {
              const selected = activeSource === source.key
              return (
                <button
                  key={source.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => selectSource(source.key)}
                  className={`text-xs px-3 py-2 border-b-2 transition-colors -mb-px ${
                    selected ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-text'
                  }`}
                >
                  {source.key === 'f95' ? 'F95zone' : 'LewdCorner'}
                </button>
              )
            })}
          </div>
        )}

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
                  Settings &rsaquo; Accounts is where {activeSourceName} sign-in lives.
                </p>
              )}
              <button
                type="button"
                onClick={() => loadSource(activeSource, activeId, true)}
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
                    ? `This thread offers more than one build. Pick the build first, then a mirror. ${activeSourceName} will ask you to confirm in a browser window before the download starts.`
                    : `Choose a mirror. ${activeSourceName} will ask you to confirm in a browser window before the download starts.`}
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
                        <Fragment key={link.url}>
                        <button
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
                        {folderChoices?.linkUrl === link.url && (
                          <div className="basis-full rounded border border-border bg-tertiary/30 px-2 py-1.5 space-y-1">
                            {folderChoices.choices.map((choice) => (
                              <button
                                key={choice.directUrl}
                                type="button"
                                onClick={() => chooseFile(choice)}
                                disabled={Boolean(resolvingUrl)}
                                className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-tertiary disabled:opacity-40"
                              >
                                <i className="fas fa-file-archive text-[11px] text-muted shrink-0" aria-hidden="true"></i>
                                <span className="min-w-0 flex-1 truncate text-xs text-text">
                                  {choice.name}
                                </span>
                                <span className="text-[10px] text-muted shrink-0">
                                  {formatBytes(choice.size)}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                        </Fragment>
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
            onClick={() => loadSource(activeSource, activeId, true)}
            disabled={loading || Boolean(resolvingUrl)}
            className="text-[11px] text-muted hover:text-text disabled:opacity-40"
          >
            {sources.length > 1 ? `Refresh ${activeSourceName} links` : 'Refresh links'}
          </button>
          {session ? (
            // Two different exits, and they are not the same thing. Skip leaves
            // this game alone and moves on; Stop ends the run. Downloads already
            // queued keep going in both cases - stopping the walkthrough is not
            // cancelling the transfers, which is why the label is "Stop
            // checking" rather than "Cancel".
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={session.onStop}
                disabled={Boolean(resolvingUrl)}
                className="h-8 px-3 text-xs rounded-buttonTheme bg-button hover:bg-buttonHover text-text disabled:opacity-40"
              >
                Stop checking
              </button>
              <button
                type="button"
                onClick={session.onSkip}
                disabled={Boolean(resolvingUrl)}
                className="h-8 px-3 text-xs rounded-buttonTheme bg-accent hover:bg-accentHover text-white disabled:opacity-40"
              >
                Skip
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="h-8 px-3 text-xs rounded-buttonTheme bg-button hover:bg-buttonHover text-text"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
