import { useState, useEffect, useRef } from 'react'
import TitleBar from './window/TitleBar.jsx'
import RecordTab from './window/RecordTab.jsx'
import VersionsTab from './window/VersionsTab.jsx'
import MediaTab from './window/MediaTab.jsx'
import MappingsTab from './window/MappingsTab.jsx'

const isRemoteMediaUrl = (url) => /^https?:\/\//i.test(String(url || ''))
const firstMediaUrl = (value) => Array.isArray(value) ? value[0] || '' : value || ''

const EMPTY_FORM = {
  title: '', mappings: '', platform: '', engine: '', developer: '',
  publisher: '', release_date: '', status: '', tags: '', description: '',
  category: '', latest_version: '', censored: '', language: '',
  translations: '', genre: '', voice: '', rating: '',
}

const EMPTY_VERSION = {
  game_version: '', game_path: '', executable: '',
  last_played: '', playtime: '', version_size: '', date_added: '',
}

function gameToFormData(g) {
  const mapperNames = []
  if (g.f95_id) mapperNames.push('F95Zone')
  if (g.atlas_id) mapperNames.push('Atlas')
  return {
    title: g.title || '',
    mappings: mapperNames.join(', '),
    platform: g.os || '',
    engine: g.engine || '',
    developer: g.creator || '',
    publisher: g.publisher || '',
    release_date: g.release_date
      ? new Date(parseInt(g.release_date) * 1000).toISOString().split('T')[0]
      : '',
    status: g.status || '',
    tags: g.f95_tags ? g.f95_tags.replace(/,/g, ' , ') : '',
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
  return {
    game_version: v.version || '',
    game_path: v.game_path || '',
    executable: v.exec_path || '',
    last_played: v.last_played?.toString() || '',
    playtime: v.version_playtime?.toString() || '',
    version_size: v.folder_size?.toString() || '',
    date_added: v.date_added?.toString() || '',
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
    const versionToSelect =
      updatedVersions.find((v) => v.version === preferredVersion) || updatedVersions[0]
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
      setImportProgress(progress)
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
    Promise.all(
      previewUrls.map(async (url) => {
        try {
          const img = new Image(); img.src = url
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

  const handleSetPath = () => {
    if (versionData.game_path) { window.electronAPI.openDirectory(versionData.game_path); return }
    window.electronAPI.selectDirectory()
      .then((path) => { if (path) setVersionData({ ...versionData, game_path: path }) })
      .catch(console.error)
  }

  const handleChangeExecutable = () => {
    if (versionData.executable) { window.electronAPI.openDirectory(versionData.executable); return }
    window.electronAPI.selectFile()
      .then((path) => { if (path) setVersionData({ ...versionData, executable: path }) })
      .catch(console.error)
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
      alert('Failed to remove version.')
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
    if (refreshedGame) refreshFromGame(refreshedGame, selectedVersion.version)
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
      release_date: formData.release_date ? new Date(formData.release_date).getTime() / 1000 : '',
      status: formData.status, f95_tags: formData.tags ? formData.tags.replace(/ , /g, ',') : '',
      overview: formData.description, category: formData.category,
      latest_version: formData.latest_version, censored: formData.censored,
      language: formData.language, translations: formData.translations,
      genre: formData.genre, voice: formData.voice, rating: formData.rating,
    }
    await window.electronAPI.updateGame(updatedGame)
    const savedVersion = versionData.game_version
    for (const version of versions) {
      await window.electronAPI.updateVersion({
        ...version,
        previousVersion: version.version,
        version: version.version === selectedVersion?.version ? versionData.game_version : version.version,
        game_path: version.version === selectedVersion?.version ? versionData.game_path : version.game_path,
        exec_path: version.version === selectedVersion?.version ? versionData.executable : version.exec_path,
      }, game.record_id)
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
      refreshFromGame(updatedGame, selectedVersion?.version)
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
      <div className="flex flex-col h-screen bg-canvas text-text border border-accent rounded-md overflow-hidden">
        <TitleBar isMaximized={isMaximized} />
        <div className="flex-grow flex flex-col items-center justify-center bg-secondary gap-4">
          {loadError ? (
            <>
              <span className="text-text">Couldn't load this game's data.</span>
              <button onClick={() => retryLoadRef.current?.()} className="px-4 py-2 bg-accent text-white rounded hover:opacity-90" style={{ pointerEvents: 'auto' }}>Retry</button>
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
    <div className="flex flex-col h-screen bg-canvas text-text border border-accent rounded-md overflow-hidden">
      <TitleBar isMaximized={isMaximized} />

      <div className="flex flex-col flex-1 min-h-0 bg-primary">
        <div className="flex shrink-0 border-b border-border">
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
                onChangeExecutable={handleChangeExecutable}
                onAddVersion={() => console.log('TODO: Add version')}
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
                setPreviewUrls={setPreviewUrls}
                onDownloadBanner={handleDownloadBanner}
                onSelectCustomBanner={handleSelectCustomBanner}
                onDownloadPreviews={handleDownloadPreviews}
                onRefreshMetadata={handleRefreshMetadata}
              />
            )}
            {activeTab === 'Mappings' && (
              <MappingsTab
                game={game}
                showModal={showModal}
                searchResults={searchResults}
                onFindGame={handleFindGame}
                onSelectGame={handleSelectGame}
                onCloseModal={() => { setShowModal(false); setSearchResults([]) }}
              />
            )}
          </div>
        </div>

        <div className="shrink-0 p-4 bg-primary flex justify-end space-x-2 z-10 border-t border-border">
          <button onClick={handleSave} className="px-4 py-1 bg-tertiary hover:bg-button_hover rounded">Save</button>
          <button onClick={() => window.electronAPI.closeWindow()} className="px-4 py-1 bg-tertiary hover:bg-button_hover rounded">Cancel</button>
        </div>
      </div>
    </div>
  )
}

export default GameDetailWindow
