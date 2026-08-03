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
  // Which existing build to replace. Asked rather than inferred: this decides
  // which directory is deleted, and the main process was choosing it with
  // nothing on screen saying which.
  const [replaceVersionId, setReplaceVersionId] = useState('')
  // Deleting the archive is the default: these are multi-gigabyte files and
  // keeping every one silently fills a disk.
  const [keepArchive, setKeepArchive] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) { setError(''); return }
    setVersion(suggestion?.version || item?.version || '')
    setMode(item?.onComplete === 'add' ? 'add' : 'replace')
    setKeepArchive(false)
    // Default to the build the library treats as current, then the only
    // installed one. Never to "whichever came first", which is what the main
    // process used to do.
    const installed = (suggestion?.versions || []).filter((entry) => entry.installed)
    const preselected = installed.find(
      (entry) => String(entry.versionId) === String(suggestion?.selectedVersionId),
    ) || (installed.length === 1 ? installed[0] : null)
    setReplaceVersionId(preselected?.versionId != null ? String(preselected.versionId) : '')
  }, [open, suggestion, item])

  if (!open || !item) return null

  // Installed builds are the only ones with files to replace. An uninstalled row
  // is a database entry with nothing on disk, so replacing it would delete
  // nothing and only confuse the choice. Declared above confirm() because it is
  // read there as well as in the markup.
  const replaceOptions = (suggestion?.versions || []).filter((entry) => entry.installed)
  const soleReplaceTarget = replaceOptions.length === 1 ? replaceOptions[0] : null

  // Dismiss straight away rather than holding the dialog open behind a
  // spinner. Extraction takes minutes on a large archive, and the download
  // page already reports extracting / importing progress for the item - so
  // blocking the UI would show the same thing twice and hide the library.
  // A failure surfaces on the row itself, which is where the item lives.
  const confirm = () => {
    const clean = String(version || '').trim()
    if (!clean) { setError('A version is required.'); return }
    if (mode === 'replace' && replaceOptions.length > 1 && !replaceVersionId) {
      setError('Choose which version to replace.')
      return
    }
    const request = {
      id: item.id,
      version: clean,
      onComplete: mode,
      keepArchive,
      // Only meaningful when replacing. Sent as a version id rather than a name
      // because names are not unique enough to delete a folder on.
      replaceVersionId: mode === 'replace' && replaceVersionId ? Number(replaceVersionId) : null,
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
                disabled={replaceOptions.length === 0}
                className="mt-0.5 accent-accent"
              />
              <span className="text-xs">
                <span className="text-text">Replace an installed version</span>
                <span className="block text-muted">
                  {replaceOptions.length === 0
                    ? 'No installed version to replace — this will be added as a new version.'
                    : 'The old build\u2019s folder is deleted once the new one is in place.'}
                </span>
              </span>
            </label>

            {/* Which build. One installed version needs no choice, but it is
                still named: this deletes a folder, and "Replace the installed
                version" never said which one that was. */}
            {mode === 'replace' && replaceOptions.length > 0 && (
              <div className="mt-2 ml-6">
                <label htmlFor="replace-version" className="block text-[11px] text-muted mb-1">
                  Version to replace
                </label>
                {soleReplaceTarget ? (
                  <p className="text-xs text-text">
                    <span className="font-mono">{soleReplaceTarget.version}</span>
                    <span className="block text-[11px] text-muted font-mono break-all">
                      {soleReplaceTarget.gamePath}
                    </span>
                  </p>
                ) : (
                  <>
                    <select
                      id="replace-version"
                      value={replaceVersionId}
                      onChange={(event) => { setReplaceVersionId(event.target.value); setError('') }}
                      className="w-full bg-tertiary border border-border rounded p-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                    >
                      <option value="">Choose a version&hellip;</option>
                      {replaceOptions.map((entry) => (
                        <option key={entry.versionId ?? entry.version} value={String(entry.versionId ?? '')}>
                          {entry.version}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-amber-400 mt-1">
                      This game has {replaceOptions.length} installed versions. Atlas will not
                      guess which to delete.
                    </p>
                  </>
                )}
              </div>
            )}
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
