import { useState, useEffect, useRef } from 'react'
import HeroBanner from './page/HeroBanner.jsx'
import ActionBar from './page/ActionBar.jsx'
import InfoPanel from './page/InfoPanel.jsx'
import PreviewLightbox from './page/PreviewLightbox.jsx'
import {
  LAUNCH_STATE, filterOutBanner, formatPlaytime,
  sortVersionsDesc, getInstalledVersions, getDefaultVersion,
} from './page/gameDetailUtils.js'
import { buildExternalLinks } from './externalLinks.js'

const GameDetailPage = ({ game, onBack, onRefresh }) => {
  const [previews, setPreviews] = useState([])
  const [selectedVersion, setSelectedVersion] = useState(null)
  const [isRefreshingMedia, setIsRefreshingMedia] = useState(false)
  const [launchState, setLaunchState] = useState(LAUNCH_STATE.IDLE)
  const [showInfo, setShowInfo] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(null)
  const [bannerMask, setBannerMask] = useState({ image: 'none', composite: null })
  const isRunningRef  = useRef(false)
  const rootRef       = useRef(null)
  const bannerRef     = useRef(null)
  const bannerDimsRef = useRef(null)

  // ── Effects ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!game?.record_id) return
    setSelectedVersion((current) => {
      const versions = game.versions || []
      if (!current) return getDefaultVersion(versions)
      return versions.find((v) => v.version === current.version && v.game_path === current.game_path) || getDefaultVersion(versions)
    })
    window.electronAPI.getPreviews(game.record_id)
      .then((urls) => setPreviews(filterOutBanner(urls, game.banner_url)))
      .catch((err) => { console.error('Failed to load previews:', err); setPreviews([]) })
  }, [game?.record_id, game?.versions])

  useEffect(() => {
    setLaunchState(LAUNCH_STATE.IDLE)
    setShowInfo(false)
    setLightboxIndex(null)
    isRunningRef.current = false
  }, [game?.record_id])

  useEffect(() => {
    const findScroller = (el) => {
      let node = el?.parentElement
      while (node) {
        const oy = getComputedStyle(node).overflowY
        if (oy === 'auto' || oy === 'scroll') return node
        node = node.parentElement
      }
      return null
    }
    const scroller = findScroller(rootRef.current)
    if (scroller) scroller.scrollTop = 0
    else rootRef.current?.scrollIntoView?.({ block: 'start' })
  }, [game?.record_id])

  useEffect(() => {
    if (lightboxIndex === null) return
    const onKey = (e) => {
      if (e.key === 'Escape') setLightboxIndex(null)
      else if (e.key === 'ArrowLeft') setLightboxIndex((i) => (i === null ? i : (i - 1 + previews.length) % previews.length))
      else if (e.key === 'ArrowRight') setLightboxIndex((i) => (i === null ? i : (i + 1) % previews.length))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxIndex, previews.length])

  // ── Banner feathering ─────────────────────────────────────────────────────
  const recomputeFeather = () => {
    const c = bannerRef.current
    const dims = bannerDimsRef.current
    if (!c || !dims || !dims.w || !dims.h) return
    const cw = c.clientWidth, ch = c.clientHeight
    if (!cw || !ch) return
    const scale = Math.min(cw / dims.w, ch / dims.h)
    const rw = dims.w * scale, rh = dims.h * scale
    const offX = (cw - rw) / 2, offY = (ch - rh) / 2
    const eps = 1
    const masks = []
    if (offX > eps) {
      const L = (offX / cw) * 100, R = ((offX + rw) / cw) * 100
      const band = (Math.min(48, rw * 0.08) / cw) * 100
      masks.push(`linear-gradient(to right, transparent ${L}%, black ${L + band}%, black ${R - band}%, transparent ${R}%)`)
    }
    if (offY > eps) {
      const T = (offY / ch) * 100, B = ((offY + rh) / ch) * 100
      const band = (Math.min(48, rh * 0.08) / ch) * 100
      masks.push(`linear-gradient(to bottom, transparent ${T}%, black ${T + band}%, black ${B - band}%, transparent ${B}%)`)
    }
    if (masks.length === 0) setBannerMask({ image: 'none', composite: null })
    else setBannerMask({ image: masks.join(', '), composite: masks.length > 1 ? 'intersect' : null })
  }

  useEffect(() => {
    setBannerMask({ image: 'none', composite: null })
    bannerDimsRef.current = null
    window.addEventListener('resize', recomputeFeather)
    return () => window.removeEventListener('resize', recomputeFeather)
  }, [game?.record_id, game?.banner_url])

  useEffect(() => {
    if (!game?.record_id) return
    const handleGameUpdated = (event, payload) => {
      const updatedId = typeof payload === 'object' ? payload?.record_id : payload
      if (updatedId !== game.record_id) return
      if (isRunningRef.current) {
        isRunningRef.current = false
        setLaunchState(LAUNCH_STATE.IDLE)
        onRefresh?.(game.record_id)
      }
    }
    window.electronAPI.onGameUpdated(handleGameUpdated)
    return () => { window.electronAPI.removeAllListeners?.('game-updated') }
  }, [game?.record_id, launchState])

  // ── Derived state ─────────────────────────────────────────────────────────
  const installedVersions = getInstalledVersions(game.versions || [])
  const actionVersion = selectedVersion || getDefaultVersion(installedVersions)
  const canLaunch = Boolean(actionVersion && actionVersion.isInstalled !== false && (actionVersion.exec_path || game.record_id))
  const canOpenFolder = Boolean(actionVersion?.game_path && actionVersion.isInstalled !== false)
  const latestVersion = game.latestVersion || game.latest_version || ''
  const versionOptions = sortVersionsDesc(game.versions || [])

  const metadataRows = [
    ['Status', game.status], ['Engine', game.engine], ['Category', game.category],
    ['Rating', game.rating], ['Likes', game.likes], ['Views', game.views],
    ['Language', game.language], ['Censored', game.censored],
  ].filter(([, v]) => v !== undefined && v !== null && v !== '')

  const localVersion = actionVersion?.version || selectedVersion?.version || game.versions?.[0]?.version || game.version || ''

  const externalLinks = buildExternalLinks(game.external_ids)

  const infoRows = [
    ['Installed Version', localVersion], ['Latest Version', latestVersion],
    ['Developer', game.creator], ['Publisher', game.publisher],
    ['Release Date', game.release_date ? new Date(parseInt(game.release_date) * 1000).toISOString().split('T')[0] : null],
    ['Status', game.status], ['Engine', game.engine], ['Category', game.category],
    ['Language', game.language], ['Translations', game.translations],
    ['Genre', game.genre], ['Voice', game.voice], ['Rating', game.rating],
    ['Censored', game.censored], ['Likes', game.likes], ['Views', game.views],
    ['F95 ID', game.f95_id], ['Atlas ID', game.atlas_id],
  ].filter(([, v]) => v !== undefined && v !== null && v !== '')

  // ── Handlers ──────────────────────────────────────────────────────────────
  const launchSelectedGame = async () => {
    if (!canLaunch || launchState !== LAUNCH_STATE.IDLE) return
    setLaunchState(LAUNCH_STATE.LAUNCHING)
    try {
      await window.electronAPI.launchGame({ recordId: game.record_id, version: actionVersion.version })
      isRunningRef.current = true
      setLaunchState(LAUNCH_STATE.RUNNING)
    } catch (err) {
      console.error('Launch failed:', err)
      setLaunchState(LAUNCH_STATE.IDLE)
      isRunningRef.current = false
    }
  }

  const openSelectedFolder = async () => {
    if (!canOpenFolder) return
    await window.electronAPI.openGameFolder({ recordId: game.record_id, version: actionVersion.version })
  }

  const openProperties = async () => { await window.electronAPI.openGameProperties(game.record_id) }
  const openWebsite = async () => { if (game.siteUrl) await window.electronAPI.openExternalUrl(game.siteUrl) }

  const removeTitleFromLibrary = async () => {
    if (!window.confirm(`Remove "${game.title}" from the local library?\n\nGame files will be kept on disk.`)) return
    const result = await window.electronAPI.deleteTitle({ recordId: game.record_id, deleteFiles: false })
    if (!result.success) { alert(`Failed to remove title: ${result.error || 'Unknown error'}`); return }
    onBack?.()
  }

  const deleteTitleAndFiles = async () => {
    const versionPaths = (game.versions || []).map((v) => v.game_path).filter(Boolean)
    const pathList = versionPaths.length ? `\n\nFolders to delete:\n${versionPaths.join('\n')}` : '\n\nNo linked folders were found.'
    if (!window.confirm(`Delete "${game.title}" and all linked files from disk?${pathList}\n\nThis cannot be undone.`)) return
    const result = await window.electronAPI.deleteTitle({ recordId: game.record_id, deleteFiles: true })
    if (!result.success) { alert(`Failed to delete title: ${result.error || 'Unknown error'}`); return }
    onBack?.()
  }

  const refreshMetadataAndImages = async () => {
    if (!game?.record_id || isRefreshingMedia) return
    setIsRefreshingMedia(true)
    try {
      const result = await window.electronAPI.refreshGameMedia(game.record_id)
      if (result?.success === false) throw new Error(result.error || 'Refresh failed')
      if (Array.isArray(result?.previewUrls)) setPreviews(filterOutBanner(result.previewUrls, game.banner_url))
      onRefresh?.(game.record_id)
    } catch (error) {
      alert(`Failed to refresh media links: ${error.message}`)
    } finally {
      setIsRefreshingMedia(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div ref={rootRef} className="min-h-full bg-tertiary text-text flex flex-col">

      <HeroBanner
        game={game}
        bannerRef={bannerRef}
        bannerDimsRef={bannerDimsRef}
        bannerMask={bannerMask}
        onLoad={recomputeFeather}
        onBack={onBack}
      />

      <ActionBar
        game={game}
        actionVersion={actionVersion}
        latestVersion={latestVersion}
        canLaunch={canLaunch}
        canOpenFolder={canOpenFolder}
        launchState={launchState}
        isRefreshingMedia={isRefreshingMedia}
        showInfo={showInfo}
        onLaunch={launchSelectedGame}
        onOpenFolder={openSelectedFolder}
        onOpenProperties={openProperties}
        onRefreshMedia={refreshMetadataAndImages}
        onOpenWebsite={openWebsite}
        onRemoveTitle={removeTitleFromLibrary}
        onDeleteTitle={deleteTitleAndFiles}
        onToggleInfo={() => setShowInfo((s) => !s)}
      />

      {showInfo && (
        <InfoPanel
          infoRows={infoRows}
          latestVersion={latestVersion}
          isUpdateAvailable={game.isUpdateAvailable}
        />
      )}

      {/* Body */}
      <div className="p-6 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6">

        {/* Previews */}
        <section className="border border-border bg-secondary" style={{ padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <h2 className="text-lg font-semibold">Previews</h2>
            <span style={{ fontSize: 11, color: '#9ca3af' }}>{previews.length} available</span>
          </div>
          {previews.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {previews.map((preview, index) => (
                <div
                  key={`${preview}-${index}`}
                  className="border border-border overflow-hidden aspect-video cursor-pointer hover:border-accent transition-colors"
                  style={{ maxWidth: 600 }}
                  onClick={() => setLightboxIndex(index)}
                  title="Click to view"
                >
                  <img src={preview} alt={`Preview ${index + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </div>
              ))}
            </div>
          ) : (
            <div style={{ minHeight: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>
              No previews available
            </div>
          )}
        </section>

        {/* Sidebar */}
        <aside className="space-y-5">
          <section className="bg-secondary border border-border p-4">
            <h2 className="text-lg font-semibold mb-3">Versions</h2>
            {versionOptions.length > 0 ? (
              <div className="space-y-2">
                {versionOptions.map((version) => {
                  const isSelected = selectedVersion?.version === version.version && selectedVersion?.game_path === version.game_path
                  const installed = version.isInstalled !== false
                  return (
                    <button
                      key={`${version.version}-${version.game_path}`}
                      onClick={() => setSelectedVersion(version)}
                      className={`w-full text-left border p-3 transition-colors ${isSelected ? 'border-accent bg-selected' : 'border-border bg-primary hover:bg-selected'}`}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>
                          {isSelected && <i className="fas fa-play" style={{ fontSize: 9, color: 'var(--color-accent,#86a8e7)' }}></i>}
                          {version.version || 'Unknown version'}
                        </span>
                        <span style={{ fontSize: 11, color: installed ? '#86efac' : '#fca5a5' }}>{installed ? 'Installed' : 'Missing'}</span>
                      </div>
                      <div style={{ fontSize: 11, color: '#d1d5db', marginTop: 3 }}>{formatPlaytime(version.version_playtime)}</div>
                      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{version.game_path || 'No path set'}</div>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div style={{ color: '#9ca3af' }}>No versions recorded</div>
            )}
          </section>

          <section className="bg-secondary border border-border p-4">
            <h2 className="text-lg font-semibold mb-3">Details</h2>
            <div className="space-y-2 text-sm">
              {metadataRows.map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 6 }}>
                  <span style={{ color: '#9ca3af' }}>{label}</span>
                  <span style={{ textAlign: 'right' }}>{value}</span>
                </div>
              ))}
              {metadataRows.length === 0 && <div style={{ color: '#9ca3af' }}>No metadata available</div>}
            </div>
          </section>

          {externalLinks.length > 0 && (
            <section className="bg-secondary border border-border p-4">
              <h2 className="text-lg font-semibold mb-3">External Links</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {externalLinks.map((link) => (
                  <div key={link.key} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                    <i className={link.icon} style={{ width: 18, textAlign: 'center', color: '#9ca3af' }} aria-hidden="true"></i>
                    <span style={{ color: '#9ca3af', minWidth: 92 }}>{link.label}</span>
                    {link.url ? (
                      <a
                        href={link.url}
                        onClick={(e) => { e.preventDefault(); window.electronAPI.openExternalUrl(link.url) }}
                        className="text-accent hover:underline"
                        style={{ cursor: 'pointer', wordBreak: 'break-all' }}
                      >
                        {link.value}
                      </a>
                    ) : (
                      <span style={{ wordBreak: 'break-all' }}>{link.value}</span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {game.f95_tags && (
            <section className="bg-secondary border border-border p-4">
              <h2 className="text-lg font-semibold mb-3">Tags</h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {game.f95_tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 32).map((tag) => (
                  <span key={tag} className="bg-primary border border-border px-2 py-1 text-xs">{tag}</span>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>

      <PreviewLightbox
        previews={previews}
        lightboxIndex={lightboxIndex}
        onClose={() => setLightboxIndex(null)}
        onPrev={() => setLightboxIndex((i) => (i === null ? i : (i - 1 + previews.length) % previews.length))}
        onNext={() => setLightboxIndex((i) => (i === null ? i : (i + 1) % previews.length))}
      />
    </div>
  )
}

export default GameDetailPage
