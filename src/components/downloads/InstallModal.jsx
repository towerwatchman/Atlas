import { useEffect, useState } from 'react'

// ── Install modal ────────────────────────────────────────────────────────────
//
// Confirmation step between a finished download and installing it.
//
// A download never installs itself. The version string here becomes the folder
// name on disk and decides whether the install REPLACES an existing build, and
// it is derived from an uploader's freeform filename - so it gets shown,
// pre-filled, and left editable rather than acted on silently.
//
// The mismatch case matters most: when the filename and the catalog disagree
// about the version, that usually means the thread moved on between the link
// being minted and the download finishing. Both values are surfaced so the user
// settles it, instead of the client quietly picking one and possibly
// overwriting the wrong build.

const CONFIDENCE_NOTE = {
  high: '',
  medium: 'Taken from the catalog rather than the file — worth a check.',
  low: 'Atlas is not confident about this one. Please confirm before installing.',
}

export default function InstallModal({ item, suggestion, open, onClose, onInstalled }) {
  const [version, setVersion] = useState('')
  const [mode, setMode] = useState('replace')
  // Deleting the archive is the default: these are multi-gigabyte files and
  // keeping every one silently fills a disk.
  const [keepArchive, setKeepArchive] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) { setError(''); return }
    setVersion(suggestion?.version || item?.version || '')
    setMode(item?.onComplete === 'add' ? 'add' : 'replace')
    setKeepArchive(false)
  }, [open, suggestion, item])

  if (!open || !item) return null

  // Dismiss straight away rather than holding the dialog open behind a
  // spinner. Extraction takes minutes on a large archive, and the download
  // page already reports extracting / importing progress for the item - so
  // blocking the UI would show the same thing twice and hide the library.
  // A failure surfaces on the row itself, which is where the item lives.
  const confirm = () => {
    const clean = String(version || '').trim()
    if (!clean) { setError('A version is required.'); return }
    const request = {
      id: item.id,
      version: clean,
      onComplete: mode,
      keepArchive,
    }
    onClose?.()
    Promise.resolve(window.electronAPI.downloadsInstall?.(request))
      .then((result) => onInstalled?.(result))
      .catch((err) => console.error('Install failed:', err))
  }

  const note = CONFIDENCE_NOTE[suggestion?.confidence] || ''

  return (
    <div
      className="fixed inset-0 z-[1500] bg-black/60 flex items-center justify-center p-4"
      onClick={(event) => { if (event.target === event.currentTarget) onClose?.() }}
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-primary shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-base text-text truncate">Install {item.title}</h2>
          {item.fileName && (
            <p className="text-[11px] text-muted mt-0.5 font-mono break-all">{item.fileName}</p>
          )}
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label htmlFor="install-version" className="block text-sm text-text mb-1">
              Version
            </label>
            <input
              id="install-version"
              type="text"
              value={version}
              onChange={(event) => setVersion(event.target.value)}
             
              className="w-full bg-tertiary border border-border rounded p-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
            <p className="text-[11px] text-muted mt-1">
              This becomes the folder name in your library.
              {note ? ` ${note}` : ''}
            </p>
          </div>

          {/* Only shown when the two sources actually disagree. */}
          {suggestion?.mismatch && (
            <div className="rounded border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-text">
              <p className="font-medium text-amber-400">Version mismatch</p>
              <p className="mt-1">
                The file looks like{' '}
                <span className="font-mono">{suggestion.fileVersion}</span>, but the
                catalog says{' '}
                <span className="font-mono">{suggestion.catalogVersion}</span>. The
                file usually wins, since it describes what you actually downloaded
                — but check before replacing anything.
              </p>
            </div>
          )}

          <div>
            <span className="block text-sm text-text mb-1.5">When installed</span>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="install-mode"
                checked={mode === 'replace'}
                onChange={() => setMode('replace')}
               
                className="mt-0.5 accent-accent"
              />
              <span className="text-xs">
                <span className="text-text">Replace the installed version</span>
                <span className="block text-muted">
                  The previous build is swapped out.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer mt-2">
              <input
                type="radio"
                name="install-mode"
                checked={mode === 'add'}
                onChange={() => setMode('add')}
               
                className="mt-0.5 accent-accent"
              />
              <span className="text-xs">
                <span className="text-text">Keep both versions</span>
                <span className="block text-muted">
                  The existing build stays where it is.
                </span>
              </span>
            </label>
          </div>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={keepArchive}
              onChange={(event) => setKeepArchive(event.target.checked)}
              className="mt-0.5 accent-accent"
            />
            <span className="text-xs">
              <span className="text-text">Keep the downloaded archive</span>
              <span className="block text-muted">
                By default the archive is deleted once the game is installed.
              </span>
            </span>
          </label>

          {error && <p className="text-xs text-danger">{error}</p>}
        </div>

        <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
           
            className="h-8 px-3 text-xs rounded-buttonTheme bg-button hover:bg-buttonHover text-text disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!version.trim()}
            className={`h-8 px-4 text-xs rounded-buttonTheme text-white ${
              !version.trim()
                ? 'bg-tertiary text-muted cursor-not-allowed'
                : 'bg-accent hover:bg-accentHover'
            }`}
          >
            Install
          </button>
        </div>
      </div>
    </div>
  )
}
