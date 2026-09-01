import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import InstallModal from './InstallModal.jsx'
import LibraryFolderModal from './LibraryFolderModal.jsx'
import LibraryStructureModal from './LibraryStructureModal.jsx'
import { getLibraryConfig } from '../../utils/librarySettings.js'
import {
  canPresentInstall,
  dropInstallPrompt,
  enqueueInstallPrompt,
  takeNextInstall,
} from './installPromptQueue.js'

// ── Install flow host ────────────────────────────────────────────────────────
//
// The install dialog, its two setup prompts and its result notice, all lifted
// out of DownloadsPage and mounted once at App level.
//
// The move is what makes "prompt me when a download finishes" possible at all.
// While these lived inside DownloadsPage they could only appear on the downloads
// screen, so a download completing while the user was anywhere else had nowhere
// to put its dialog - and the alternative, mounting a second copy for the
// automatic case, would have meant two InstallModals racing for the same item
// the moment the user happened to be looking at the downloads page when one
// finished.
//
// DownloadsPage now asks this to open (requestInstall) instead of owning it. It
// keeps everything else it had.
//
// ── What "auto install" is NOT ───────────────────────────────────────────────
//
// It raises the confirmation dialog by itself; it does not install by itself.
// The version string on that dialog becomes a folder name and decides whether an
// existing build is REPLACED - see InstallModal's own header for why that is a
// question rather than an inference - and none of that stops being true because
// the dialog opened without being asked for.

