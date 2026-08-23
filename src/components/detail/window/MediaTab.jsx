import { useState, useEffect } from 'react'
import SafeImage from '../../ui/SafeImage.jsx'
import PreviewLightbox from '../page/PreviewLightbox.jsx'

export default function MediaTab({
  game, bannerUrl, bannerMediaStatus,
  validPreviewUrls, previewMediaStatus,
  importProgress,
  onDownloadBanner, onSelectCustomBanner, onDeleteBanner,
  onDownloadPreviews, onDeletePreviews, onRefreshMetadata,
  onSaveSortOrder, onResetSortOrder,
}) {
  const [lightboxIndex, setLightboxIndex] = useState(null)
  const [previewOrder, setPreviewOrder] = useState(validPreviewUrls || [])
  const [dragIndex, setDragIndex] = useState(null)

  useEffect(() => {
    console.log('[MediaTab] validPreviewUrls changed (%d):', validPreviewUrls?.length, validPreviewUrls)
    setPreviewOrder(validPreviewUrls || [])
  }, [validPreviewUrls])

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
    console.log('[MediaTab.handleDrop] local reorder (%d items), persisting...', finalOrder.length, finalOrder)
    setDragIndex(null)
    setPreviewOrder(finalOrder)
    if (typeof onSaveSortOrder === 'function') {
      onSaveSortOrder(finalOrder)
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

      <div className="flex justify-end">
        <button
          onClick={handleOpenImageFolder}
          disabled={!game?.record_id}
          className="px-4 py-1 bg-button hover:bg-buttonHover rounded disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Open Image Folder
        </button>
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
              previewOrder.map((url, index) => (
                <SafeImage
                  key={url}
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
              ))
            ) : (
              <p>No previews available</p>
            )}
          </div>
        </div>
        <div className="flex space-x-2 mt-2">
          <button onClick={onRefreshMetadata} className="px-4 py-1 bg-button hover:bg-buttonHover rounded">Refresh Media Links</button>
          <button onClick={onDownloadPreviews} className="px-4 py-1 bg-button hover:bg-buttonHover rounded">Download All Previews</button>
          {Array.isArray(validPreviewUrls) && validPreviewUrls.length > 0 && (
            <button onClick={onDeletePreviews} className="px-4 py-1 bg-danger text-white rounded hover:bg-dangerHover">Delete Downloaded Previews</button>
          )}
          <button onClick={onResetSortOrder} className="px-4 py-1 bg-button hover:bg-buttonHover rounded">Reset Sort Order</button>
        </div>
      </div>
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
