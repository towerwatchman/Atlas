import { useState } from 'react'
import { pickGameFolder } from '../../utils/librarySettings.js'

// ── "No game folder is set" ──────────────────────────────────────────────────
//
// Installing a download used to end at a sentence: "No game folder is set.
// Choose one in Settings > Library." That is a correct diagnosis and a dead end
// — the user is holding a finished multi-gigabyte archive and gets sent to
// another screen, with nothing carrying them back to the thing they were doing.
//
// The folder is set here instead, and the install carries on.
//
// It does NOT open its own picker. pickGameFolder() in utils/librarySettings.js
// is the one picker for Library.gameFolder, shared with the settings page, so
// the two cannot drift apart.
//
// Raised two ways, which is why `reason` exists:
//   'preflight'  the folder was already missing when Install was pressed, so
//                nothing has been attempted yet
//   'failed'     the install ran and refused with step 'no-library-folder',
//                which means the folder was cleared or emptied between the
//                check and the attempt
// The second wording has to acknowledge that something already went wrong;
// telling that user "before we start" would be describing a different event.

export default function LibraryFolderModal({
  open,
  reason = 'preflight',
  title = '',
  onCancel,
  onChosen,
}) {
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState('')

  if (!open) return null

  const choose = async () => {
    setPicking(true)
    setError('')
    try {
      const path = await pickGameFolder()
      // An empty path is a cancelled dialog, not a failure. Leaving the modal up
      // is the right response: the user is still stuck without a folder, and
      // closing would drop them back where they started with no explanation.
      if (!path) return
      onChosen?.(path)
    } catch (err) {
      setError(err?.message || 'Could not set the folder.')
    } finally {
      setPicking(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[1600] bg-black/60 flex items-center justify-center p-4"
      onClick={(event) => { if (event.target === event.currentTarget) onCancel?.() }}
    >
      {/* max-w-md with w-full, and the actions stack below sm: the settings
          window and a narrow app window both render this. */}
      <div className="w-full max-w-md rounded-lg border border-border bg-primary shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-base text-text">Choose a game folder</h2>
        </div>

        <div className="p-4 space-y-3 text-sm text-text">
          {reason === 'failed' ? (
            <p>
              The install stopped because Atlas has no game folder to install into.
              {title ? <> <span className="font-medium">{title}</span> is</> : ' The download is'}{' '}
              still here &mdash; pick a folder and it will carry on from where it
              stopped.
            </p>
          ) : (
            <p>
              Atlas needs somewhere to put installed games before it can unpack
              {title ? <> <span className="font-medium">{title}</span></> : ' this download'}.
              Pick that folder now and the install starts straight after.
            </p>
          )}

          <p className="text-xs text-muted">
            This is the same setting as <span className="text-text">Settings &rsaquo; Library
            &rsaquo; Default Game Folder</span>, so you only choose it once. Keep it
            separate from your downloads folder &mdash; this one gets scanned for
            installed games.
          </p>

          {error && <p className="text-xs text-danger">{error}</p>}
        </div>

        <div className="px-4 py-3 border-t border-border flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-8 px-3 text-xs rounded-buttonTheme bg-button hover:bg-buttonHover text-text"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={choose}
            disabled={picking}
            className="h-8 px-4 text-xs rounded-buttonTheme bg-accent hover:bg-accentHover text-white disabled:opacity-50"
          >
            {picking ? 'Choosing\u2026' : 'Choose folder\u2026'}
          </button>
        </div>
      </div>
    </div>
  )
}
