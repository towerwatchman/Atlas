import { useState, useEffect, useCallback } from 'react'
import SafeImage from '../../ui/SafeImage.jsx'
import SourceIcon from '../../ui/SourceIcon.jsx'
import { SHOW_LOCATION_BADGES } from '../../../assets/icons/sourceIcons'
import PreviewLightbox from '../page/PreviewLightbox.jsx'

// Mirrors CUSTOM_IMAGE_EXTENSIONS in electron/ipc/media.js. Duplicated across
// the process boundary on purpose: this one gives immediate feedback on a
// drop, the main-process one is the check that actually protects the library.
const IMAGE_EXTENSIONS = /\.(webp|png|jpe?g|gif|bmp|avif|jfif)$/i

export default function MediaTab({
  game, bannerUrl, bannerMediaStatus,
  validPreviewUrls, previewMediaStatus,
  importProgress,
  onDownloadBanner, onSelectCustomBanner, onDeleteBanner,
  onDownloadPreviews, onDeletePreviews, onDeleteCustomPreviews, onRefreshMetadata,
  onSaveSortOrder, onResetSortOrder,
  onMediaChanged,
}) {
  const [lightboxIndex, setLightboxIndex] = useState(null)
  const [previewOrder, setPreviewOrder] = useState(validPreviewUrls || [])
  const [dragIndex, setDragIndex] = useState(null)
  const [cardOpen, setCardOpen] = useState(false)
  const [target, setTarget] = useState('preview')
  const [uploads, setUploads] = useState([])
  const [dropError, setDropError] = useState('')
  const [urlInput, setUrlInput] = useState('')
  const [showUrlInput, setShowUrlInput] = useState(false)

  const uploadingEntries = uploads.filter((u) => u.status === 'uploading')
  const isUploading = uploadingEntries.length > 0
  const overallProgress = isUploading
    ? uploadingEntries.reduce((sum, u) => sum + (u.total ? u.progress / u.total : 0), 0) / uploadingEntries.length
    : 0

  useEffect(() => {
    setPreviewOrder(validPreviewUrls || [])
  }, [validPreviewUrls])

  useEffect(() => {
    setCardOpen(false)
  }, [game.record_id])

  useEffect(() => {
    if (lightboxIndex !== null) setCardOpen(false)
  }, [lightboxIndex])

  const handleMediaProgress = useCallback((data) => {
    if (!data?.id) return
    setUploads((prev) => {
      const exists = prev.find((u) => u.id === data.id)
      if (!exists && !data.done) {
        return [...prev, { id: data.id, name: data.url || data.id, progress: data.progress || 0, total: data.total || 0, status: 'uploading' }]
      }
      return prev.map((u) => {
        if (u.id !== data.id) return u
        if (data.error) return { ...u, status: 'error', error: data.error }
        if (data.done) return { ...u, progress: data.total || u.total, status: 'done', url: data.url }
        return { ...u, progress: data.progress, total: data.total }
      })
    })
  }, [])

  useEffect(() => {
    if (typeof window.electronAPI.onCustomMediaProgress !== 'function') return
    window.electronAPI.onCustomMediaProgress(handleMediaProgress)
    return () => {
      if (typeof window.electronAPI.removeCustomMediaProgressListener === 'function') {
        window.electronAPI.removeCustomMediaProgressListener(handleMediaProgress)
      }
    }
  }, [handleMediaProgress])

  useEffect(() => {
    const timers = []
    uploads.forEach((u) => {
      if (u.status === 'done' || u.status === 'error') {
        const timer = setTimeout(() => {
          setUploads((prev) => prev.filter((x) => x.id !== u.id))
        }, 2000)
        timers.push(timer)
      }
    })
    return () => timers.forEach(clearTimeout)
  }, [uploads])

  const handleDragStart = (e, index) => {
    setDragIndex(index)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e, index) => {
    e.preventDefault()
    if (dragIndex === null || dragIndex === index) return
    const next = [...previewOrder]
    const [moved] = next.splice(dragIndex, 1)
    next.splice(index, 0, moved)
    setPreviewOrder(next)
    setDragIndex(index)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    if (dragIndex === null) return
    const finalOrder = [...previewOrder]
    setDragIndex(null)
    setPreviewOrder(finalOrder)
    if (typeof onSaveSortOrder === 'function') {
      // reorder-reviews expects display URLs, not the enriched objects.
      onSaveSortOrder(finalOrder.map((p) => p?.url || p))
    }
  }

  const handleDragEnd = () => {
    setDragIndex(null)
  }

  const handleOpenImageFolder = async () => {
    try {
      const result = await window.electronAPI.openGameImageFolder?.(game.record_id)
      if (!result?.success) {
        alert(`Failed to open image folder: ${result?.error || 'Unknown error'}`)
      }
    } catch (err) {
      console.error('Error opening image folder:', err)
      alert(`Failed to open image folder: ${err.message || 'Unknown error'}`)
    }
  }

  const processFiles = async (files) => {
    if (!files || files.length === 0) return
    const items = files.map((f) => ({ id: crypto.randomUUID(), srcPath: f, name: f.split(/[\\/]/).pop() }))
    setUploads((prev) => [...prev, ...items.map((u) => ({ ...u, progress: 0, total: items.length, status: 'uploading' }))])
    try {
      if (target === 'banner') {
        const first = items[0]
        if (!first) return
        await window.electronAPI.convertAndSaveBanner(game.record_id, first.srcPath, { progressId: first.id })
        setUploads((prev) => prev.map((u) => u.id === first.id ? { ...u, status: 'done' } : u))
      } else {
        const result = await window.electronAPI.addCustomPreviews(game.record_id, items)
        result?.forEach((r) => {
          if (r?.url) {
            setUploads((prev) => prev.map((u) => u.id === r.id ? { ...u, url: r.url, status: 'done' } : u))
          }
        })
      }
      onMediaChanged?.()
    } catch (err) {
      setUploads((prev) => prev.map((u) => {
        if (items.some((i) => i.id === u.id)) return { ...u, status: 'error', error: err.message }
        return u
      }))
    }
  }

  const handleFileSelect = async () => {
    try {
      const paths = await window.electronAPI.selectFiles({ images: true })
      if (!paths || paths.length === 0) return
      await processFiles(paths)
    } catch (err) {
      console.error('File select failed:', err)
    }
  }

  const handleDropZone = (e) => {
    e.preventDefault()
    e.stopPropagation()
    const files = Array.from(e.dataTransfer.files || [])
    const paths = []
    const rejected = []
    for (const f of files) {
      const resolved = (typeof window.electronAPI.getDroppedFilePath === 'function'
        ? window.electronAPI.getDroppedFilePath(f)
        : '') || f.path || ''
      if (!resolved) continue
      // A dropped path skips the file dialog entirely, so this is the only
      // filter on the way in. The main process re-checks before copying; this
      // is here to say so immediately rather than after a round-trip.
      if (!IMAGE_EXTENSIONS.test(resolved)) {
        rejected.push(resolved.split(/[\\/]/).pop())
        continue
      }
      paths.push(resolved)
    }
    setDropError(rejected.length > 0 ? `Not an image: ${rejected.join(', ')}` : '')
    processFiles(paths)
  }

  const handleUrlFetch = async () => {
    const url = urlInput.trim()
    if (!url) return
    const id = crypto.randomUUID()
    const name = url.split('/').pop()?.split('?')[0] || url
    setUploads((prev) => [...prev, { id, name, progress: 0, total: 0, status: 'uploading' }])
    setUrlInput('')
    try {
      if (target === 'banner') {
        const result = await window.electronAPI.convertAndSaveBannerFromUrl(game.record_id, id, url)
        setUploads((prev) => prev.map((u) => u.id === id ? { ...u, status: 'done', url: result?.url } : u))
      } else {
        const result = await window.electronAPI.addCustomPreviewFromUrl(game.record_id, id, url)
        setUploads((prev) => prev.map((u) => u.id === id ? { ...u, status: 'done', url: result?.url } : u))
      }
      onMediaChanged?.()
    } catch (err) {
      setUploads((prev) => prev.map((u) => u.id === id ? { ...u, status: 'error', error: err.message } : u))
    }
  }

  return (
    <div className="flex flex-col flex-grow gap-4 relative">
      {importProgress.text && (
        <div className="absolute bottom-[60px] left-1/2 transform -translate-x-1/2 w-[800px] bg-primary flex items-center justify-center p-2 z-[1500] border border-border opacity-95">
          <div className="flex items-center w-[800px]">
            <span className="w-[450px] text-[10px] text-text">{importProgress.text}</span>
            <div className="relative w-[300px]">
              <div className="h-[15px] bg-progressBackground rounded overflow-hidden">
                <div className="h-full bg-progressForeground" style={{ width: `${(importProgress.progress / (importProgress.total || 1)) * 100}%` }}></div>
              </div>
              <span className="absolute inset-0 flex items-center justify-center text-[10px] text-text">
                Image {importProgress.progress}/{importProgress.total}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          onClick={handleOpenImageFolder}
          disabled={!game?.record_id}
          className="px-4 py-1 bg-button hover:bg-buttonHover rounded disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Open Image Folder
        </button>
        <button onClick={onRefreshMetadata} className="px-4 py-1 bg-button hover:bg-buttonHover rounded">Refresh Media Links</button>
      </div>

      <div className="flex flex-col shrink-0 h-[320px]">
        <label>Banner Image</label>
        <p className="text-xs opacity-60 mb-1">{bannerMediaStatus}</p>
        {bannerUrl ? (
          <div className="flex flex-col flex-grow min-h-0">
            <SafeImage
              src={bannerUrl}
              alt="Banner"
              className="w-full flex-1 min-h-0 object-contain rounded"
              fallbackLabel="Banner unavailable"
              onError={() => console.error('Failed to load banner:', bannerUrl)}
            />
            <div className="flex space-x-2 mt-2 shrink-0">
              <button onClick={onDownloadBanner} className="px-4 py-1 bg-button hover:bg-buttonHover rounded">Download Banner</button>
              <button onClick={onSelectCustomBanner} className="px-4 py-1 bg-button hover:bg-buttonHover rounded">Select Custom Banner</button>
              <button onClick={onDeleteBanner} className="px-4 py-1 bg-danger text-white rounded hover:bg-dangerHover">Delete Downloaded Banner</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col flex-grow min-h-0 items-start justify-end">
            <div className="flex space-x-2">
              <button onClick={onDownloadBanner} className="px-4 py-1 bg-button hover:bg-buttonHover rounded">Download Banner</button>
              <button onClick={onSelectCustomBanner} className="px-4 py-1 bg-button hover:bg-buttonHover rounded">Select Custom Banner</button>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col flex-1 min-h-0">
        <label>Preview Images</label>
        <p className="text-xs opacity-60 mb-1">{previewMediaStatus}</p>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div
            className="grid gap-2 p-2"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}
          >
            {Array.isArray(previewOrder) && previewOrder.length > 0 ? (
              previewOrder.map((p, index) => {
                const url = p?.url || p
                const location = p?.location
                const source = p?.source
                return (
                  <div key={url || p?.identifier || index} className="relative">
                    <SafeImage
                      src={url}
                      alt={`Preview ${index + 1}`}
                      className="w-full aspect-video object-contain bg-primary rounded cursor-move"
                      style={{ opacity: dragIndex === index ? 0.5 : 1 }}
                      fallbackLabel="Preview unavailable"
                      draggable
                      onDragStart={(e) => handleDragStart(e, index)}
                      onDragOver={(e) => handleDragOver(e, index)}
                      onDrop={handleDrop}
                      onDragEnd={handleDragEnd}
                      onClick={() => setLightboxIndex(index)}
                    />
                    {SHOW_LOCATION_BADGES.remote && location === 'remote' && (
                      <span
                        title="Streaming from web"
                        className="absolute bottom-1 right-1 flex items-center justify-center w-5 h-5 rounded-full bg-black/35 text-white leading-none"
                      >
                        <i className="fas fa-cloud text-xs" aria-hidden="true"></i>
                      </span>
                    )}
                    {SHOW_LOCATION_BADGES.local && location === 'local' && (
                      <span
                        title="Downloaded"
                        className="absolute bottom-1 right-1 flex items-center justify-center w-5 h-5 rounded-full bg-green-400 text-white leading-none"
                      >
                        <i className="fas fa-check text-xs" aria-hidden="true"></i>
                      </span>
                    )}
                    {SHOW_LOCATION_BADGES.custom && location === 'custom' && (
                      <span
                        title="Uploaded"
                        className="absolute bottom-1 right-1 flex items-center justify-center w-5 h-5 rounded-full bg-blue-500 text-white leading-none"
                      >
                        <i className="fas fa-user text-xs" aria-hidden="true"></i>
                      </span>
                    )}
                    {source && (
                      <span
                        title={source}
                        className="absolute top-1 right-1 flex items-center justify-center h-5 max-w-[4rem] px-1 rounded bg-black/65"
                      >
                        <SourceIcon source={source} size={14} />
                      </span>
                    )}
                  </div>
                )
              })
            ) : (
              <p>No previews available</p>
            )}
          </div>
        </div>
        <div className="flex space-x-2 mt-2">
          <button onClick={onResetSortOrder} className="px-4 py-1 bg-button hover:bg-buttonHover rounded">Reset Sort Order</button>
          <button onClick={onDownloadPreviews} className="px-4 py-1 bg-button hover:bg-buttonHover rounded">Download All Previews</button>
          {Array.isArray(validPreviewUrls) && validPreviewUrls.length > 0 && (
            <button onClick={onDeletePreviews} className="px-4 py-1 bg-danger text-white rounded hover:bg-dangerHover">Delete Downloaded Previews</button>
          )}
          <button onClick={onDeleteCustomPreviews} className="px-4 py-1 bg-danger text-white rounded hover:bg-dangerHover">Delete Custom Previews</button>
        </div>
      </div>

      {/* FAB */}
      {lightboxIndex === null && (
        <button
          onClick={() => setCardOpen((v) => !v)}
          className={`fixed bottom-20 right-4 w-14 h-14 shadow-lg flex items-center justify-center z-[1600] bg-accent hover:bg-accentHover fab-morph ${
            cardOpen ? 'is-circle rounded-[50%]' : 'rounded-xl'
          } ${isUploading ? 'ring-2 ring-accent/40' : ''}`}
          title={isUploading ? 'Uploading…' : 'Add media'}
        >
          <i className="fab-icon-default fas fa-arrow-up-from-bracket text-white text-lg"></i>
          <i className="fab-icon-circle fas fa-xmark text-white text-lg"></i>

          {isUploading && (
            <svg viewBox="0 0 50 50" className="w-6 h-6 text-white">
              <circle
                cx="25" cy="25" r="22"
                fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="3"
              />
              <circle
                cx="25" cy="25" r="22"
                fill="none" stroke="currentColor" strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={138.2}
                strokeDashoffset={138.2 * (1 - overallProgress)}
                transform="rotate(-90 25 25)"
                className="transition-[stroke-dashoffset] duration-300 ease-out"
              />
              <text x="25" y="28" textAnchor="middle" fill="currentColor" fontSize="11" fontWeight="600">
                {Math.round(overallProgress * 100)}
              </text>
            </svg>
          )}
        </button>
      )}

      {/* Upload card */}
      {cardOpen && lightboxIndex === null && (
        <div
          className="fixed bottom-[148px] right-4 w-[360px] bg-secondary border border-border rounded-md shadow-xl z-[1600] flex flex-col max-h-[500px]"
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDropZone}
        >
          <div className="p-3 border-b border-border flex items-center justify-between">
            <span className="text-sm font-semibold text-text">Add Media</span>
            <div className="flex rounded overflow-hidden border border-border">
              <button
                onClick={() => setTarget('preview')}
                className={`px-3 py-1 text-xs ${target === 'preview' ? 'bg-accent text-white' : 'bg-button text-text'}`}
              >
                Preview
              </button>
              <button
                onClick={() => setTarget('banner')}
                className={`px-3 py-1 text-xs ${target === 'banner' ? 'bg-accent text-white' : 'bg-button text-text'}`}
              >
                Banner
              </button>
            </div>
          </div>

          <div className="p-3 space-y-3">
            <div
              role="button"
              tabIndex={0}
              onClick={handleFileSelect}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleFileSelect()
                }
              }}
              onDragOver={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                handleDropZone(e)
              }}
              className="flex flex-col items-center justify-center gap-1 p-4 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-muted transition-colors"
            >
              <i className="fas fa-cloud-upload-alt text-lg text-muted"></i>
              <span className="text-xs text-text text-center">
                Drag here to upload or{' '}
                <span className="text-accent underline underline-offset-2">browse</span>{' '}
              </span>
              <span className="text-[10px] text-muted">
                {target === 'preview' ? 'Images, GIFs, WebP, MP4' : 'Banner image'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowUrlInput((v) => !v)}
                className="px-3 py-1 bg-button hover:bg-buttonHover rounded text-xs text-text"
              >
                Paste URL
              </button>
              {showUrlInput && (
                <div className="flex-1 flex gap-2">
                  <input
                    type="text"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="https://..."
                    className="flex-1 bg-primary border border-border rounded px-2 py-1 text-xs text-text"
                    onKeyDown={(e) => e.key === 'Enter' && handleUrlFetch()}
                  />
                  <button
                    onClick={handleUrlFetch}
                    className="px-3 py-1 bg-accent text-white rounded text-xs hover:bg-accentHover"
                  >
                    Fetch
                  </button>
                </div>
              )}
            </div>

            {dropError && (
              <p className="text-xs text-danger" role="alert">{dropError}</p>
            )}

            {uploads.length > 0 && (
              <div className="space-y-2 max-h-[200px] overflow-y-auto">
                {uploads.map((u) => (
                  <div key={u.id} className="bg-primary border border-border rounded p-2">
                    <div className="flex items-center justify-between text-xs text-text mb-1">
                      <span className="truncate flex-1">{u.name}</span>
                      <span className="ml-2 shrink-0">
                        {u.status === 'done' && 'Done'}
                        {u.status === 'error' && 'Error'}
                        {u.status === 'uploading' && `${u.progress}/${u.total || '?'}`}
                      </span>
                    </div>
                    {(u.status === 'uploading' || u.status === 'done') && (
                      <div className="h-2 bg-progressBackground rounded overflow-hidden">
                        <div
                          className={`h-full ${u.status === 'error' ? 'bg-danger' : 'bg-progressForeground'}`}
                          style={{ width: `${u.total ? (u.progress / u.total) * 100 : 0}%` }}
                        ></div>
                      </div>
                    )}
                    {u.error && <p className="text-[10px] text-danger mt-1">{u.error}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <PreviewLightbox
        previews={validPreviewUrls || []}
        lightboxIndex={lightboxIndex}
        onClose={() => setLightboxIndex(null)}
        onPrev={() => setLightboxIndex((i) => (i === null ? i : (i - 1 + validPreviewUrls.length) % validPreviewUrls.length))}
        onNext={() => setLightboxIndex((i) => (i === null ? i : (i + 1) % validPreviewUrls.length))}
      />
    </div>
  )
}
