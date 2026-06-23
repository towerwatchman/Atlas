import { useState } from 'react'
import SafeImage from '../../ui/SafeImage.jsx'
import PreviewLightbox from '../page/PreviewLightbox.jsx'

export default function MediaTab({
  game, bannerUrl, bannerMediaStatus,
  validPreviewUrls, previewMediaStatus, previewHeight,
  importProgress, setPreviewUrls,
  onDownloadBanner, onSelectCustomBanner,
  onDownloadPreviews, onRefreshMetadata,
}) {
  const [lightboxIndex, setLightboxIndex] = useState(null)

  const handleDeleteBanner = async () => {
    try {
      await window.electronAPI.deleteBanner(game.record_id)
      const updatedGame = await window.electronAPI.getGame(game.record_id)
      // Banner URL update is handled by parent via onRefreshMetadata pattern
      // but we can also just notify via a simple reload
      window.location.reload()
    } catch (err) {
      console.error('Error deleting banner:', err)
    }
  }

  const handleDeletePreviews = async () => {
    try {
      await window.electronAPI.deletePreviews(game.record_id)
      const urls = await window.electronAPI.getPreviews(game.record_id)
      setPreviewUrls(urls || [])
    } catch (err) {
      console.error('Error deleting previews:', err)
    }
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
          className="px-4 py-1 bg-tertiary hover:bg-buttonHover rounded disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Open Image Folder
        </button>
      </div>

      <div className="flex flex-col h-[414px]">
        <label>Banner Image</label>
        <p className="text-xs opacity-60 mb-1">{bannerMediaStatus}</p>
        {bannerUrl ? (
          <div className="flex flex-col flex-grow">
            <SafeImage
              src={bannerUrl}
              alt="Banner"
              className="w-full h-[350px] object-contain rounded"
              fallbackLabel="Banner unavailable"
              onError={() => console.error('Failed to load banner:', bannerUrl)}
            />
            <div className="flex space-x-2 mt-2">
              <button onClick={onDownloadBanner} className="px-4 py-1 bg-tertiary hover:bg-buttonHover rounded">Download Banner</button>
              <button onClick={onSelectCustomBanner} className="px-4 py-1 bg-tertiary hover:bg-buttonHover rounded">Select Custom Banner</button>
              <button onClick={handleDeleteBanner} className="px-4 py-1 bg-danger text-white rounded hover:bg-dangerHover">Delete Downloaded Banner</button>
            </div>
          </div>
        ) : (
          <div className="flex space-x-2">
            <button onClick={onDownloadBanner} className="px-4 py-1 bg-tertiary hover:bg-buttonHover rounded" style={{ marginTop: '350px' }}>Download Banner</button>
            <button onClick={onSelectCustomBanner} className="px-4 py-1 bg-tertiary hover:bg-buttonHover rounded" style={{ marginTop: '350px' }}>Select Custom Banner</button>
          </div>
        )}
      </div>

      <div className="flex flex-col flex-grow">
        <label>Preview Images</label>
        <p className="text-xs opacity-60 mb-1">{previewMediaStatus}</p>
        <div style={{ height: `${previewHeight}px`, overflowY: 'auto' }}>
          <div
            className="grid gap-2 p-2"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
          >
            {Array.isArray(validPreviewUrls) && validPreviewUrls.length > 0 ? (
              validPreviewUrls.map((url, index) => (
                <SafeImage
                  key={index}
                  src={url}
                  alt={`Preview ${index + 1}`}
                  className="w-full aspect-video object-contain bg-primary rounded cursor-pointer"
                  fallbackLabel="Preview unavailable"
                  onClick={() => setLightboxIndex(index)}
                />
              ))
            ) : (
              <p>No previews available</p>
            )}
          </div>
        </div>
        <div className="flex space-x-2 mt-2">
          <button onClick={onRefreshMetadata} className="px-4 py-1 bg-tertiary hover:bg-buttonHover rounded">Refresh Media Links</button>
          <button onClick={onDownloadPreviews} className="px-4 py-1 bg-tertiary hover:bg-buttonHover rounded">Download All Previews</button>
          {Array.isArray(validPreviewUrls) && validPreviewUrls.length > 0 && (
            <button onClick={handleDeletePreviews} className="px-4 py-1 bg-danger text-white rounded hover:bg-dangerHover">Delete Downloaded Previews</button>
          )}
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
