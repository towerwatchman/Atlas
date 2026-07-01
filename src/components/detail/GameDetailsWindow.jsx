import { useState, useEffect, useRef } from 'react'
import TitleBar from './window/TitleBar.jsx'
import RecordTab from './window/RecordTab.jsx'
import VersionsTab from './window/VersionsTab.jsx'
import MediaTab from './window/MediaTab.jsx'
import MappingsTab from './window/MappingsTab.jsx'
import { sanitizePercentText } from '../../utils/formatPercent.js'
import { formatVersionDate } from '../../utils/formatVersionDate.js'
import WindowBorderFrame from '../ui/WindowBorderFrame.jsx'
import { toMediaSrc } from '../../utils/mediaSrc.js'

const isRemoteMediaUrl = (url) => /^https?:\/\//i.test(String(url || ''))
const firstMediaUrl = (value) => Array.isArray(value) ? value[0] || '' : value || ''
const formatBytes = (bytes) => {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value < 0) return 'Unknown'
  const gb = value / (1024 * 1024 * 1024)
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 1 : 2)} GB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

const EMPTY_FORM = {
  title: '', mappings: '', platform: '', engine: '', developer: '',
  publisher: '', release_date: '', status: '', tags: '', description: '',
  category: '', latest_version: '', censored: '', language: '',
  translations: '', genre: '', voice: '', rating: '',
}

const EMPTY_VERSION = {
  game_version: '', game_path: '', executable: '',
  last_played: '', playtime: '', version_size: '', date_added: '',
  last_played_title: '', date_added_title: '',
}

const sanitizeProgressState = (progress = {}) => ({
  ...progress,
  text: sanitizePercentText(progress.text),
})

const formatRecordDateInput = (value) => {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  if (/^\d+$/.test(raw)) {
    const date = new Date(parseInt(raw, 10) * 1000)
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().split('T')[0]
  }
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().split('T')[0]
}

function gameToFormData(g) {
  const mapperNames = []
  if (g.f95_id) mapperNames.push('F95Zone')
  if (g.atlas_id) mapperNames.push('Atlas')
  if (g.steam_id) mapperNames.push('Steam')
  if (g.lc_id || g.lcId || g.lewdCornerId) mapperNames.push('LewdCorner')
  return {
    title: g.title || '',
    mappings: mapperNames.join(', '),
    platform: g.os || '',
    engine: g.engine || '',
    developer: g.creator || '',
    publisher: g.publisher || '',
    release_date: formatRecordDateInput(g.release_date),
    status: g.status || '',
    tags: (g.tags || g.f95_tags || '').replace(/,/g, ' , '),
    description: g.overview || '',
    category: g.category || '',
    latest_version: g.latestVersion || '',
    censored: g.censored || '',
    language: g.language || '',
    translations: g.translations || '',
    genre: g.genre || '',
    voice: g.voice || '',
    rating: g.rating || '',
  }
}

function versionToData(v) {
  const hasSize = v.folder_size !== undefined && v.folder_size !== null && v.folder_size !== ''
  const lastPlayed = formatVersionDate(v.last_played, 'Never')
  const dateAdded = formatVersionDate(v.date_added, 'Unknown')
  return {
    game_version: v.version || '',
    game_path: v.game_path || '',
    executable: v.exec_path || '',
    last_played: lastPlayed.display,
    last_played_title: lastPlayed.absolute || lastPlayed.display,
    playtime: v.version_playtime?.toString() || '',
    version_size: v.isInstalled === false
      ? 'Missing path'
      : hasSize
        ? formatBytes(v.folder_size)
        : 'Unknown',
    date_added: dateAdded.display,
    date_added_title: dateAdded.absolute || dateAdded.display,
  }
}

