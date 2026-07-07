import { useState, useEffect, useRef } from 'react'
import HeroBanner from './page/HeroBanner.jsx'
import ActionBar from './page/ActionBar.jsx'
import InfoPanel from './page/InfoPanel.jsx'
import PreviewLightbox from './page/PreviewLightbox.jsx'
import DetailPanelGrid, { normalizeDetailLayout } from './page/DetailPanelGrid.jsx'
import SafeImage from '../ui/SafeImage.jsx'
import {
  LAUNCH_STATE, filterOutBanner, formatPlaytime,
  sortVersionsDesc, getInstalledVersions, getDefaultVersion, isVideoUrl, formatReleaseDate,
  isSteamGame, getMappedSteamAppId, resolveDeveloper, formatLanguages, getCategoryIcon, splitCsv,
} from './page/gameDetailUtils.js'
import { buildExternalLinks } from './externalLinks.js'
import { toMediaSrc } from '../../utils/mediaSrc.js'

const isValidHttpUrl = (url) => /^https?:\/\//i.test(String(url || '').trim())
const isSteamInstallPath = (value) =>
  /(?:^|[\\/])steamapps[\\/]common(?:[\\/]|$)/i.test(String(value || ''))

const personalRatingFields = [
  ['story', 'Story', 'personalRatingStory'],
  ['graphics', 'Graphics', 'personalRatingGraphics'],
  ['gameplay', 'Gameplay', 'personalRatingGameplay'],
  ['fappability', 'Fappability', 'personalRatingFappability'],
]

const normalizeRatingInput = (value) => {
  if (value === undefined || value === null || value === '') return ''
  const number = Number(value)
  if (!Number.isFinite(number)) return ''
  return String(Math.max(0, Math.min(10, Math.round(number))))
}

const buildPersonalRatingsDraft = (game = {}) =>
  Object.fromEntries(
    personalRatingFields.map(([key, , gameKey]) => [key, normalizeRatingInput(game?.[gameKey])]),
  )

const getPersonalRatingsPayload = (draft = {}) =>
  Object.fromEntries(
    personalRatingFields.map(([key]) => [
      key,
      draft[key] === '' ? null : Math.max(0, Math.min(10, Math.round(Number(draft[key])))),
    ]),
  )

const getPersonalRatingsOverall = (draft = {}) => {
  const values = Object.values(getPersonalRatingsPayload(draft))
    .filter((value) => Number.isFinite(value))
  if (values.length === 0) return null
  const average = values.reduce((sum, value) => sum + value, 0) / values.length
  return Math.round(average * 10) / 10
}

const buildDetailExternalLinks = (game = {}, { hasSteamMapping = false } = {}) => {
  const links = []
  const siteUrl = String(game.siteUrl || game.site_url || '').trim()
  if (isValidHttpUrl(siteUrl)) {
    links.push({
      key: 'f95_thread',
      label: siteUrl.includes('lewdcorner.com') ? 'LewdCorner' : 'F95 Thread',
      value: siteUrl,
      url: siteUrl,
      icon: 'fas fa-comments',
    })
  }
  const lewdCornerUrl = String(game.lewdCornerSiteUrl || game.lewdcornerSiteUrl || '').trim()
  if (isValidHttpUrl(lewdCornerUrl) && !links.some((existing) => existing.url === lewdCornerUrl)) {
    links.push({
      key: 'lewdcorner',
      label: 'LewdCorner',
      value: lewdCornerUrl,
      url: lewdCornerUrl,
      icon: 'fas fa-link',
    })
  }
  for (const link of buildExternalLinks(game.external_ids)) {
    if (!hasSteamMapping && ['steam_appid', 'steam_id'].includes(String(link.key || '').toLowerCase())) continue
    if (link.url && !isValidHttpUrl(link.url)) continue
    if (link.url && links.some((existing) => existing.url === link.url)) continue
    links.push(link)
  }
  return links
}

const splitPreviewUrls = (value) => {
  if (Array.isArray(value)) return value.map((url) => String(url || '').trim()).filter(Boolean)
  return String(value || '').split(',').map((url) => url.trim()).filter(Boolean)
}

