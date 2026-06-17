import { useState, useEffect } from 'react'

// Catalog of every metadata source Atlas knows how to pull art/previews from.
// Only f95 + steam are wired up today; add new entries here as they come online
// and they'll automatically appear in the ordering UI.
const AVAILABLE_SOURCES = [
  { id: 'f95', label: 'F95Zone' },
  { id: 'steam', label: 'Steam' },
]

const SOURCE_LABELS = Object.fromEntries(AVAILABLE_SOURCES.map((s) => [s.id, s.label]))
const labelFor = (id) => SOURCE_LABELS[id] || id

const toBoolean = (value, fallback = false) => {
  if (value === true || value === false) return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  return fallback
}

// sourceOrder is stored as a comma string ("f95,steam") for clean INI round-trips.
const parseOrder = (raw) => {
  const list = Array.isArray(raw)
    ? raw
    : String(raw || '').split(',')
  return list.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean)
}

const Metadata = () => {
  const [mediaStorageMode, setMediaStorageMode] = useState('stream')
  const [downloadPreviews, setDownloadPreviews] = useState(false)
  const [sourceOrder, setSourceOrder] = useState(['f95', 'steam'])

  useEffect(() => {
    window.electronAPI.getConfig().then((config) => {
      const metadataSettings = config.Metadata || {}
      setMediaStorageMode(metadataSettings.mediaStorageMode || 'stream')
      setDownloadPreviews(toBoolean(metadataSettings.downloadPreviews, false))
      const parsed = parseOrder(metadataSettings.sourceOrder)
      setSourceOrder(parsed.length ? parsed : ['f95', 'steam'])
    })
  }, [])

  const saveSettings = async (updatedSettings) => {
    try {
      const config = await window.electronAPI.getConfig()
      const newConfig = {
        ...config,
        Metadata: { ...config.Metadata, ...updatedSettings },
      }
      const result = await window.electronAPI.saveSettings(newConfig)
      if (result?.success === false) throw new Error(result.error || 'Save failed')
    } catch (err) {
      console.error('Failed to save metadata settings:', err)
    }
  }

  const handleMediaStorageModeChange = (e) => {
    setMediaStorageMode(e.target.value)
    saveSettings({ mediaStorageMode: e.target.value })
  }

  const handleDownloadPreviewsChange = (e) => {
    const nextValue = e.target.checked
    setDownloadPreviews(nextValue)
    saveSettings({ downloadPreviews: nextValue })
  }

  const persistOrder = (next) => {
    setSourceOrder(next)
    saveSettings({ sourceOrder: next.join(',') })
  }

  const moveSource = (index, delta) => {
    const next = [...sourceOrder]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    persistOrder(next)
  }

  const removeSource = (id) => {
    persistOrder(sourceOrder.filter((s) => s !== id))
  }

  const addSource = (id) => {
    if (!id || sourceOrder.includes(id)) return
    persistOrder([...sourceOrder, id])
  }

  const unusedSources = AVAILABLE_SOURCES.filter((s) => !sourceOrder.includes(s.id))

  return (
    <div className="p-5 text-text">
      <div className="flex items-center mb-2">
        <label className="flex-1">Media Storage</label>
        <select
          className="w-64 bg-secondary border border-border text-text rounded p-1"
          value={mediaStorageMode}
          onChange={handleMediaStorageModeChange}
        >
          <option value="stream">Stream media from the web</option>
          <option value="download">Download media and store locally</option>
        </select>
      </div>
      <p className="text-xs opacity-50 mb-2">
        Streaming uses less disk space. Downloading saves durable banner and
        preview files in Atlas data storage.
      </p>

      <div className="flex items-center mb-2">
        <label className="flex-1">Download Image Previews</label>
        <input
          type="checkbox"
          className="mr-5"
          checked={downloadPreviews}
          onChange={handleDownloadPreviewsChange}
        />
      </div>
      <p className="text-xs opacity-50 mb-2">
        Uses this as the default for downloading preview images during imports.
      </p>

      <div className="border-t border-text opacity-25 my-3"></div>

      <label className="block mb-1">Metadata Sources</label>
      <p className="text-xs opacity-50 mb-3">
        The order below sets which source provides banner images and previews —
        the topmost available source wins. Steam additionally supplies the
        hero image and logo on the game details page.
      </p>

      <ul className="flex flex-col gap-2 mb-3">
        {sourceOrder.length === 0 && (
          <li className="text-xs opacity-50">No sources enabled — add one below.</li>
        )}
        {sourceOrder.map((id, index) => (
          <li
            key={id}
            className="flex items-center gap-2 bg-secondary border border-border rounded px-3 py-2"
          >
            <span className="w-5 text-center opacity-60">{index + 1}</span>
            <span className="flex-1">{labelFor(id)}</span>
            <button
              onClick={() => moveSource(index, -1)}
              disabled={index === 0}
              className="w-7 h-7 flex items-center justify-center rounded bg-tertiary hover:bg-buttonHover disabled:opacity-30 disabled:cursor-not-allowed"
              title="Move up"
            >
              <i className="fas fa-chevron-up"></i>
            </button>
            <button
              onClick={() => moveSource(index, 1)}
              disabled={index === sourceOrder.length - 1}
              className="w-7 h-7 flex items-center justify-center rounded bg-tertiary hover:bg-buttonHover disabled:opacity-30 disabled:cursor-not-allowed"
              title="Move down"
            >
              <i className="fas fa-chevron-down"></i>
            </button>
            <button
              onClick={() => removeSource(id)}
              className="w-7 h-7 flex items-center justify-center rounded bg-tertiary hover:bg-danger"
              title="Disable source"
            >
              <i className="fas fa-times"></i>
            </button>
          </li>
        ))}
      </ul>

      {unusedSources.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            className="w-48 bg-secondary border border-border text-text rounded p-1"
            value=""
            onChange={(e) => addSource(e.target.value)}
          >
            <option value="" disabled>Add a source…</option>
            {unusedSources.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
      )}

      <div className="border-t border-text opacity-25 my-2"></div>
    </div>
  )
}

export default Metadata