const GameDetailWindow = () => {
  const [game, setGame] = useState(null)
  const [versions, setVersions] = useState([])
  const [selectedVersion, setSelectedVersion] = useState(null)
  const [formData, setFormData] = useState(EMPTY_FORM)
  const [versionData, setVersionData] = useState(EMPTY_VERSION)
  const [bannerUrl, setBannerUrl] = useState('')
  const [previewUrls, setPreviewUrls] = useState([])
  const [validPreviewUrls, setValidPreviewUrls] = useState([])
  const [previewHeight, setPreviewHeight] = useState(250)
  const [importProgress, setImportProgress] = useState({ text: '', progress: 0, total: 0 })
  const [isMaximized, setIsMaximized] = useState(false)
  const [activeTab, setActiveTab] = useState('Record')
  const [searchResults, setSearchResults] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [dataReceived, setDataReceived] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const dataHandledRef = useRef(false)
  const retryLoadRef = useRef(null)
  const sizeRefreshKeyRef = useRef(new Set())

  // ── Helpers ──────────────────────────────────────────────────────────────
  const handleVersionSelect = (version) => {
    setSelectedVersion(version)
    setVersionData(versionToData(version))
  }

  const refreshFromGame = (updatedGame, preferredVersion) => {
    setGame(updatedGame)
    setFormData(gameToFormData(updatedGame))
    const updatedVersions = updatedGame.versions || []
    setVersions(updatedVersions)
    const preferredVersionId = preferredVersion && typeof preferredVersion === 'object'
      ? preferredVersion.version_id
      : null
    const preferredVersionName = preferredVersion && typeof preferredVersion === 'object'
      ? preferredVersion.version
      : preferredVersion
    const versionToSelect =
      updatedVersions.find((v) =>
        preferredVersionId
          ? v.version_id === preferredVersionId
          : v.version === preferredVersionName
      ) || updatedVersions[0]
    if (versionToSelect) handleVersionSelect(versionToSelect)
    else { setSelectedVersion(null); setVersionData(EMPTY_VERSION) }
  }

  // ── IPC Setup ────────────────────────────────────────────────────────────
  useEffect(() => {
    const handleGameData = (event, fetchedGame) => {
      if (dataHandledRef.current) return
      dataHandledRef.current = true
      setDataReceived(true)
      if (!fetchedGame) { setLoadError(true); return }
      setGame(fetchedGame)
      setVersions(fetchedGame.versions || [])
      setFormData(gameToFormData(fetchedGame))
      if (fetchedGame.versions?.length > 0) handleVersionSelect(fetchedGame.versions[0])
      recalculateMissingVersionSizes(fetchedGame)
      setBannerUrl(fetchedGame.banner_url || '')
      window.electronAPI.getPreviews(fetchedGame.record_id)
        .then((urls) => setPreviewUrls(urls || []))
        .catch((err) => console.error('Failed to load previews:', err))
    }

    window.electronAPI.onGameData(handleGameData)

    const pullGameData = () => {
      if (typeof window.electronAPI.requestGameData !== 'function') return
      setLoadError(false)
      dataHandledRef.current = false
      window.electronAPI.requestGameData()
        .then((fetchedGame) => {
          if (!fetchedGame) { setLoadError(true); return }
          handleGameData(null, fetchedGame)
        })
        .catch((err) => { console.error('requestGameData failed:', err); setLoadError(true) })
    }
    retryLoadRef.current = pullGameData
    pullGameData()

    window.electronAPI.onWindowStateChanged((state) => setIsMaximized(state === 'maximized'))

    const handleImportProgress = (progress) => {
      setImportProgress(sanitizeProgressState(progress))
      if (progress.progress >= progress.total && progress.total > 0) {
        setTimeout(() => setImportProgress({ text: '', progress: 0, total: 0 }), 2000)
      }
    }
    window.electronAPI.onGameDetailsImportProgress(handleImportProgress)
    return () => window.electronAPI.removeGameDetailsImportProgressListener(handleImportProgress)
  }, [])

  useEffect(() => {
    const update = () => {
      const available = window.innerHeight - 32 - 170 - 48 - 414
      setPreviewHeight(Math.max(available, 100))
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  useEffect(() => {
    if (!game?.record_id) return
    const handleGameUpdated = async (event, payload) => {
      const updatedId = typeof payload === 'object' ? payload?.record_id : payload
      if (updatedId !== game.record_id) return
      const updatedGame = typeof payload === 'object'
        ? payload
        : await window.electronAPI.getGame(game.record_id)
      if (updatedGame) refreshFromGame(updatedGame, selectedVersion)
    }
    const removeListener = window.electronAPI.onGameUpdated?.(handleGameUpdated)
    return () => {
      if (typeof removeListener === 'function') removeListener()
    }
  }, [game?.record_id, selectedVersion])

  useEffect(() => {
    Promise.all(
      previewUrls.map(async (url) => {
        try {
          const img = new Image(); img.src = toMediaSrc(url)
          await new Promise((res, rej) => { img.onload = res; img.onerror = rej })
          return url
        } catch { return null }
      })
    ).then((results) => setValidPreviewUrls(results.filter(Boolean)))
  }, [previewUrls])

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleDownloadBanner = async () => {
    setImportProgress({ text: 'Starting banner download...', progress: 0, total: 1 })
    try {
      const newUrl = await window.electronAPI.updateBanners(game.record_id)
      setBannerUrl(firstMediaUrl(newUrl))
    } catch (err) {
      console.error('Failed to download banner:', err)
      setImportProgress({ text: '', progress: 0, total: 0 })
    }
  }

  const handleSelectCustomBanner = async () => {
    try {
      const filePath = await window.electronAPI.selectFile()
      if (!filePath) return
      setImportProgress({ text: 'Converting and saving banner...', progress: 0, total: 1 })
      const newUrl = await window.electronAPI.convertAndSaveBanner(game.record_id, filePath)
      setBannerUrl(firstMediaUrl(newUrl))
      const refreshedGame = await window.electronAPI.getGame(game.record_id)
      if (refreshedGame) { refreshFromGame(refreshedGame, selectedVersion?.version); setBannerUrl(refreshedGame.banner_url || firstMediaUrl(newUrl)) }
      setImportProgress({ text: 'Custom banner saved', progress: 1, total: 1 })
      setTimeout(() => setImportProgress({ text: '', progress: 0, total: 0 }), 1500)
    } catch (err) {
      alert(`Failed to save custom banner: ${err.message}`)
      setImportProgress({ text: '', progress: 0, total: 0 })
    }
  }

  const handleDeleteBanner = async () => {
    try {
      setImportProgress({ text: 'Deleting downloaded banner...', progress: 0, total: 1 })
      await window.electronAPI.deleteBanner(game.record_id)
      const refreshedGame = await window.electronAPI.getGame(game.record_id)
      if (refreshedGame) {
        refreshFromGame(refreshedGame, selectedVersion)
        setBannerUrl(refreshedGame.banner_url || '')
      }
      setImportProgress({ text: 'Banner deleted', progress: 1, total: 1 })
      setTimeout(() => setImportProgress({ text: '', progress: 0, total: 0 }), 1500)
    } catch (err) {
      console.error('Failed to delete banner:', err)
      alert(`Failed to delete banner: ${err.message || 'Unknown error'}`)
      setImportProgress({ text: '', progress: 0, total: 0 })
    }
  }

  const handleDownloadPreviews = async () => {
    setImportProgress({ text: 'Starting previews download...', progress: 0, total: 1 })
    try {
      const newUrls = await window.electronAPI.updatePreviews(game.record_id)
      setPreviewUrls(newUrls)
    } catch (err) {
      console.error('Failed to download previews:', err)
      setImportProgress({ text: '', progress: 0, total: 0 })
    }
  }

  const handleDeletePreviews = async () => {
    try {
      setImportProgress({ text: 'Deleting downloaded previews...', progress: 0, total: 1 })
      await window.electronAPI.deletePreviews(game.record_id)
      const [refreshedGame, urls] = await Promise.all([
        window.electronAPI.getGame(game.record_id),
        window.electronAPI.getPreviews(game.record_id),
      ])
      if (refreshedGame) {
        refreshFromGame(refreshedGame, selectedVersion)
        setBannerUrl(refreshedGame.banner_url || '')
      }
      setPreviewUrls(Array.isArray(urls) ? urls : [])
      setImportProgress({ text: 'Previews deleted', progress: 1, total: 1 })
      setTimeout(() => setImportProgress({ text: '', progress: 0, total: 0 }), 1500)
    } catch (err) {
      console.error('Failed to delete previews:', err)
      alert(`Failed to delete previews: ${err.message || 'Unknown error'}`)
      setImportProgress({ text: '', progress: 0, total: 0 })
    }
  }

  const handleRefreshMetadata = async () => {
    setImportProgress({ text: 'Refreshing media links...', progress: 0, total: 1 })
    try {
      const result = await window.electronAPI.refreshGameMedia(game.record_id)
      if (result?.success === false) throw new Error(result.error || 'Refresh failed')
      const refreshedGame = result?.game || await window.electronAPI.getGame(game.record_id)
      if (refreshedGame) refreshFromGame(refreshedGame, selectedVersion?.version)
      if (result?.bannerUrl) setBannerUrl(firstMediaUrl(result.bannerUrl))
      if (Array.isArray(result?.previewUrls)) setPreviewUrls(result.previewUrls)
    } catch (err) {
      alert(`Failed to refresh media links: ${err.message}`)
      setImportProgress({ text: '', progress: 0, total: 0 })
    }
  }

  const updateSelectedVersionPath = async (changes) => {
    if (!selectedVersion) {
      alert('No version selected.')
      return
    }
    const nextVersion = {
      ...selectedVersion,
      version_id: selectedVersion.version_id,
      previousVersion: selectedVersion.version,
      version: selectedVersion.version,
      game_path: Object.prototype.hasOwnProperty.call(changes, 'game_path')
        ? changes.game_path
        : selectedVersion.game_path,
      exec_path: Object.prototype.hasOwnProperty.call(changes, 'exec_path')
        ? changes.exec_path
        : selectedVersion.exec_path,
    }
    const result = await window.electronAPI.updateVersion(nextVersion, game.record_id)
    if (result?.success === false) throw new Error(result.error || 'Failed to update version')
    const refreshedGame = await window.electronAPI.getGame(game.record_id)
    if (refreshedGame) refreshFromGame(refreshedGame, selectedVersion)
  }

  const recalculateMissingVersionSizes = async (targetGame) => {
    const targetVersions = targetGame?.versions || []
    const versionsToRefresh = targetVersions.filter((version) => {
      if (!version?.game_path || version.isInstalled === false) return false
      if (Number(version.folder_size || 0) > 0) return false
      const key = `${targetGame.record_id}|${version.version}|${version.game_path}`
      if (sizeRefreshKeyRef.current.has(key)) return false
      sizeRefreshKeyRef.current.add(key)
      return true
    })
    if (versionsToRefresh.length === 0) return
    try {
      for (const version of versionsToRefresh) {
        await window.electronAPI.recalculateVersionSize?.({
          recordId: targetGame.record_id,
          version: version.version,
          gamePath: version.game_path,
        })
      }
      const refreshedGame = await window.electronAPI.getGame(targetGame.record_id)
      if (refreshedGame) refreshFromGame(refreshedGame, selectedVersion)
    } catch (err) {
      console.error('Failed to recalculate version sizes:', err)
    }
  }

  const handleSetPath = async () => {
    try {
      const selectedPath = await window.electronAPI.selectDirectory()
      if (!selectedPath) return
      setVersionData((current) => ({ ...current, game_path: selectedPath }))
      await updateSelectedVersionPath({ game_path: selectedPath })
    } catch (err) {
      console.error('Failed to change game path:', err)
      alert(`Failed to change game path: ${err.message || 'Unknown error'}`)
    }
  }

  const handleOpenGamePath = async () => {
    if (!versionData.game_path) {
      alert('No game folder is set for this version.')
      return
    }
    try {
      await window.electronAPI.openDirectory(versionData.game_path)
    } catch (err) {
      console.error('Failed to open game folder:', err)
      alert(`Failed to open game folder: ${err.message || 'Unknown error'}`)
    }
  }

  const handleRefreshVersionSize = async () => {
    if (!selectedVersion?.game_path) {
      alert('No game path is set for this version.')
      return
    }
    setVersionData((current) => ({ ...current, version_size: 'Calculating...' }))
    try {
      const result = await window.electronAPI.recalculateVersionSize?.({
        recordId: game.record_id,
        version: selectedVersion.version,
        gamePath: selectedVersion.game_path,
      })
      if (!result?.success) {
        setVersionData((current) => ({
          ...current,
          version_size: result?.missing ? 'Missing path' : 'Unable to calculate',
        }))
        return
      }
      const refreshedGame = await window.electronAPI.getGame(game.record_id)
      if (refreshedGame) refreshFromGame(refreshedGame, selectedVersion)
    } catch (err) {
      console.error('Failed to refresh version size:', err)
      setVersionData((current) => ({ ...current, version_size: 'Unable to calculate' }))
    }
  }

  const handleChangeExecutable = async () => {
    try {
      const selectedPath = await window.electronAPI.selectFile()
      if (!selectedPath) return
      setVersionData((current) => ({ ...current, executable: selectedPath }))
      await updateSelectedVersionPath({ exec_path: selectedPath })
    } catch (err) {
      console.error('Failed to change executable:', err)
      alert(`Failed to change executable: ${err.message || 'Unknown error'}`)
    }
  }

  const handleAddVersion = async () => {
    try {
      const sourcePath = await window.electronAPI.selectCatalogImportSource?.()
      if (!sourcePath) return
      const suggestedVersion = String(sourcePath).split(/[\\/]/).filter(Boolean).pop()?.replace(/\.(zip|7z|rar)$/i, '') || ''
      const version = window.prompt('Version name', suggestedVersion)
      if (!version?.trim()) return
      const result = await window.electronAPI.importLocalGameVersion?.({
        recordId: game.record_id,
        sourcePath,
        version: version.trim(),
        replaceExisting: false,
      })
      if (!result?.success) throw new Error(result?.error || 'Import failed')
      const refreshedGame = await window.electronAPI.getGame(game.record_id)
      if (refreshedGame) refreshFromGame(refreshedGame)
    } catch (err) {
      console.error('Failed to add version:', err)
      alert(`Failed to add version: ${err.message || 'Unknown error'}`)
    }
  }

  const handleRemoveVersion = async () => {
    if (!selectedVersion) { alert('No version selected.'); return }
    const versionLabel = selectedVersion.version || 'this version'
    const currentCount = await window.electronAPI.countVersions(game.record_id)
    if (currentCount <= 1) {
      if (!window.confirm(`Remove "${game.title}" from the local library?\n\nThis is the last version. Game files will be kept on disk.`)) return
      const dbResult = await window.electronAPI.deleteGameCompletely(game.record_id)
      if (!dbResult.success) { alert('Failed to remove game: ' + (dbResult.error || 'Unknown error')); return }
      alert(`"${game.title}" has been removed from your library.`)
      window.electronAPI.closeWindow()
      return
    }
    if (!window.confirm(`Remove version "${versionLabel}" from the local library?\n\nGame files will be kept on disk.`)) return
    const result = await window.electronAPI.deleteVersion({ recordId: game.record_id, version: selectedVersion.version })
    if (result.success) {
      const updatedVersions = versions.filter((v) => v.version !== selectedVersion.version)
      setVersions(updatedVersions)
      if (updatedVersions.length > 0) handleVersionSelect(updatedVersions[0])
      else { setSelectedVersion(null); setVersionData(EMPTY_VERSION) }
    } else {
      alert(`Failed to remove version: ${result.error || 'Unknown error'}`)
    }
  }

  const handleDeleteVersionFiles = async () => {
    if (!selectedVersion) { alert('No version selected.'); return }
    if (!selectedVersion.game_path) { alert('No game folder is set for this version.'); return }
    const versionLabel = selectedVersion.version || 'this version'
    if (!window.confirm(`Delete files for version "${versionLabel}" from disk?\n\nThis will delete:\n${selectedVersion.game_path}\n\nThe database entry will remain. This cannot be undone.`)) return
    const result = await window.electronAPI.deleteFolderRecursive({ recordId: game.record_id, folderPath: selectedVersion.game_path })
    if (!result.success) { alert('Failed to delete files: ' + (result.error || 'Unknown error')); return }
    const refreshedGame = await window.electronAPI.getGame(game.record_id)
    if (refreshedGame) refreshFromGame(refreshedGame, selectedVersion)
    alert(`Files for version "${versionLabel}" deleted.`)
  }

  const handleRemoveTitle = async () => {
    if (!window.confirm(`Remove "${game.title}" from the local library?\n\nGame files will be kept on disk.`)) return
    const result = await window.electronAPI.deleteTitle({ recordId: game.record_id, deleteFiles: false })
    if (!result.success) { alert(`Failed to remove title: ${result.error || 'Unknown error'}`); return }
    alert(`"${game.title}" was removed from your library.`)
    window.electronAPI.closeWindow()
  }

  const handleDeleteTitleAndFiles = async () => {
    const versionPaths = (game.versions || []).map((v) => v.game_path).filter(Boolean)
    const pathList = versionPaths.length ? `\n\nFolders to delete:\n${versionPaths.join('\n')}` : '\n\nNo linked folders found.'
    if (!window.confirm(`Delete "${game.title}" and all linked files from disk?${pathList}\n\nThis cannot be undone.`)) return
    const result = await window.electronAPI.deleteTitle({ recordId: game.record_id, deleteFiles: true })
    if (!result.success) { alert(`Failed to delete title: ${result.error || 'Unknown error'}`); return }
    alert(`"${game.title}" and its linked files were deleted.`)
    window.electronAPI.closeWindow()
  }

  const handleSave = async () => {
    const updatedGame = {
      ...game,
      title: formData.title, os: formData.platform, engine: formData.engine,
      creator: formData.developer, publisher: formData.publisher,
      release_date: formData.release_date,
      status: formData.status, f95_tags: formData.tags ? formData.tags.replace(/ , /g, ',') : '',
      tags: formData.tags ? formData.tags.replace(/ , /g, ',') : '',
      overview: formData.description, category: formData.category,
      latest_version: formData.latest_version, censored: formData.censored,
      language: formData.language, translations: formData.translations,
      genre: formData.genre, voice: formData.voice, rating: formData.rating,
    }
    await window.electronAPI.updateGame(updatedGame)
    const savedVersion = {
      version_id: selectedVersion?.version_id,
      version: versionData.game_version,
    }
    if (selectedVersion) {
      const result = await window.electronAPI.updateVersion({
        ...selectedVersion,
        version_id: selectedVersion.version_id,
        previousVersion: selectedVersion.version,
        version: versionData.game_version,
        game_path: versionData.game_path,
        exec_path: versionData.executable,
      }, game.record_id)
      if (result?.success === false) {
        alert(result.error || 'Failed to update version')
        return
      }
    }
    const refreshedGame = await window.electronAPI.getGame(game.record_id)
    if (refreshedGame) refreshFromGame(refreshedGame, savedVersion)
  }

  const handleFindGame = async () => {
    try {
      const results = await window.electronAPI.searchAtlas(formData.title, formData.developer)
      setSearchResults(results || [])
      setShowModal(true)
    } catch (err) { console.error('Failed to search Atlas:', err) }
  }

  const handleSelectGame = async (atlasId) => {
    try {
      await window.electronAPI.addAtlasMapping(game.record_id, atlasId)
      const updatedGame = await window.electronAPI.getGame(game.record_id)
      refreshFromGame(updatedGame, selectedVersion)
      setBannerUrl(updatedGame.banner_url || '')
      window.electronAPI.getPreviews(updatedGame.record_id)
        .then((urls) => setPreviewUrls(urls || []))
        .catch(console.error)
      setShowModal(false)
    } catch (err) { console.error('Failed to update Atlas mapping:', err) }
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  const bannerMediaStatus = bannerUrl
    ? isRemoteMediaUrl(bannerUrl) ? 'Streaming from the web' : 'Downloaded to local storage'
    : 'No banner available'
  const previewMediaStatus = validPreviewUrls.length > 0
    ? validPreviewUrls.some(isRemoteMediaUrl) ? 'Streaming from the web' : 'Downloaded to local storage'
    : 'No previews available'

  // ── Loading state ─────────────────────────────────────────────────────────
  if (!game) {
    return (
      <div className="flex flex-col h-screen bg-canvas text-text rounded-windowTheme overflow-hidden transform-gpu">
        <WindowBorderFrame />
        <TitleBar isMaximized={isMaximized} />
        <div className="flex-grow flex flex-col items-center justify-center bg-secondary gap-4">
          {loadError ? (
            <>
              <span className="text-text">Couldn't load this game's data.</span>
              <button onClick={() => retryLoadRef.current?.()} className="px-4 py-2 bg-accent text-white rounded hover:bg-accentHover" style={{ pointerEvents: 'auto' }}>Retry</button>
            </>
          ) : (
            <span>Loading game data...</span>
          )}
        </div>
      </div>
    )
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-canvas text-text rounded-windowTheme overflow-hidden transform-gpu">
      <WindowBorderFrame />
      <TitleBar isMaximized={isMaximized} />

      <div className="flex flex-col flex-1 min-h-0 bg-primary">
        <div className="flex shrink-0 border-b border-border items-center justify-between">
          <div className="flex flex-wrap">
            {['Record', 'Versions', 'Media', 'Mappings'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 ${activeTab === tab ? 'bg-secondary border-t border-l border-r border-border' : 'bg-primary'}`}
              >
                {tab}
              </button>
            ))}
          </div>
          <button
            onClick={handleFindGame}
            className="mx-2 my-1 px-3 py-1 bg-accent text-white rounded hover:bg-accentHover text-sm whitespace-nowrap shrink-0"
          >
            <i className="fas fa-magnifying-glass mr-1" aria-hidden="true"></i>
            Find Match
          </button>
        </div>

        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="flex-1 min-h-0 overflow-y-auto p-4 bg-secondary pb-24">
            {activeTab === 'Record' && (
              <RecordTab
                formData={formData}
                onChange={(e) => setFormData({ ...formData, [e.target.name]: e.target.value })}
                onFindGame={handleFindGame}
                onRemoveTitle={handleRemoveTitle}
                onDeleteTitleAndFiles={handleDeleteTitleAndFiles}
              />
            )}
            {activeTab === 'Versions' && (
              <VersionsTab
                versions={versions}
                selectedVersion={selectedVersion}
                versionData={versionData}
                onVersionSelect={handleVersionSelect}
                onVersionInputChange={(e) => setVersionData({ ...versionData, [e.target.name]: e.target.value })}
                onSetPath={handleSetPath}
                onOpenGamePath={handleOpenGamePath}
                onRefreshVersionSize={handleRefreshVersionSize}
                onChangeExecutable={handleChangeExecutable}
                onAddVersion={handleAddVersion}
                onRemoveVersion={handleRemoveVersion}
                onDeleteVersionFiles={handleDeleteVersionFiles}
              />
            )}
            {activeTab === 'Media' && (
              <MediaTab
                game={game}
                bannerUrl={bannerUrl}
                bannerMediaStatus={bannerMediaStatus}
                validPreviewUrls={validPreviewUrls}
                previewMediaStatus={previewMediaStatus}
                previewHeight={previewHeight}
                importProgress={importProgress}
                onDownloadBanner={handleDownloadBanner}
                onSelectCustomBanner={handleSelectCustomBanner}
                onDeleteBanner={handleDeleteBanner}
                onDownloadPreviews={handleDownloadPreviews}
                onDeletePreviews={handleDeletePreviews}
                onRefreshMetadata={handleRefreshMetadata}
              />
            )}
            {activeTab === 'Mappings' && (
              <MappingsTab
                game={game}
                onFindGame={handleFindGame}
              />
            )}
          </div>
        </div>

        <div className="shrink-0 p-4 bg-primary flex justify-end space-x-2 z-10 border-t border-border">
          <button onClick={handleSave} className="px-4 py-1 bg-tertiary hover:bg-buttonHover rounded">Save</button>
          <button onClick={() => window.electronAPI.closeWindow()} className="px-4 py-1 bg-tertiary hover:bg-buttonHover rounded">Cancel</button>
        </div>
      </div>

      {showModal && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => { setShowModal(false); setSearchResults([]) }}
        >
          <div className="bg-secondary p-4 rounded-md max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg mb-4">Select Game Match</h2>
            {searchResults.length > 0 ? (
              <ul className="space-y-2 max-h-[300px] overflow-y-auto">
                {searchResults.map((result, index) => (
                  <li
                    key={index}
                    className="p-2 bg-tertiary hover:bg-buttonHover rounded cursor-pointer"
                    onClick={() => handleSelectGame(result.atlas_id)}
                  >
                    <div>{result.title}</div>
                    <div className="text-sm text-muted">
                      Atlas ID: {result.atlas_id} | F95 ID: {result.f95_id || 'N/A'} | Creator: {result.creator || 'N/A'}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No matches found</p>
            )}
            <div className="flex justify-end space-x-2 mt-4">
              <button
                onClick={() => { setShowModal(false); setSearchResults([]) }}
                className="px-4 py-1 bg-tertiary hover:bg-buttonHover rounded"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default GameDetailWindow
