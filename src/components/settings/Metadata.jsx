import { useState, useEffect } from 'react'

// Catalog of every metadata source Atlas knows how to pull art/previews from.
// Only f95 + steam are wired up today; add new entries here as they come online
// and they'll automatically appear in the ordering UI.
const AVAILABLE_SOURCES = [
  { id: 'f95', label: 'F95Zone' },
  { id: 'lewdcorner', label: 'LewdCorner' },
  { id: 'steam', label: 'Steam' },
]

const SOURCE_LABELS = Object.fromEntries(AVAILABLE_SOURCES.map((s) => [s.id, s.label]))
const labelFor = (id) => SOURCE_LABELS[id] || id

// The three places Atlas can pull a Steam game's header/hero/library-capsule/
// logo art from — see electron/scanners/steamscanner.js resolveLibraryAssets().
// "fastly" and "akamaihd" are the same flat CDN convention images served by
// two different CDN providers Valve uses; "getitems" is the Steam store's
// IStoreBrowseService API, which can occasionally lag behind what the CDNs
// are currently serving (e.g. right after a major content update).
const AVAILABLE_STEAM_ASSET_SOURCES = [
  { id: 'fastly', label: 'Fastly CDN' },
  { id: 'akamaihd', label: 'Akamai CDN' },
  { id: 'getitems', label: 'Steam GetItems API' },
]
const STEAM_ASSET_SOURCE_LABELS = Object.fromEntries(AVAILABLE_STEAM_ASSET_SOURCES.map((s) => [s.id, s.label]))
const labelForSteamAssetSource = (id) => STEAM_ASSET_SOURCE_LABELS[id] || id

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

const clampInteger = (value, fallback, min, max) => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

// sourceOrder is stored as a comma string ("f95,steam") for clean INI round-trips.
const parseOrder = (raw) => {
  const list = Array.isArray(raw)
    ? raw
    : String(raw || '').split(',')
  return list.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean)
}

// Reorderable list of enabled sources, with a dropdown to re-add any removed
// ones — shared by the metadata-source list and the Steam asset-source list
// below, which are otherwise identical in behavior.
const SourceOrderList = ({ order, availableSources, labelFor, onMove, onRemove, onAdd, emptyMessage }) => {
  const unused = availableSources.filter((s) => !order.includes(s.id))
  return (
    <>
      <ul className="flex flex-col gap-2 mb-3">
        {order.length === 0 && (
          <li className="text-xs opacity-50">{emptyMessage}</li>
        )}
        {order.map((id, index) => (
          <li
            key={id}
            className="flex items-center gap-2 bg-secondary border border-border rounded px-3 py-2"
          >
            <span className="w-5 text-center opacity-60">{index + 1}</span>
            <span className="flex-1">{labelFor(id)}</span>
            <button
              onClick={() => onMove(index, -1)}
              disabled={index === 0}
              className="w-7 h-7 flex items-center justify-center rounded bg-tertiary hover:bg-buttonHover disabled:opacity-30 disabled:cursor-not-allowed"
              title="Move up"
            >
              <i className="fas fa-chevron-up"></i>
            </button>
            <button
              onClick={() => onMove(index, 1)}
              disabled={index === order.length - 1}
              className="w-7 h-7 flex items-center justify-center rounded bg-tertiary hover:bg-buttonHover disabled:opacity-30 disabled:cursor-not-allowed"
              title="Move down"
            >
              <i className="fas fa-chevron-down"></i>
            </button>
            <button
              onClick={() => onRemove(id)}
              className="w-7 h-7 flex items-center justify-center rounded bg-tertiary hover:bg-danger"
              title="Disable source"
            >
              <i className="fas fa-times"></i>
            </button>
          </li>
        ))}
      </ul>

      {unused.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            className="w-48 bg-secondary border border-border text-text rounded p-1"
            value=""
            onChange={(e) => onAdd(e.target.value)}
          >
            <option value="" disabled>Add a source…</option>
            {unused.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
      )}
    </>
  )
}

