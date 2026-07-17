import { useEffect, useState } from 'react'

// Modal shown by the two refresh entry points:
//   - the per-game "Refresh Media" button on the game details page (scope='game')
//   - the nav "Updates" button, which refreshes the whole library (scope='library')
//
// The user chooses whether to fill only MISSING data or re-fetch ALL data
// (overwriting). Whether images are downloaded to disk vs left streamed is NOT a
// choice here — it follows the saved Settings > Metadata "media storage" mode,
// which we surface as a read-only note so the behavior is transparent.
export default function RefreshMediaModal({
  open,
  scope = 'game',       // 'game' | 'library'
  title,
  busy = false,
  progress = null,      // { text, processed, total } for library scope
  onConfirm,            // (mode: 'missing' | 'all') => void
  onClose,
}) {
  const [mode, setMode] = useState('missing')
  const [storageMode, setStorageMode] = useState('stream')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      try {
        const config = await window.electronAPI.getConfig?.()
        const m = config?.Metadata?.mediaStorageMode === 'download' ? 'download' : 'stream'
        if (!cancelled) setStorageMode(m)
      } catch {
        if (!cancelled) setStorageMode('stream')
      }
    })()
    return () => { cancelled = true }
  }, [open])

  if (!open) return null

  const heading = title || (scope === 'library' ? 'Refresh Library Media' : 'Refresh Media')
  const imagesNote =
    storageMode === 'download'
      ? 'Images will be downloaded to local storage (per your Settings).'
      : 'Images will be refreshed as streamed links, not downloaded (per your Settings).'

  const pct = progress && progress.total
    ? Math.min(100, Math.round((progress.processed / progress.total) * 100))
    : null

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: 'rgba(8,10,15,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={() => { if (!busy) onClose?.() }}
    >
      <div
        className="bg-secondary border border-border rounded shadow-xl"
        style={{ width: 440, maxWidth: '92vw', padding: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-1">{heading}</h2>
        <p className="text-sm mb-4" style={{ color: 'var(--color-muted)' }}>
          {scope === 'library'
            ? 'Re-fetch metadata and artwork for every game in your library.'
            : 'Re-fetch metadata and artwork for this game.'}
        </p>

        {!busy && (
          <div className="flex flex-col gap-2 mb-4">
            <label className="flex items-start gap-3 p-3 border border-border rounded cursor-pointer hover:bg-primary">
              <input
                type="radio"
                name="refresh-mode"
                checked={mode === 'missing'}
                onChange={() => setMode('missing')}
                className="mt-1"
              />
              <span>
                <span className="block font-medium">Refresh missing data only</span>
                <span className="block text-xs" style={{ color: 'var(--color-muted)' }}>
                  Fill in empty fields and artwork. Existing data is left untouched.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 p-3 border border-border rounded cursor-pointer hover:bg-primary">
              <input
                type="radio"
                name="refresh-mode"
                checked={mode === 'all'}
                onChange={() => setMode('all')}
                className="mt-1"
              />
              <span>
                <span className="block font-medium">Refresh all data</span>
                <span className="block text-xs" style={{ color: 'var(--color-muted)' }}>
                  Re-fetch everything and overwrite existing metadata and artwork.
                </span>
              </span>
            </label>
          </div>
        )}

        <div
          className="flex items-center gap-2 text-xs mb-4 p-2 rounded"
          style={{ background: 'var(--color-primary)', color: 'var(--color-muted)' }}
        >
          <i className={`fas ${storageMode === 'download' ? 'fa-hdd' : 'fa-cloud'}`}></i>
          <span>{imagesNote}</span>
        </div>

        {busy && (
          <div className="mb-4">
            <div className="text-sm mb-2">{progress?.text || 'Working…'}</div>
            {pct !== null && (
              <div className="w-full h-2 rounded overflow-hidden" style={{ background: 'var(--color-primary)' }}>
                <div className="h-full" style={{ width: `${pct}%`, background: 'var(--color-detail-accent, #4a9eff)', transition: 'width 0.2s' }} />
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={() => onClose?.()}
            disabled={busy}
            className="px-4 py-2 border border-border rounded hover:bg-primary disabled:opacity-50"
          >
            {busy ? 'Close' : 'Cancel'}
          </button>
          {!busy && (
            <button
              onClick={() => onConfirm?.(mode)}
              className="px-4 py-2 bg-button hover:bg-buttonHover rounded"
            >
              {scope === 'library' ? 'Refresh Library' : 'Refresh'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