const getDetailTags = (game = {}) => {
  const seen = new Set()
  return [
    ...splitCsv(game.f95_tags),
    ...splitCsv(game.tags),
    ...splitCsv(game.lewdcornerTags || game.lewdcorner_tags),
  ].filter((tag) => {
    const key = tag.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const inferImportVersion = (game = {}, sourcePath = '') => {
  const name = String(sourcePath || '').split(/[\\/]/).pop() || ''
  const parent = String(sourcePath || '').split(/[\\/]/).slice(-2, -1)[0] || ''
  const candidates = [name.replace(/\.[^.]+$/, ''), parent, game.latestVersion, game.latest_version, game.version]
  const patterns = [
    /\bv(?:ersion)?[\s._-]*([0-9]+(?:[._-][0-9a-z]+){0,4})\b/i,
    /\b((?:ch|chapter)[\s._-]*[0-9]+[a-z]?)\b/i,
    /\b([0-9]+(?:\.[0-9a-z]+){1,4})\b/i,
  ]
  for (const candidate of candidates) {
    const value = String(candidate || '').trim()
    if (!value) continue
    for (const pattern of patterns) {
      const match = value.match(pattern)
      if (match?.[0]) return match[0]
    }
  }
  return String(game.latestVersion || game.latest_version || 'Unknown').trim() || 'Unknown'
}

const getDroppedPath = async (event) => {
  const files = Array.from(event.dataTransfer?.files || [])
  const items = Array.from(event.dataTransfer?.items || [])
  const file = files[0] || items.find((item) => item.kind === 'file')?.getAsFile?.()
  if (!file) return ''
  if (window.electronAPI.getDroppedFilePath) {
    return window.electronAPI.getDroppedFilePath(file)
  }
  return file.path || ''
}

const getArchiveSourceExtension = (sourcePath = '') => {
  const fileName = String(sourcePath || '').trim().split(/[\\/]/).pop() || ''
  const match = fileName.match(/\.([^.]+)$/)
  return match ? match[1].toLowerCase() : ''
}

const isArchiveSourcePath = (sourcePath = '', archiveExtensions = ['zip', '7z', 'rar']) => {
  const ext = getArchiveSourceExtension(sourcePath)
  return Boolean(ext && archiveExtensions.includes(ext))
}

const GameDetailPage = ({ game, onBack, onRefresh, onWishlistChanged }) => {
  const [previews, setPreviews] = useState([])
  const [previewsLoading, setPreviewsLoading] = useState(false)
  const [isWishlisted, setIsWishlisted] = useState(game?.isWishlisted === true || game?.isWishlistEntry === true)
  const [wishlistBusy, setWishlistBusy] = useState(false)
  const [isFavorite, setIsFavorite] = useState(game?.isFavorite === true || game?.is_favorite === 1)
  const [favoriteBusy, setFavoriteBusy] = useState(false)
  const [selectedVersion, setSelectedVersion] = useState(null)
  const [isRefreshingMedia, setIsRefreshingMedia] = useState(false)
  const [launchState, setLaunchState] = useState(LAUNCH_STATE.IDLE)
  const [lightboxIndex, setLightboxIndex] = useState(null)
  const [bannerMask, setBannerMask] = useState({ image: 'none', composite: null })
  const [catalogImportPath, setCatalogImportPath] = useState('')
  const [catalogImportVersion, setCatalogImportVersion] = useState('')
  const [catalogImportBusy, setCatalogImportBusy] = useState(false)
  const [catalogImportStatus, setCatalogImportStatus] = useState('')
  const [catalogImportError, setCatalogImportError] = useState('')
  const [catalogImportDragging, setCatalogImportDragging] = useState(false)
  const [catalogImportConflict, setCatalogImportConflict] = useState(null)
  const [catalogDeleteSourceArchive, setCatalogDeleteSourceArchive] = useState(false)
  const [localImportPath, setLocalImportPath] = useState('')
  const [localImportVersion, setLocalImportVersion] = useState('')
  const [localImportBusy, setLocalImportBusy] = useState(false)
  const [localImportStatus, setLocalImportStatus] = useState('')
  const [localImportError, setLocalImportError] = useState('')
  const [localImportDragging, setLocalImportDragging] = useState(false)
  const [localReplaceExisting, setLocalReplaceExisting] = useState(false)
  const [localReplaceVersionId, setLocalReplaceVersionId] = useState('')
  const [localDeleteSourceArchive, setLocalDeleteSourceArchive] = useState(false)
  const [showLocalImportPanel, setShowLocalImportPanel] = useState(false)
  const [localArchiveExtensions, setLocalArchiveExtensions] = useState(['zip', '7z', 'rar'])
  const [personalRatingsDraft, setPersonalRatingsDraft] = useState(() => buildPersonalRatingsDraft(game))
  const [personalRatingsSaved, setPersonalRatingsSaved] = useState(() => buildPersonalRatingsDraft(game))
  const [personalRatingsBusy, setPersonalRatingsBusy] = useState(false)
  const [personalRatingsError, setPersonalRatingsError] = useState('')
  // Customizable 3-column panel layout (shared across all games, saved to config
  // under Appearance.detailLayout). editingLayout toggles drag-and-drop.
  const [detailLayout, setDetailLayout] = useState({ columns: [[{ id: 'previews', span: 2 }], [], [{ id: 'versions', span: 1 }, { id: 'rating', span: 1 }, { id: 'details', span: 1 }, { id: 'links', span: 1 }, { id: 'tags', span: 1 }]] })
  const [editingLayout, setEditingLayout] = useState(false)
  // The About/description panel is hidden by default; toggled by the info
  // button in the action bar. Its Read More expansion is internal to the panel.
  const [showInfo, setShowInfo] = useState(false)
  // True once the sticky ActionBar has "stuck" (user scrolled past the hero).
  // Drives moving the Back button from the hero into the ActionBar.
  const [barStuck, setBarStuck] = useState(false)
  const isRunningRef  = useRef(false)
  const rootRef       = useRef(null)
  const stickySentinelRef = useRef(null)
  const bannerRef     = useRef(null)
  const bannerDimsRef = useRef(null)
  const browsePreviewCacheRef = useRef(new Map())
  // Tracks the record_id we've already applied the persisted selected version
  // for, so opening a different game (or the same game freshly) always restores
  // its own selected_version_id, while an in-session manual pick is preserved.
  const restoredSelectionForRecordRef = useRef(null)

  // ── Effects ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!game?.record_id) return
    const versions = game.versions || []
    const persisted = versions.find(
      (version) => Number(version.version_id) === Number(game.selected_version_id)
    )
    // When we haven't yet restored this record's selection (a freshly opened
    // game), apply the persisted selected_version_id. This runs again when the
    // fresh getGame data arrives (record_id unchanged but selected_version_id
    // now populated), so the correct version is restored even though the first
    // render used a stale library object.
    if (restoredSelectionForRecordRef.current !== game.record_id) {
      if (persisted) {
        restoredSelectionForRecordRef.current = game.record_id
        setSelectedVersion(persisted)
      } else if (Number(game.selected_version_id) > 0) {
        // selected_version_id is set but the fresh versions list hasn't arrived
        // yet — wait for it (don't mark restored, don't fall back to default).
        setSelectedVersion((current) => current || getDefaultVersion(versions))
      } else {
        // No persisted selection for this game — use the default.
        restoredSelectionForRecordRef.current = game.record_id
        setSelectedVersion((current) => current || getDefaultVersion(versions))
      }
    } else {
      // Same record, already restored: keep the user's current pick, just
      // re-resolve it against the latest versions array (e.g. after a refresh).
      setSelectedVersion((current) => {
        if (!current) return persisted || getDefaultVersion(versions)
        return versions.find(
          (v) => v.version === current.version && v.game_path === current.game_path
        ) || persisted || getDefaultVersion(versions)
      })
    }
    const loadPreviews = async () => {
      setPreviewsLoading(true)
      try {
        if (game.isCatalogEntry === true) {
          const cacheKey = `${game.atlas_id || ''}:${game.f95_id || ''}:${game.lc_id || game.lcId || ''}:${game.steam_id || game.steam_appid || ''}`
          if (browsePreviewCacheRef.current.has(cacheKey)) {
            setPreviews(filterOutBanner(browsePreviewCacheRef.current.get(cacheKey), game.banner_url))
            return
          }
          const urls = await window.electronAPI.getBrowsePreviewUrls?.({
            atlas_id: game.atlas_id,
            f95_id: game.f95_id,
            lc_id: game.lc_id || game.lcId,
            steam_id: game.steam_id || game.steam_appid,
          })
          const safeUrls = Array.isArray(urls) ? urls : []
          const snapshotPreviews = splitPreviewUrls(game.preview_urls || game.previewUrls)
          const resolvedUrls = safeUrls.length > 0 ? safeUrls : snapshotPreviews
          browsePreviewCacheRef.current.set(cacheKey, resolvedUrls)
          setPreviews(filterOutBanner(resolvedUrls, game.banner_url))
          return
        }
        const urls = await window.electronAPI.getPreviews(game.record_id)
        setPreviews(filterOutBanner(urls, game.banner_url))
      } catch (err) {
        console.error('Failed to load previews:', err)
        setPreviews([])
      } finally {
        setPreviewsLoading(false)
      }
    }
    loadPreviews()
  }, [game?.record_id, game?.versions, game?.selected_version_id, game?.banner_url, game?.isCatalogEntry, game?.atlas_id, game?.f95_id, game?.lc_id, game?.lcId, game?.steam_id])

  useEffect(() => {
    setLaunchState(LAUNCH_STATE.IDLE)
    setShowInfo(false)
    setLightboxIndex(null)
    setIsWishlisted(game?.isWishlisted === true || game?.isWishlistEntry === true)
    setIsFavorite(game?.isFavorite === true || game?.is_favorite === 1)
    setCatalogImportPath('')
    setCatalogImportVersion(String(game?.latestVersion || game?.latest_version || 'Unknown').trim() || 'Unknown')
    setCatalogImportStatus('')
    setCatalogImportError('')
    setCatalogImportDragging(false)
    setCatalogImportConflict(null)
    setLocalImportPath('')
    setLocalImportVersion('')
    setLocalImportStatus('')
    setLocalImportError('')
    setLocalImportDragging(false)
    setLocalReplaceExisting(false)
    setLocalReplaceVersionId('')
    setLocalDeleteSourceArchive(false)
    setShowLocalImportPanel(false)
    const nextRatings = buildPersonalRatingsDraft(game)
    setPersonalRatingsDraft(nextRatings)
    setPersonalRatingsSaved(nextRatings)
    setPersonalRatingsError('')
    setPersonalRatingsBusy(false)
    isRunningRef.current = false
  }, [
    game?.record_id,
    game?.isWishlisted,
    game?.isWishlistEntry,
    game?.isFavorite,
    game?.is_favorite,
    game?.personalRatingStory,
    game?.personalRatingGraphics,
    game?.personalRatingGameplay,
    game?.personalRatingFappability,
  ])

  useEffect(() => {
    let canceled = false
    const loadImportConfig = async () => {
      try {
        const config = await window.electronAPI.getConfig?.()
        const extensions = String(config?.Library?.extractionExtensions || 'zip,7z,rar')
          .split(',')
          .map((ext) => ext.trim().toLowerCase().replace(/^\./, ''))
          .filter(Boolean)
        if (!canceled && extensions.length > 0) setLocalArchiveExtensions(extensions)
        // Load the shared detail-panel layout.
        try {
          const raw = config?.Appearance?.detailLayout
          if (raw && !canceled) {
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
            if (parsed && (Array.isArray(parsed.items) || Array.isArray(parsed.columns))) setDetailLayout(parsed)
          }
        } catch (err) {
          console.warn('Failed to parse detail layout:', err)
        }
      } catch (err) {
        console.warn('Failed to load archive extensions:', err)
      }
    }
    loadImportConfig()
    return () => { canceled = true }
  }, [])

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

  // Detect when the sticky ActionBar has stuck: a zero-height sentinel sits just
  // above the bar; once it scrolls out of the top of the scroll viewport, the
  // bar is pinned and we move the Back button into it.
  useEffect(() => {
    const sentinel = stickySentinelRef.current
    if (!sentinel || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([entry]) => setBarStuck(!entry.isIntersecting),
      { threshold: 0 },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [game?.record_id])

  useEffect(() => {
    if (!game?.record_id) return
    const handleGameUpdated = (event, payload) => {
      const updatedId = typeof payload === 'object' ? payload?.record_id : payload
      if (updatedId !== game.record_id) return
      if (isRunningRef.current) {
        isRunningRef.current = false
        setLaunchState(LAUNCH_STATE.IDLE)
      }
      onRefresh?.(game.record_id)
    }
    const removeListener = window.electronAPI.onGameUpdated(handleGameUpdated)
    return () => {
      if (typeof removeListener === 'function') removeListener()
      else window.electronAPI.removeAllListeners?.('game-updated')
    }
  }, [game?.record_id, onRefresh])

  // ── Derived state ─────────────────────────────────────────────────────────
  const installedVersions = getInstalledVersions(game.versions || [])
  const actionVersion = selectedVersion || getDefaultVersion(installedVersions)
  const canManageLocalTitle = game.isMetadataOnly !== true && game.isCatalogEntry !== true
  const canManageFavorite = canManageLocalTitle && Boolean(Number.parseInt(game.record_id, 10) > 0)
  const canManagePersonalRatings = canManageFavorite
  const canManageWishlist = game.isCatalogEntry === true || game.isWishlistEntry === true
  const canLaunch = Boolean(
    actionVersion &&
    actionVersion.isInstalled !== false &&
    (actionVersion.exec_path || isSteamInstallPath(actionVersion.game_path)),
  )
  const canInstallFromDetail = !canLaunch && (canManageWishlist || canManageLocalTitle || game.hasInstalledVersion === false)
  const importPanelMode = canManageWishlist ? 'catalog' : 'local'
  const canOpenFolder = Boolean(actionVersion?.game_path && actionVersion.isInstalled !== false)
  const latestVersion = game.latestVersion || game.latest_version || ''
  const versionOptions = sortVersionsDesc(game.versions || [])

  const steamAppId = getMappedSteamAppId(game)
  const steam = isSteamGame(game)
  const developer = resolveDeveloper(game)
  const categories = splitCsv(game.category)
  const detailTags = getDetailTags(game)
  const totalTitlePlaytime = game.totalPlaytime ?? game.total_playtime

  // Comprehensive Details card. Only known fields render (empties filtered).
  // Rules: collapse long language lists; hide Translations for Steam (its
  // language list already covers it); Category renders specially for Steam.
  const metadataRows = [
    ['Total Playtime', formatPlaytime(totalTitlePlaytime)],
    ['Developer', developer],
    ['Publisher', game.publisher],
    ['Release Date', formatReleaseDate(game)],
    ['Status', game.status],
    ['Engine', game.engine],
    ['Genre', game.genre],
    ['Language', formatLanguages(game.language)],
    ...(steam ? [] : [['Translations', game.translations]]),
    ['Voice', game.voice],
    ['OS', game.os],
    ['Censored', game.censored],
    ['Rating', game.rating || game.lewdcornerRating],
    ['Likes', game.likes || game.lewdcornerLikes],
    ['Views', game.views || game.lewdcornerViews],
    ['LewdCorner Tier', game.lewdcornerTier],
    ['LewdCorner Prefixes', game.lewdcornerPrefixes],
    // Non-steam category stays a normal inline row; steam renders as a list.
    ...(steam ? [] : [['Category', game.category]]),
  ].filter(([, v]) => v !== undefined && v !== null && v !== '')

  const localVersion = actionVersion?.version || selectedVersion?.version || game.versions?.[0]?.version || game.version || ''
  const localImportIsArchive = isArchiveSourcePath(localImportPath, localArchiveExtensions)

  const externalLinks = buildDetailExternalLinks(game, { hasSteamMapping: Boolean(steamAppId) })
  const personalRatingsDirty = JSON.stringify(personalRatingsDraft) !== JSON.stringify(personalRatingsSaved)
  const personalRatingsOverall = getPersonalRatingsOverall(personalRatingsDraft)

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

  const openProperties = async () => {
    if (!canManageLocalTitle) return
    await window.electronAPI.openGameProperties(game.record_id)
  }
  const openWebsite = async () => { if (game.siteUrl) await window.electronAPI.openExternalUrl(game.siteUrl) }
  const openSteam = steamAppId
    ? async () => { await window.electronAPI.openExternalUrl(`steam://nav/games/details/${steamAppId}`) }
    : null
  const uninstallSteam = steamAppId && canManageLocalTitle
    ? async () => {
        const confirmed = window.confirm(
          `Ask Steam to uninstall "${game.title}"?\n\nAtlas will keep this title and its metadata. Atlas local files are not deleted by this action.`,
        )
        if (!confirmed) return
        await window.electronAPI.openExternalUrl(`steam://uninstall/${steamAppId}`)
      }
    : null

  const chooseDefaultReplaceVersionId = (nextVersion = localImportVersion) => {
    const versions = game.versions || []
    if (versions.length === 0) return ''
    const normalized = String(nextVersion || '').trim().toLowerCase()
    const matching = versions.find((version) => String(version.version || '').trim().toLowerCase() === normalized)
    const current = selectedVersion
      ? versions.find((version) => version.version_id === selectedVersion.version_id || (version.version === selectedVersion.version && version.game_path === selectedVersion.game_path))
      : null
    return String((matching || current || versions[0])?.version_id || '')
  }

  const chooseLocalImportSource = async () => {
    if (!canManageLocalTitle || !window.electronAPI.selectCatalogImportSource) return
    const selectedPath = await window.electronAPI.selectCatalogImportSource()
    if (!selectedPath) return
    const inferred = inferImportVersion(game, selectedPath)
    setLocalImportPath(selectedPath)
    setLocalImportVersion((current) => current || inferred)
    if (!isArchiveSourcePath(selectedPath, localArchiveExtensions)) setLocalDeleteSourceArchive(false)
    if (localReplaceExisting && !localReplaceVersionId) setLocalReplaceVersionId(chooseDefaultReplaceVersionId(inferred))
    setLocalImportError('')
  }

  const runLocalImport = async () => {
    const sourcePath = localImportPath
    const version = String(localImportVersion || inferImportVersion(game, sourcePath)).trim()
    if (!sourcePath) {
      setLocalImportError('Choose a game folder, archive, or executable first.')
      return
    }
    if (!version) {
      setLocalImportError('Version is required.')
      return
    }
    if (localReplaceExisting && !localReplaceVersionId) {
      setLocalImportError('Choose the version to replace.')
      return
    }
    setLocalImportBusy(true)
    setLocalImportError('')
    setLocalImportStatus(localReplaceExisting ? 'Replacing version...' : 'Importing new version...')
    try {
      const result = await window.electronAPI.importLocalGameVersion?.({
        recordId: game.record_id,
        sourcePath,
        version,
        replaceExisting: localReplaceExisting,
        replaceVersionId: localReplaceExisting ? localReplaceVersionId : null,
        deleteSourceArchiveAfterImport: localDeleteSourceArchive && localImportIsArchive,
      })
      if (!result?.success) throw new Error(result?.error || 'Import failed')
      setLocalImportPath('')
      setLocalDeleteSourceArchive(false)
      const messages = [`${result.replaced ? 'Replaced' : 'Imported'} ${result.version || version}.`]
      if (result.oldVersionDeleted) messages.push('Old version files deleted.')
      if (result.sourceArchiveDeleted) messages.push('Source archive deleted.')
      const warnings = [result.oldVersionDeleteError, result.sourceArchiveDeleteError].filter(Boolean)
      setLocalImportStatus([...messages, ...warnings.map((warning) => `Warning: ${warning}`)].join(' '))
      if (warnings.length === 0) setShowLocalImportPanel(false)
      onRefresh?.(game.record_id)
    } catch (err) {
      setLocalImportStatus('')
      setLocalImportError(err.message || String(err))
    } finally {
      setLocalImportBusy(false)
    }
  }

  const handleLocalDrop = async (event) => {
    event.preventDefault()
    setLocalImportDragging(false)
    const droppedPath = await getDroppedPath(event)
    if (!droppedPath) {
      setLocalImportError('Atlas could not read the dropped file path. Try using Import Files instead.')
      return
    }
    const inferred = inferImportVersion(game, droppedPath)
    setLocalImportPath(droppedPath)
    setLocalImportVersion((current) => current || inferred)
    if (!isArchiveSourcePath(droppedPath, localArchiveExtensions)) setLocalDeleteSourceArchive(false)
    if (localReplaceExisting && !localReplaceVersionId) setLocalReplaceVersionId(chooseDefaultReplaceVersionId(inferred))
    setLocalImportError('')
  }

  const chooseCatalogImportSource = async () => {
    if (!canManageWishlist || !window.electronAPI.selectCatalogImportSource) return
    const selectedPath = await window.electronAPI.selectCatalogImportSource()
    if (!selectedPath) return
    setCatalogImportPath(selectedPath)
    setCatalogImportVersion((current) => current || inferImportVersion(game, selectedPath))
    if (!isArchiveSourcePath(selectedPath, localArchiveExtensions)) setCatalogDeleteSourceArchive(false)
    setCatalogImportError('')
    setCatalogImportConflict(null)
  }

  const runCatalogImport = async (options = {}) => {
    const sourcePath = options.sourcePath || catalogImportPath
    const version = String(options.version || catalogImportVersion || inferImportVersion(game, sourcePath)).trim()
    if (!sourcePath) {
      setCatalogImportError('Choose a game folder, archive, or executable first.')
      return
    }
    if (!version) {
      setCatalogImportError('Version is required.')
      return
    }
    setCatalogImportBusy(true)
    setCatalogImportError('')
    setCatalogImportStatus('Importing this title...')
    setCatalogImportConflict(null)
    try {
      const result = await window.electronAPI.importCatalogEntry?.({
        catalog: game,
        sourcePath,
        version,
        conflictMode: options.conflictMode || 'check',
        deleteSourceArchiveAfterImport: catalogDeleteSourceArchive && isArchiveSourcePath(sourcePath, localArchiveExtensions),
      })
      if (result?.conflict) {
        const suggested = result.suggestedVersion || `${version} (2)`
        setCatalogImportVersion(suggested)
        setCatalogImportStatus('')
        setCatalogImportConflict({ sourcePath, version, suggestedVersion: suggested })
        return
      }
      if (!result?.success) throw new Error(result?.error || 'Import failed')
      setCatalogImportPath('')
      setCatalogDeleteSourceArchive(false)
      setCatalogImportStatus([
        `Imported ${result.version || version} into the Library.`,
        result.sourceArchiveDeleted ? 'Source archive deleted.' : '',
        result.sourceArchiveDeleteError ? `Warning: ${result.sourceArchiveDeleteError}` : '',
      ].filter(Boolean).join(' '))
      setShowLocalImportPanel(false)
      onRefresh?.(result.recordId)
    } catch (err) {
      setCatalogImportStatus('')
      setCatalogImportError(err.message || String(err))
    } finally {
      setCatalogImportBusy(false)
    }
  }

  const handleCatalogDrop = async (event) => {
    event.preventDefault()
    setCatalogImportDragging(false)
    const droppedPath = await getDroppedPath(event)
    if (!droppedPath) {
      setCatalogImportError('Atlas could not read the dropped file path. Try using Import Files instead.')
      return
    }
    setCatalogImportPath(droppedPath)
    setCatalogImportVersion((current) => current || inferImportVersion(game, droppedPath))
    if (!isArchiveSourcePath(droppedPath, localArchiveExtensions)) setCatalogDeleteSourceArchive(false)
    setCatalogImportError('')
    setCatalogImportConflict(null)
  }

  const toggleWishlist = async () => {
    if (!canManageWishlist || wishlistBusy) return
    setWishlistBusy(true)
    try {
      const result = isWishlisted
        ? await window.electronAPI.removeWishlistEntry?.(game)
        : await window.electronAPI.toggleWishlistEntry?.(game)
      if (!result?.success) {
        if (result?.inLibrary) {
          alert('This title is already in your Library.')
          return
        }
        throw new Error(result?.error || 'Wishlist update failed')
      }
      const nextWishlisted = result.isWishlisted !== false
      setIsWishlisted(nextWishlisted)
      await onWishlistChanged?.({ ...result, isWishlisted: nextWishlisted }, game)
    } catch (err) {
      console.error('Failed to update wishlist:', err)
      alert(`Failed to update Wishlist: ${err.message || err}`)
    } finally {
      setWishlistBusy(false)
    }
  }

  const toggleFavorite = async () => {
    if (!canManageFavorite || favoriteBusy) return
    const nextFavorite = !isFavorite
    setFavoriteBusy(true)
    setIsFavorite(nextFavorite)
    try {
      const result = await window.electronAPI.setGameFavorite?.(game.record_id, nextFavorite)
      if (!result?.success) throw new Error(result?.error || 'Favorite update failed')
      setIsFavorite(result.isFavorite === true)
      onRefresh?.(game.record_id)
    } catch (err) {
      setIsFavorite(!nextFavorite)
      console.error('Failed to update favorite:', err)
      alert(`Failed to update Favorite: ${err.message || err}`)
    } finally {
      setFavoriteBusy(false)
    }
  }

  const updatePersonalRatingDraft = (field, value) => {
    setPersonalRatingsError('')
    setPersonalRatingsDraft((current) => ({
      ...current,
      [field]: normalizeRatingInput(value),
    }))
  }

  const savePersonalRatings = async () => {
    if (!canManagePersonalRatings || personalRatingsBusy || !personalRatingsDirty) return
    setPersonalRatingsBusy(true)
    setPersonalRatingsError('')
    try {
      const payload = getPersonalRatingsPayload(personalRatingsDraft)
      const result = await window.electronAPI.setGamePersonalRatings?.(game.record_id, payload)
      if (!result?.success) throw new Error(result?.error || 'Personal rating update failed')
      const saved = {
        story: normalizeRatingInput(result.personalRatingStory),
        graphics: normalizeRatingInput(result.personalRatingGraphics),
        gameplay: normalizeRatingInput(result.personalRatingGameplay),
        fappability: normalizeRatingInput(result.personalRatingFappability),
      }
      setPersonalRatingsDraft(saved)
      setPersonalRatingsSaved(saved)
      onRefresh?.(game.record_id)
    } catch (err) {
      console.error('Failed to update personal ratings:', err)
      setPersonalRatingsError(err.message || 'Failed to update personal ratings')
    } finally {
      setPersonalRatingsBusy(false)
    }
  }

  const removeTitleFromLibrary = async () => {
    if (!canManageLocalTitle) return
    if (!window.confirm(`Remove "${game.title}" from the local library?\n\nGame files will be kept on disk.`)) return
    const result = await window.electronAPI.deleteTitle({ recordId: game.record_id, deleteFiles: false })
    if (!result.success) { alert(`Failed to remove title: ${result.error || 'Unknown error'}`); return }
    onBack?.()
  }

  const deleteTitleAndFiles = async () => {
    if (!canManageLocalTitle) return
    const versionPaths = (game.versions || []).map((v) => v.game_path).filter(Boolean)
    const pathList = versionPaths.length ? `\n\nFolders to delete:\n${versionPaths.join('\n')}` : '\n\nNo linked folders were found.'
    if (!window.confirm(`Delete "${game.title}" and all linked files from disk?${pathList}\n\nThis cannot be undone.`)) return
    const result = await window.electronAPI.deleteTitle({ recordId: game.record_id, deleteFiles: true })
    if (!result.success) { alert(`Failed to delete title: ${result.error || 'Unknown error'}`); return }
    onBack?.()
  }

  const refreshMetadataAndImages = async () => {
    if (!game?.record_id || !canManageLocalTitle || isRefreshingMedia) return
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

  const selectVersion = async (version) => {
    setSelectedVersion(version)
    // A manual pick counts as this record's restored selection so the restore
    // effect preserves it on subsequent re-renders.
    if (game?.record_id) restoredSelectionForRecordRef.current = game.record_id
    if (!canManageLocalTitle || !game?.record_id || !version?.version_id) return
    const result = await window.electronAPI.setSelectedGameVersion(
      game.record_id,
      version.version_id,
    )
    if (result?.success === false) {
      console.error('Failed to save selected version:', result.error)
    }
  }

  // Persist the shared detail-panel layout to config (Appearance.detailLayout).
  const handleLayoutChange = async (nextLayout) => {
    setDetailLayout(nextLayout)
    try {
      const config = await window.electronAPI.getConfig()
      const newConfig = {
        ...config,
        Appearance: { ...config.Appearance, detailLayout: JSON.stringify(nextLayout) },
      }
      const result = await window.electronAPI.saveSettings(newConfig)
      if (result?.success === false) console.error('Failed to save detail layout:', result.error)
    } catch (err) {
      console.error('Failed to save detail layout:', err)
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
        showBack={!barStuck}
      />

      {Number(game?.atlas_removed_from_server) > 0 && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded border border-warning/50 bg-warning/10 px-3 py-2 text-sm text-warning">
          <i className="fas fa-triangle-exclamation mt-0.5"></i>
          <span>
            This game is no longer listed in the Atlas database. Your local copy and metadata have been kept,
            but it won&apos;t receive further metadata updates.
          </span>
        </div>
      )}

      {/* Sentinel for sticky detection — sits just above the action bar. */}
      <div ref={stickySentinelRef} style={{ height: 0 }} aria-hidden="true" />

      <ActionBar
        game={game}
        actionVersion={actionVersion}
        latestVersion={latestVersion}
        canLaunch={canLaunch}
        canOpenFolder={canOpenFolder}
        canInstallFromDetail={canInstallFromDetail}
        canManageWishlist={canManageWishlist}
        isWishlisted={isWishlisted}
        wishlistBusy={wishlistBusy}
        canManageFavorite={canManageFavorite}
        isFavorite={isFavorite}
        favoriteBusy={favoriteBusy}
        launchState={launchState}
        isRefreshingMedia={isRefreshingMedia}
        canManageLocalTitle={canManageLocalTitle}
        onLaunch={launchSelectedGame}
        onOpenFolder={openSelectedFolder}
        onOpenProperties={openProperties}
        onToggleWishlist={toggleWishlist}
        onToggleFavorite={toggleFavorite}
        onRefreshMedia={refreshMetadataAndImages}
        onOpenWebsite={openWebsite}
        onOpenSteam={openSteam}
        onUninstallSteam={uninstallSteam}
        onToggleLocalImport={() => setShowLocalImportPanel((value) => !value)}
        onRemoveTitle={removeTitleFromLibrary}
        onDeleteTitle={deleteTitleAndFiles}
        onBack={onBack}
        showBack={barStuck}
        editingLayout={editingLayout}
        onToggleEditLayout={() => setEditingLayout((v) => !v)}
        showInfo={showInfo}
        onToggleInfo={() => setShowInfo((s) => !s)}
      />

      {(canManageLocalTitle || canManageWishlist) && showLocalImportPanel && (
        <section className="mx-6 mt-3 border border-border bg-secondary p-4">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
            <div>
              <h2 className="text-base font-semibold">{importPanelMode === 'catalog' ? 'Install / Import Files' : 'Update / Import Files'}</h2>
              <p style={{ color: 'var(--color-muted)', fontSize: 12 }}>
                {importPanelMode === 'catalog'
                  ? 'Drop a folder, archive, or executable here to install this title into your Library.'
                  : 'Drop a folder, archive, or executable here to add or replace files for this Library title.'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {game.siteUrl && (
                <button
                  onClick={openWebsite}
                  disabled={localImportBusy || catalogImportBusy}
                  className="bg-primary border border-border px-3 py-2 hover:bg-selected disabled:opacity-60"
                >
                  Open update page
                </button>
              )}
              <button
                onClick={() => setShowLocalImportPanel(false)}
                disabled={localImportBusy || catalogImportBusy}
                className="bg-primary border border-border px-3 py-2 hover:bg-selected disabled:opacity-60"
                title="Close"
              >
                <i className="fas fa-times" style={{ fontSize: 12 }}></i>
              </button>
            </div>
          </div>
          <div
            onDragOver={(event) => {
              event.preventDefault()
              if (importPanelMode === 'catalog') setCatalogImportDragging(true)
              else setLocalImportDragging(true)
            }}
            onDragLeave={() => {
              setCatalogImportDragging(false)
              setLocalImportDragging(false)
            }}
            onDrop={importPanelMode === 'catalog' ? handleCatalogDrop : handleLocalDrop}
            className={`border border-dashed p-4 transition-colors ${
              (importPanelMode === 'catalog' ? catalogImportDragging : localImportDragging)
                ? 'border-accent bg-selected'
                : 'border-border bg-primary'
            }`}
            style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 160px auto', gap: 10, alignItems: 'center' }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {(importPanelMode === 'catalog' ? catalogImportPath : localImportPath) || 'No source selected'}
              </div>
              <div style={{ color: 'var(--color-muted)', fontSize: 12 }}>
                Accepted: folder, .zip, .7z, .rar, or launchable file.
              </div>
            </div>
            <input
              value={importPanelMode === 'catalog' ? catalogImportVersion : localImportVersion}
              onChange={(event) => {
                if (importPanelMode === 'catalog') setCatalogImportVersion(event.target.value)
                else setLocalImportVersion(event.target.value)
              }}
              disabled={localImportBusy || catalogImportBusy}
              className="bg-secondary border border-border p-2"
              placeholder="Version"
            />
            <button
              onClick={importPanelMode === 'catalog' ? chooseCatalogImportSource : chooseLocalImportSource}
              disabled={localImportBusy || catalogImportBusy}
              className="bg-primary border border-border px-3 py-2 hover:bg-selected disabled:opacity-60"
            >
              Choose
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
            {importPanelMode === 'local' && (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={localReplaceExisting}
                    onChange={(event) => {
                      const checked = event.target.checked
                      setLocalReplaceExisting(checked)
                      if (checked && !localReplaceVersionId) setLocalReplaceVersionId(chooseDefaultReplaceVersionId())
                    }}
                    disabled={localImportBusy || (game.versions || []).length === 0}
                  />
                  Replace existing version
                </label>
                {localReplaceExisting && (
                  <select
                    value={localReplaceVersionId}
                    onChange={(event) => setLocalReplaceVersionId(event.target.value)}
                    disabled={localImportBusy}
                    className="bg-primary border border-border p-2"
                    style={{ minWidth: 260 }}
                  >
                    {(game.versions || []).map((version) => (
                      <option key={version.version_id || `${version.version}-${version.game_path}`} value={String(version.version_id || '')}>
                        {version.version || 'Unknown version'} - {version.game_path || 'No path set'}
                      </option>
                    ))}
                  </select>
                )}
                {localImportIsArchive && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={localDeleteSourceArchive}
                      onChange={(event) => setLocalDeleteSourceArchive(event.target.checked)}
                      disabled={localImportBusy}
                    />
                    Delete source archive after successful import
                  </label>
                )}
              </>
            )}
            {importPanelMode === 'catalog' && isArchiveSourcePath(catalogImportPath, localArchiveExtensions) && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={catalogDeleteSourceArchive}
                  onChange={(event) => setCatalogDeleteSourceArchive(event.target.checked)}
                  disabled={catalogImportBusy}
                />
                Delete source archive after successful import
              </label>
            )}
            <button
              onClick={importPanelMode === 'catalog' ? () => runCatalogImport() : runLocalImport}
              disabled={importPanelMode === 'catalog' ? (catalogImportBusy || !catalogImportPath) : (localImportBusy || !localImportPath)}
              className="bg-accent px-4 py-2 hover:bg-accentHover disabled:opacity-60"
            >
              {localImportBusy || catalogImportBusy ? 'Importing...' : 'Import'}
            </button>
          </div>
          {importPanelMode === 'local' && localReplaceExisting && (
            <div style={{ color: 'var(--color-muted)', fontSize: 12, marginTop: 6 }}>
              Old version files will be deleted after the replacement succeeds. If deletion fails, Atlas will keep the import and show a warning.
            </div>
          )}
          {catalogImportConflict && (
            <div className="border border-border bg-primary p-3" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 10 }}>
              <div style={{ color: 'var(--color-warning)', fontSize: 12 }}>
                Version "{catalogImportConflict.version}" already exists for this title.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => runCatalogImport({
                    sourcePath: catalogImportConflict.sourcePath,
                    version: catalogImportConflict.suggestedVersion,
                    conflictMode: 'unique',
                  })}
                  disabled={catalogImportBusy}
                  className="bg-accent px-3 py-2 hover:bg-accentHover disabled:opacity-60"
                >
                  Use {catalogImportConflict.suggestedVersion}
                </button>
                <button
                  onClick={() => {
                    setCatalogImportConflict(null)
                    setCatalogImportError('Import canceled because that version already exists.')
                  }}
                  disabled={catalogImportBusy}
                  className="bg-primary border border-border px-3 py-2 hover:bg-selected disabled:opacity-60"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {importPanelMode === 'catalog' && catalogImportStatus && <div style={{ color: 'var(--color-success)', fontSize: 12, marginTop: 8 }}>{catalogImportStatus}</div>}
          {importPanelMode === 'catalog' && catalogImportError && <div style={{ color: 'var(--color-danger)', fontSize: 12, marginTop: 8 }}>{catalogImportError}</div>}
          {importPanelMode === 'local' && localImportStatus && <div style={{ color: localImportStatus.includes('Warning:') ? 'var(--color-warning)' : 'var(--color-success)', fontSize: 12, marginTop: 8 }}>{localImportStatus}</div>}
          {importPanelMode === 'local' && localImportError && <div style={{ color: 'var(--color-danger)', fontSize: 12, marginTop: 8 }}>{localImportError}</div>}
        </section>
      )}

      {(canManageLocalTitle || canManageWishlist) && !showLocalImportPanel && (localImportStatus || localImportError || catalogImportStatus || catalogImportError) && (
        <div className="mx-6 mt-3 border border-border bg-secondary px-3 py-2" style={{ color: localImportError || catalogImportError ? 'var(--color-danger)' : localImportStatus.includes('Warning:') ? 'var(--color-warning)' : 'var(--color-success)', fontSize: 12 }}>
          {localImportError || catalogImportError || localImportStatus || catalogImportStatus}
        </div>
      )}

      {showInfo && (
        <InfoPanel
          game={game}
          latestVersion={latestVersion}
          isUpdateAvailable={game.isUpdateAvailable}
        />
      )}

      {/* Body — customizable 3-column panel grid (task: drag & drop). The
          previews/versions/rating/details/links/tags sections are panels;
          each is only included when it has content. */}
      <div className="p-6">
        {editingLayout && (
          <div className="mb-4 flex items-center gap-2 rounded border border-accent/50 bg-accent/10 px-3 py-2 text-sm">
            <i className="fas fa-up-down-left-right text-accent" aria-hidden="true"></i>
            <span className="flex-1">Editing layout — drag panels between the three columns. Changes save automatically.</span>
            <button onClick={() => setEditingLayout(false)} className="px-3 py-1 rounded bg-accent text-white hover:bg-accentHover">Done</button>
          </div>
        )}
        <DetailPanelGrid
          layout={detailLayout}
          editing={editingLayout}
          onLayoutChange={handleLayoutChange}
          panels={{
            previews: (
              <section className="border border-border bg-secondary" style={{ padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <h2 className="text-lg font-semibold">Previews</h2>
                  <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>{previews.length} available</span>
                </div>
                {previews.length > 0 ? (
                  <div
                    className="grid gap-3"
                    style={{ gridTemplateColumns: `repeat(${Math.min(4, Math.max(1, previews.length))}, minmax(0, 1fr))` }}
                  >
                    {previews.map((preview, index) => (
                      <div
                        key={`${preview}-${index}`}
                        className="border border-border overflow-hidden aspect-video cursor-pointer hover:border-accent transition-colors relative"
                        onClick={() => setLightboxIndex(index)}
                        title={isVideoUrl(preview) ? 'Play trailer' : 'Click to view'}
                      >
                        {isVideoUrl(preview) ? (
                          <>
                            <video src={toMediaSrc(preview)} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', background: '#000' }} />
                            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.25)', pointerEvents: 'none' }}>
                              <i className="fas fa-play-circle" style={{ fontSize: 44, color: 'rgba(255,255,255,0.92)', filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.6))' }}></i>
                            </div>
                          </>
                        ) : (
                          <SafeImage
                            src={preview}
                            alt={`Preview ${index + 1}`}
                            fallbackLabel="Preview unavailable"
                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ minHeight: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-muted)' }}>
                    {previewsLoading ? 'Loading previews...' : 'No previews available'}
                  </div>
                )}
              </section>
            ),
            versions: (
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
                          onClick={() => selectVersion(version)}
                          className={`w-full text-left border p-3 transition-colors ${isSelected ? 'border-accent bg-selected' : 'border-border bg-primary hover:bg-selected'}`}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                            <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>
                              {isSelected && <i className="fas fa-play" style={{ fontSize: 9, color: 'var(--color-accent,#86a8e7)' }}></i>}
                              {version.version || 'Unknown version'}
                            </span>
                            <span style={{ fontSize: 11, color: installed ? 'var(--color-success)' : 'var(--color-danger)' }}>{installed ? 'Installed' : 'Missing'}</span>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--color-text)', marginTop: 3 }}>{formatPlaytime(version.version_playtime)}</div>
                          <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{version.game_path || 'No path set'}</div>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <div style={{ color: 'var(--color-muted)' }}>No versions recorded</div>
                )}
              </section>
            ),
            rating: canManagePersonalRatings ? (
              <section className="bg-secondary border border-border p-4">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                  <h2 className="text-lg font-semibold">Personal Rating</h2>
                  <span style={{ color: personalRatingsOverall === null ? 'var(--color-muted)' : 'var(--color-warning)', fontWeight: 700 }}>
                    {personalRatingsOverall === null ? 'Unrated' : `${personalRatingsOverall}/10`}
                  </span>
                </div>
                <div className="space-y-2">
                  {personalRatingFields.map(([key, label]) => (
                    <label key={key} className="text-sm" style={{ display: 'grid', gridTemplateColumns: '1fr 72px', gap: 10, alignItems: 'center' }}>
                      <span style={{ color: 'var(--color-text)' }}>{label}</span>
                      <input
                        type="number"
                        min="0"
                        max="10"
                        step="1"
                        value={personalRatingsDraft[key]}
                        onChange={(event) => updatePersonalRatingDraft(key, event.target.value)}
                        placeholder="-"
                        className="bg-primary border border-border px-2 py-1 text-sm text-right"
                      />
                    </label>
                  ))}
                </div>
                {personalRatingsError && (
                  <div className="text-xs text-danger mt-3">{personalRatingsError}</div>
                )}
                <button
                  type="button"
                  onClick={savePersonalRatings}
                  disabled={!personalRatingsDirty || personalRatingsBusy}
                  className="mt-3 w-full px-3 py-2 rounded text-sm bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:hover:bg-accent"
                >
                  {personalRatingsBusy ? 'Saving...' : personalRatingsDirty ? 'Save ratings' : 'Ratings saved'}
                </button>
              </section>
            ) : null,
            details: (
              <section className="bg-secondary border border-border p-4">
                <h2 className="text-lg font-semibold mb-3">Details</h2>
                <div className="space-y-2 text-sm">
                  {metadataRows.map(([label, value]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 6 }}>
                      <span style={{ color: 'var(--color-muted)', flexShrink: 0 }}>{label}</span>
                      <span style={{ textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{String(value)}</span>
                    </div>
                  ))}

                  {steam && categories.length > 0 && (
                    <div style={{ paddingTop: 4 }}>
                      <div style={{ color: 'var(--color-muted)', marginBottom: 6 }}>Category</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {categories.map((cat) => (
                          <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                            <i className={getCategoryIcon(cat)} style={{ width: 16, textAlign: 'center', color: 'var(--color-muted)', flexShrink: 0, fontSize: 13 }} aria-hidden="true"></i>
                            <span style={{ minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{cat}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {metadataRows.length === 0 && !(steam && categories.length > 0) && (
                    <div style={{ color: 'var(--color-muted)' }}>No metadata available</div>
                  )}
                </div>
              </section>
            ),
            links: externalLinks.length > 0 ? (
              <section className="bg-secondary border border-border p-4">
                <h2 className="text-lg font-semibold mb-3">External Links</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {externalLinks.map((link) => (
                    <div key={link.key} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                      <i className={link.icon} style={{ width: 18, textAlign: 'center', color: 'var(--color-muted)' }} aria-hidden="true"></i>
                      <span style={{ color: 'var(--color-muted)', minWidth: 92 }}>{link.label}</span>
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
            ) : null,
            tags: detailTags.length > 0 ? (
              <section className="bg-secondary border border-border p-4">
                <h2 className="text-lg font-semibold mb-3">Tags</h2>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {detailTags.slice(0, 32).map((tag) => (
                    <span key={tag} className="bg-primary border border-border px-2 py-1 text-xs">{tag}</span>
                  ))}
                </div>
              </section>
            ) : null,
          }}
        />
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