const Metadata = () => {
  const [mediaStorageMode, setMediaStorageMode] = useState('stream')
  const [downloadPreviews, setDownloadPreviews] = useState(false)
  const [sourceOrder, setSourceOrder] = useState(['f95', 'lewdcorner', 'steam'])
  const [steamAssetSourceOrder, setSteamAssetSourceOrder] = useState(['fastly', 'akamaihd', 'getitems'])
  const [mediaDownloadConcurrency, setMediaDownloadConcurrency] = useState(3)
  const [mediaPerHostConcurrency, setMediaPerHostConcurrency] = useState(2)
  const [mediaRequestDelayMs, setMediaRequestDelayMs] = useState(100)

  useEffect(() => {
    window.electronAPI.getConfig().then((config) => {
      const metadataSettings = config.Metadata || {}
      setMediaStorageMode(metadataSettings.mediaStorageMode || 'stream')
      setDownloadPreviews(toBoolean(metadataSettings.downloadPreviews, false))
      const parsed = parseOrder(metadataSettings.sourceOrder)
      setSourceOrder(metadataSettings.sourceOrder === undefined || metadataSettings.sourceOrder === null
        ? ['f95', 'lewdcorner', 'steam']
        : parsed)
      const parsedSteamAssetOrder = parseOrder(metadataSettings.steamAssetSourceOrder)
      setSteamAssetSourceOrder(
        metadataSettings.steamAssetSourceOrder === undefined || metadataSettings.steamAssetSourceOrder === null
          ? ['fastly', 'akamaihd', 'getitems']
          : parsedSteamAssetOrder
      )
      const performanceSettings = config.Performance || {}
      setMediaDownloadConcurrency(clampInteger(performanceSettings.mediaDownloadConcurrency, 3, 1, 8))
      setMediaPerHostConcurrency(clampInteger(performanceSettings.mediaPerHostConcurrency, 2, 1, 5))
      setMediaRequestDelayMs(clampInteger(performanceSettings.mediaRequestDelayMs, 100, 0, 5000))
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

  const savePerformanceSettings = async (updatedSettings) => {
    try {
      const config = await window.electronAPI.getConfig()
      const newConfig = {
        ...config,
        Performance: { ...config.Performance, ...updatedSettings },
      }
      const result = await window.electronAPI.saveSettings(newConfig)
      if (result?.success === false) throw new Error(result.error || 'Save failed')
    } catch (err) {
      console.error('Failed to save performance settings:', err)
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

  const handlePerformanceNumberChange = (setter, key, fallback, min, max) => (event) => {
    const nextValue = clampInteger(event.target.value, fallback, min, max)
    setter(nextValue)
    savePerformanceSettings({ [key]: nextValue })
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

  const persistSteamAssetOrder = (next) => {
    setSteamAssetSourceOrder(next)
    saveSettings({ steamAssetSourceOrder: next.join(',') })
  }

  const moveSteamAssetSource = (index, delta) => {
    const next = [...steamAssetSourceOrder]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    persistSteamAssetOrder(next)
  }

  const removeSteamAssetSource = (id) => {
    persistSteamAssetOrder(steamAssetSourceOrder.filter((s) => s !== id))
  }

  const addSteamAssetSource = (id) => {
    if (!id || steamAssetSourceOrder.includes(id)) return
    persistSteamAssetOrder([...steamAssetSourceOrder, id])
  }

  const addSource = (id) => {
    if (!id || sourceOrder.includes(id)) return
    persistOrder([...sourceOrder, id])
  }

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

      <label className="block mb-2">Import Media Download Speed</label>
      <div className="flex items-center mb-2">
        <label className="flex-1">Simultaneous media jobs</label>
        <input
          type="number"
          min="1"
          max="8"
          className="w-24 bg-secondary border border-border text-text rounded p-1"
          value={mediaDownloadConcurrency}
          onChange={handlePerformanceNumberChange(setMediaDownloadConcurrency, 'mediaDownloadConcurrency', 3, 1, 8)}
        />
      </div>
      <div className="flex items-center mb-2">
        <label className="flex-1">Simultaneous jobs per host</label>
        <input
          type="number"
          min="1"
          max="5"
          className="w-24 bg-secondary border border-border text-text rounded p-1"
          value={mediaPerHostConcurrency}
          onChange={handlePerformanceNumberChange(setMediaPerHostConcurrency, 'mediaPerHostConcurrency', 2, 1, 5)}
        />
      </div>
      <div className="flex items-center mb-2">
        <label className="flex-1">Delay after each media request (ms)</label>
        <input
          type="number"
          min="0"
          max="5000"
          step="50"
          className="w-24 bg-secondary border border-border text-text rounded p-1"
          value={mediaRequestDelayMs}
          onChange={handlePerformanceNumberChange(setMediaRequestDelayMs, 'mediaRequestDelayMs', 100, 0, 5000)}
        />
      </div>
      <p className="text-xs opacity-50 mb-2">
        These apply to bulk import image downloads. Delay and per-host limits are checked between titles during a running image phase.
      </p>

      <div className="border-t border-text opacity-25 my-3"></div>

      <label className="block mb-1">Metadata Sources</label>
      <p className="text-xs opacity-50 mb-3">
        The order below sets which source provides banner images and previews —
        the topmost available source wins. Steam additionally supplies the
        hero image and logo on the game details page.
      </p>

      <SourceOrderList
        order={sourceOrder}
        availableSources={AVAILABLE_SOURCES}
        labelFor={labelFor}
        onMove={moveSource}
        onRemove={removeSource}
        onAdd={addSource}
        emptyMessage="No sources enabled — add one below."
      />

      <div className="border-t border-text opacity-25 my-3"></div>

      <label className="block mb-1">Steam Image Sources</label>
      <p className="text-xs opacity-50 mb-3">
        The order below sets which source Atlas tries first for a Steam
        game's header, hero, library capsule, and logo art — the topmost
        available source wins per image, falling through to the next if
        that source doesn't have it. The Fastly and Akamai CDNs serve the
        same images from two different providers; the Steam API can
        occasionally lag behind both right after a game ships new art.
      </p>

      <SourceOrderList
        order={steamAssetSourceOrder}
        availableSources={AVAILABLE_STEAM_ASSET_SOURCES}
        labelFor={labelForSteamAssetSource}
        onMove={moveSteamAssetSource}
        onRemove={removeSteamAssetSource}
        onAdd={addSteamAssetSource}
        emptyMessage="No image sources enabled — Steam art won't load. Add one below."
      />

      <div className="border-t border-text opacity-25 my-2"></div>
    </div>
  )
}

export default Metadata