const InstallFlowHost = forwardRef(function InstallFlowHost(
  { blocked = false, onInstalled },
  ref,
) {
  const [installTarget, setInstallTarget] = useState(null)
  const [installNotice, setInstallNotice] = useState(null)
  const [folderPrompt, setFolderPrompt] = useState(null)
  const [structurePrompt, setStructurePrompt] = useState(null)
  const [queue, setQueue] = useState([])
  // Ids already raised this session. Kept in a ref rather than state because
  // nothing renders from it and every write would otherwise be a re-render
  // during a download's progress events.
  const promptedRef = useRef(new Set())
  // Ids already handed to the queue. Separate from promptedRef because an item
  // sits in the queue for some time before it is presented, and the completion
  // events keep arriving during that window.
  const queuedIdsRef = useRef(new Set())
  // Ids the main process is currently unpacking. downloads-install refuses a
  // second concurrent install, so a prompt raised now could only be answered
  // with "another install is already running".
  const [installingIds, setInstallingIds] = useState(() => new Set())
  // True between openInstall being called and the dialog it leads to appearing.
  // Without it the presentation effect fires again on the next event while the
  // config read is still in flight and starts a second flow for the next item.
  const openingRef = useRef(false)

  // The version suggestion is derived in the main process, where the parser and
  // the catalog version both live; the modal only presents it.
  const showInstallModal = useCallback(async (item) => {
    let suggestion = null
    try {
      suggestion = await window.electronAPI.downloadsSuggestVersion?.({ id: item.id })
    } catch {
      // A failed suggestion is not fatal - the field is editable anyway.
    }
    setInstallTarget({ item, suggestion: suggestion?.ok ? suggestion : null })
    openingRef.current = false
  }, [])

  // Ordered, one question at a time. The folder comes first because it is the
  // only one that actually blocks - without it there is nowhere to unpack - and
  // because the structure preview is meaningless until there is a root path to
  // show it under.
  //
  // A config read that fails resolves to {}, which reads as "neither answered"
  // and would raise both prompts against a working install. gameFolder is
  // therefore only treated as missing when the read produced SOMETHING, so a
  // broken config falls through to the install and its existing failure path
  // rather than being interrupted by a dialog it cannot honour.
  const openInstall = useCallback(async (item) => {
    openingRef.current = true
    try {
      const library = await getLibraryConfig()
      const known = Object.keys(library).length > 0

      if (known && !String(library.gameFolder || '').trim()) {
        setFolderPrompt({ item, reason: 'preflight' })
        openingRef.current = false
        return
      }
      if (known && library.structurePrompted !== true) {
        setStructurePrompt({ item, gameFolder: String(library.gameFolder || '') })
        openingRef.current = false
        return
      }
      await showInstallModal(item)
    } catch (error) {
      openingRef.current = false
      throw error
    }
  }, [showInstallModal])

  // What DownloadsPage's Install button calls. Direct requests jump the queue
  // because they are a click the user just made on a visible button: making one
  // wait behind an automatic prompt would look like the button did nothing.
  useImperativeHandle(ref, () => ({
    requestInstall: (item) => {
      if (!item?.id) return
      promptedRef.current.add(item.id)
      setQueue((previous) => dropInstallPrompt(previous, item.id))
      openInstall(item)
    },
  }), [openInstall])

  // Downloads that finish while the setting is on join the line. Both events are
  // listened to: download-complete is the moment the transfer ends, but the row
  // does not become installable until the file is on disk and recorded, which is
  // a download-updated. Taking either and de-duplicating is more robust than
  // picking one and being wrong about the ordering.
  useEffect(() => {
    const track = (item) => {
      if (!item?.id) return
      setInstallingIds((previous) => {
        const busy = item.state === 'extracting' || item.state === 'importing'
        if (busy === previous.has(item.id)) return previous
        const next = new Set(previous)
        if (busy) next.add(item.id)
        else next.delete(item.id)
        return next
      })
      if (item.installable !== true) {
        // It stopped being installable - installed, or its archive was cleared.
        // A queue entry is a snapshot, so without this the dialog can be raised
        // for an item that no longer has anything to install.
        setQueue((previous) => dropInstallPrompt(previous, item.id))
        return
      }
      // Already handled, or already waiting. Checked before the config read so
      // the repeated download-updated events a single row produces do not each
      // cost a settings round trip.
      if (promptedRef.current.has(item.id) || queuedIdsRef.current.has(item.id)) return
      queuedIdsRef.current.add(item.id)
      // The setting is read here rather than passed in from App because it is
      // written in the SETTINGS WINDOW, which is its own renderer process. A
      // value App read at startup would be stale for the rest of the session
      // unless a new broadcast channel were added for it, and this read happens
      // at most once per finished download.
      getLibraryConfig()
        .then((library) => {
          const enabled = library?.autoInstallPrompt === true || library?.autoInstallPrompt === 'true'
          if (!enabled) return
          setQueue((previous) => enqueueInstallPrompt(previous, item, promptedRef.current))
        })
        .catch(() => {
          // A failed config read means the setting is unknown, and the safe
          // reading of unknown is "do not put a dialog on the user's screen".
        })
    }
    const offs = [
      window.electronAPI.onDownloadUpdated?.(track),
      window.electronAPI.onDownloadComplete?.(track),
      window.electronAPI.onDownloadRemoved?.(({ id }) => {
        setQueue((previous) => dropInstallPrompt(previous, id))
      }),
    ]
    return () => offs.forEach((off) => { if (typeof off === 'function') off() })
  }, [])

  // The only place a queued prompt gets presented. Re-runs on every input to
  // canPresentInstall, so a run ending or a dialog closing is what releases the
  // next one - there is no polling and nothing to keep in sync.
  useEffect(() => {
    const presentable = canPresentInstall({
      queue,
      blocked,
      installing: installingIds.size > 0,
      activeTarget: installTarget || folderPrompt || structurePrompt || installNotice,
      pendingPrompt: openingRef.current,
    })
    if (!presentable) return
    const { item, rest } = takeNextInstall(queue)
    if (!item) return
    promptedRef.current.add(item.id)
    setQueue(rest)
    openInstall(item)
  }, [queue, blocked, installingIds, installTarget, folderPrompt, structurePrompt, installNotice, openInstall])

  return (
    <>
      {installNotice && (
        <div className="fixed inset-0 z-[1500] bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-primary shadow-2xl">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-base text-text">Installed{installNotice.title ? ` ${installNotice.title}` : ''}</h2>
            </div>
            <p className="px-4 py-3 text-xs text-text">{installNotice.message}</p>
            <div className="px-4 py-3 border-t border-border flex justify-end">
              <button
                type="button"
                onClick={() => setInstallNotice(null)}
                className="h-8 px-4 text-xs rounded-buttonTheme bg-accent hover:bg-accentHover text-white"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      <InstallModal
        item={installTarget?.item}
        suggestion={installTarget?.suggestion}
        open={Boolean(installTarget)}
        onClose={() => setInstallTarget(null)}
        onInstalled={(result) => {
          const pending = installTarget?.item
          setInstallTarget(null)
          onInstalled?.(result)
          // DownloadsPage used to call its own refresh() here, back when it
          // owned this dialog. A window event rather than a prop chain because
          // the page is not always mounted when an install finishes now - that
          // is the entire point of hoisting this - and a prop would have to be
          // threaded through App to a component that may not exist.
          window.dispatchEvent(new CustomEvent('atlas:downloads-refresh'))
          // The new version installs either way, so a declined replace is a
          // notice rather than an error — but the user asked for the old build
          // to go, and saying nothing about it staying is what made this read as
          // broken rather than as a refusal.
          if (result?.busy) {
            setInstallNotice({
              title: '',
              message: result.error || 'Another install is already running.',
            })
            return
          }
          // Not a notice — a question with an answer. The item stays installable
          // (fail() parks it in install_failed with the archive intact), so
          // setting the folder and retrying costs nothing but the click.
          if (result?.step === 'no-library-folder') {
            if (pending) setFolderPrompt({ item: pending, reason: 'failed' })
            return
          }
          // A download promoted onto a record that matched by TITLE rather than
          // by any id is the one outcome here worth interrupting for: no atlas,
          // f95, LewdCorner or Steam id linked these two, only the name did, so
          // it may not be the game that was meant. Everything else about a
          // promotion is the expected result and needs no dialog.
          if (result?.success && result.attachedByTitle) {
            setInstallNotice({
              title: result.version || '',
              message:
                `Atlas added this version to the existing library entry for `
                + `"${result.promotedTitle || pending?.title || 'this game'}", which matched by `
                + `name only — no store or thread id linked them. If that is a different `
                + `game, move the version from its page.`
                + (result.replaceMessage ? ` ${result.replaceMessage}` : ''),
            })
            return
          }
          if (result?.success && result.replaceMessage) {
            setInstallNotice({ title: result.version || '', message: result.replaceMessage })
          }
        }}
      />

      {/* The reactive half of the folder prompt. openInstall checks the setting
          up front, but the folder can be cleared between that check and the
          install actually running, and the main process is the only thing that
          knows the difference between "not set" and "set but unusable". `step`
          is what fail() puts on the refusal, so branching on it here is reading
          the main process's own classification rather than matching its prose. */}
      <LibraryFolderModal
        open={Boolean(folderPrompt)}
        reason={folderPrompt?.reason || 'preflight'}
        title={folderPrompt?.item?.title || ''}
        onCancel={() => setFolderPrompt(null)}
        onChosen={async () => {
          const pending = folderPrompt?.item
          setFolderPrompt(null)
          // Straight back into openInstall rather than into the install modal:
          // the structure question may still be outstanding, and this is the
          // only place that decides the order between them.
          if (pending) await openInstall(pending)
        }}
      />

      <LibraryStructureModal
        open={Boolean(structurePrompt)}
        gameFolder={structurePrompt?.gameFolder || ''}
        onDone={async () => {
          const pending = structurePrompt?.item
          setStructurePrompt(null)
          // showInstallModal, not openInstall: the flag has just been written and
          // re-reading it would be a race with no upside, and both questions are
          // now answered by construction.
          if (pending) await showInstallModal(pending)
        }}
      />
    </>
  )
})

export default InstallFlowHost
