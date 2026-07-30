import { useState, useEffect, useRef } from 'react'
import RatingModal from './RatingModal.jsx'
import {
  PERSONAL_RATING_CATEGORIES, RATING_MAX,
  computeOnlineRating, computeRatingAverage, readRatingsFromGame,
} from '../../utils/ratingCategories.js'
import { canEditTags as canEditTagsFor } from '../../utils/tagEditing.js'
import TagEditor from '../tags/TagEditor.jsx'
import { useTagState } from '../../hooks/useTagState.js'
import HeroBanner from './page/HeroBanner.jsx'
import ActionBar from './page/ActionBar.jsx'
import InfoPanel from './page/InfoPanel.jsx'
import PreviewLightbox from './page/PreviewLightbox.jsx'
import HoverVideo from './page/HoverVideo.jsx'
import DetailPanelGrid, { DEFAULT_DETAIL_LAYOUT } from './page/DetailPanelGrid.jsx'
import SafeImage from '../ui/SafeImage.jsx'
import RefreshMediaModal from '../ui/RefreshMediaModal.jsx'
import {
  LAUNCH_STATE, filterOutBanner, formatPlaytime,
  sortVersionsDesc, getInstalledVersions, getDefaultVersion, isVideoUrl, formatReleaseDate,
  isSteamGame, getMappedSteamAppId, isGogGame, getMappedGogId, resolveDeveloper, formatLanguages, getCategoryIcon, splitCsv,
} from './page/gameDetailUtils.js'
import { buildGameLinks, gogStoreUrl } from './gameLinks.js'
import GogIcon from '../ui/GogIcon.jsx'
import PlaystatePicker from '../ui/PlaystatePicker.jsx'
import { effectiveTitlePlaystate } from '../../utils/playstates.js'
import { toMediaSrc } from '../../utils/mediaSrc.js'

const isSteamInstallPath = (value) =>
  /(?:^|[\\/])steamapps[\\/]common(?:[\\/]|$)/i.test(String(value || ''))

// Category list now lives in src/utils/ratingCategories.js so the renderer and
// the database cannot disagree about it.
const personalRatingFields = PERSONAL_RATING_CATEGORIES.map(({ key, label, gameKey }) => [
  key,
  label,
  gameKey,
])

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

const GameDetailPage = ({ game, onBack, onRefresh, onWishlistChanged, openRatingFor = null, onRatingOpened }) => {
  const [previews, setPreviews] = useState([])
  const [movieThumbs, setMovieThumbs] = useState({}) // video url -> steam thumbnail url
  const [previewsLoading, setPreviewsLoading] = useState(false)
  // Preview image URLs that failed to load; excluded from the grid so we never
  // render a broken "unavailable" tile. If everything fails, the section shows
  // the "No previews available" note instead.
  const [failedPreviews, setFailedPreviews] = useState(() => new Set())
  const [isWishlisted, setIsWishlisted] = useState(game?.isWishlisted === true || game?.isWishlistEntry === true)
  const [wishlistBusy, setWishlistBusy] = useState(false)
  const [isFavorite, setIsFavorite] = useState(game?.isFavorite === true || game?.is_favorite === 1)
  const [favoriteBusy, setFavoriteBusy] = useState(false)
  const [selectedVersion, setSelectedVersion] = useState(null)
  const [isRefreshingMedia, setIsRefreshingMedia] = useState(false)
  const [refreshModalOpen, setRefreshModalOpen] = useState(false)
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
  const [ratingModalOpen, setRatingModalOpen] = useState(false)

  // Customizable 3-column panel layout (shared across all games, saved to config
  // under Appearance.detailLayout). editingLayout toggles drag-and-drop.
  const [detailLayout, setDetailLayout] = useState(DEFAULT_DETAIL_LAYOUT)
  const [editingLayout, setEditingLayout] = useState(false)
  // The About/description panel is hidden by default; toggled by the info
  // button in the action bar. Its Read More expansion is internal to the panel.
  const [showInfo, setShowInfo] = useState(false)
  // True once the sticky ActionBar has "stuck" (user scrolled past the hero).
  // Drives moving the Back button from the hero into the ActionBar.
  const [barStuck, setBarStuck] = useState(false)
  const isRunningRef  = useRef(false)
  // Set when the main process reports the game closed. Guards against a
  // fast-exiting game reporting closed *before* the launchGame invoke resolves,
  // which would otherwise leave the button stuck on RUNNING.
  const closedDuringLaunchRef = useRef(false)
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
      setFailedPreviews(new Set())
      try {
        if (game.isCatalogEntry === true) {
          // In browse mode the selected season's Steam appid (from the
          // synthesized versions) drives which appid's media we show. Fall back
          // to the game's single steam id.
          const browseSteamAppId = (selectedVersion && selectedVersion.source === 'steam')
            ? (selectedVersion.source_app_id ?? selectedVersion.sourceAppId ?? null)
            : (game.steam_id || game.steam_appid || null)
          const cacheKey = `${game.atlas_id || ''}:${game.f95_id || ''}:${game.lc_id || game.lcId || ''}:${browseSteamAppId || game.steam_id || game.steam_appid || ''}`
          if (browsePreviewCacheRef.current.has(cacheKey)) {
            setPreviews(filterOutBanner(browsePreviewCacheRef.current.get(cacheKey), game.banner_url))
            return
          }
          const urls = await window.electronAPI.getBrowsePreviewUrls?.({
            atlas_id: game.atlas_id,
            f95_id: game.f95_id,
            lc_id: game.lc_id || game.lcId,
            steam_id: browseSteamAppId,
            gog_id: game.gog_id || game.gog_appid,
          })
          const safeUrls = Array.isArray(urls) ? urls : []
          // On-demand: fetch the selected Steam season's screens + trailers so
          // browse mode shows them like an installed game. Trailer urls are
          // prepended (they lead the media grid) and their thumbnails feed the
          // movieThumbs map used by the Videos section.
          let steamPreviews = []
          if (browseSteamAppId) {
            try {
              const media = await window.electronAPI.ensureSteamBrowseMedia?.(browseSteamAppId)
              if (media) {
                const trailerUrls = (media.trailers || []).map((t) => t.url).filter(Boolean)
                steamPreviews = [...trailerUrls, ...(media.previews || [])]
                if ((media.trailers || []).length > 0) {
                  setMovieThumbs((prev) => {
                    const next = { ...prev }
                    for (const t of media.trailers) if (t?.url && t?.thumbnail) next[t.url] = t.thumbnail
                    return next
                  })
                }
              }
            } catch (mediaErr) {
              console.warn('Failed to load browse steam media:', mediaErr?.message)
            }
          }
          const snapshotPreviews = splitPreviewUrls(game.preview_urls || game.previewUrls)
          // Merge: steam trailers/screens first, then whatever the browse query
          // returned, then the snapshot fallback. De-duped, order-preserving.
          const merged = []
          const seen = new Set()
          for (const u of [...steamPreviews, ...safeUrls, ...(safeUrls.length === 0 && steamPreviews.length === 0 ? snapshotPreviews : [])]) {
            const s = String(u || '').trim()
            if (s && !seen.has(s)) { seen.add(s); merged.push(s) }
          }
          browsePreviewCacheRef.current.set(cacheKey, merged)
          setPreviews(filterOutBanner(merged, game.banner_url))
          return
        }
        const selectedSteamAppId = (selectedVersion && selectedVersion.source === 'steam')
          ? (selectedVersion.source_app_id ?? selectedVersion.sourceAppId ?? null)
          : null
        const urls = await window.electronAPI.getPreviews(game.record_id, selectedSteamAppId)
        let localPreviews = Array.isArray(urls) ? urls : []
        // For a Steam version, the selected season's screens/trailers may not be
        // in the local DB yet (only the imported appid's media gets fetched at
        // import time). Lazily fetch this appid's media so switching versions
        // shows the right previews + trailers, mirroring browse mode. Trailer
        // urls lead the grid; their thumbnails feed movieThumbs.
        if (selectedSteamAppId) {
          try {
            const media = await window.electronAPI.ensureSteamBrowseMedia?.(selectedSteamAppId)
            if (media) {
              const trailerUrls = (media.trailers || []).map((t) => t.url).filter(Boolean)
              const steamMedia = [...trailerUrls, ...(media.previews || [])]
              const merged = []
              const seen = new Set()
              // Steam media for the selected appid first, then whatever getPreviews
              // returned (local downloaded art, other-source screens), deduped.
              for (const u of [...steamMedia, ...localPreviews]) {
                const s = String(u || '').trim()
                if (s && !seen.has(s)) { seen.add(s); merged.push(s) }
              }
              localPreviews = merged
              if ((media.trailers || []).length > 0) {
                setMovieThumbs((prev) => {
                  const next = { ...prev }
                  for (const t of media.trailers) if (t?.url && t?.thumbnail) next[t.url] = t.thumbnail
                  return next
                })
              }
            }
          } catch (mediaErr) {
            console.warn('Failed to load selected steam version media:', mediaErr?.message)
          }
        }
        setPreviews(filterOutBanner(localPreviews, game.banner_url))
      } catch (err) {
        console.error('Failed to load previews:', err)
        setPreviews([])
      } finally {
        setPreviewsLoading(false)
      }
    }
    loadPreviews()
  }, [game?.record_id, game?.versions, game?.selected_version_id, game?.banner_url, game?.isCatalogEntry, game?.atlas_id, game?.f95_id, game?.lc_id, game?.lcId, game?.steam_id, selectedVersion?.version_id, selectedVersion?.source_app_id])

  // Steam provides a poster thumbnail per trailer; fetch a url->thumbnail map so
  // the Videos section can show it instead of a video first-frame. Real records
  // only (catalog entries have no record_id to query).
  useEffect(() => {
    let cancelled = false
    // Catalog (browse) entries have no record_id to query; their trailer
    // thumbnails are populated on demand by loadPreviews (ensureSteamBrowseMedia).
    // So here we only handle real records; don't clear browse thumbs.
    if (game.isCatalogEntry === true) {
      return undefined
    }
    if (!game?.record_id) {
      setMovieThumbs({})
      return undefined
    }
    ;(async () => {
      try {
        const selectedSteamAppId = (selectedVersion && selectedVersion.source === 'steam')
          ? (selectedVersion.source_app_id ?? selectedVersion.sourceAppId ?? null)
          : null
        const pairs = await window.electronAPI.getSteamMovieThumbnails?.(game.record_id, selectedSteamAppId)
        if (cancelled || !Array.isArray(pairs) || pairs.length === 0) return
        // Merge, don't replace: loadPreviews may have already populated thumbs
        // for the selected Steam version via ensureSteamBrowseMedia (these two
        // effects run in parallel). Replacing here would race/wipe those.
        setMovieThumbs((prev) => {
          const next = { ...prev }
          for (const p of pairs) if (p?.url && p?.thumbnail) next[p.url] = p.thumbnail
          return next
        })
      } catch (err) {
        console.warn('Failed to load movie thumbnails:', err?.message)
      }
    })()
    return () => { cancelled = true }
  }, [game?.record_id, game?.isCatalogEntry, selectedVersion?.version_id, selectedVersion?.source_app_id])

  useEffect(() => {
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
            if (parsed && (Array.isArray(parsed.rows) || Array.isArray(parsed.items) || Array.isArray(parsed.columns))) setDetailLayout(parsed)
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
      // Deliberately does NOT touch launchState: game-updated also fires at
      // launch *start* (last_played), which is what used to snap the button
      // straight back to PLAY. game-run-state owns that state now.
      onRefresh?.(game.record_id)
    }
    const removeListener = window.electronAPI.onGameUpdated(handleGameUpdated)
    return () => {
      if (typeof removeListener === 'function') removeListener()
      else window.electronAPI.removeAllListeners?.('game-updated')
    }
  }, [game?.record_id, onRefresh])

  // Authoritative launch state, driven by the main process: RUNNING is held for
  // the lifetime of the game process (tracked launches) and released on exit.
  // Matched on record id only — the title is running whichever version it is.
  useEffect(() => {
    const recordId = game?.record_id
    if (!recordId) return
    let cancelled = false

    // Switching records starts from a clean slate; the query below re-asserts
    // RUNNING if this particular title happens to be running.
    isRunningRef.current = false
    closedDuringLaunchRef.current = false
    setLaunchState(LAUNCH_STATE.IDLE)

    const applyRunState = (running) => {
      isRunningRef.current = running
      if (!running) closedDuringLaunchRef.current = true
      setLaunchState(running ? LAUNCH_STATE.RUNNING : LAUNCH_STATE.IDLE)
    }

    // A game may already be running when this page mounts.
    ;(async () => {
      try {
        const rows = await window.electronAPI.getRunningGames?.()
        if (cancelled || !Array.isArray(rows)) return
        if (rows.some((row) => String(row?.recordId) === String(recordId))) {
          isRunningRef.current = true
          setLaunchState(LAUNCH_STATE.RUNNING)
        }
      } catch (err) {
        console.warn('Failed to read running games:', err?.message)
      }
    })()

    const removeListener = window.electronAPI.onGameRunState?.((payload) => {
      if (cancelled || String(payload?.recordId) !== String(recordId)) return
      applyRunState(payload?.running === true)
    })

    return () => {
      cancelled = true
      if (typeof removeListener === 'function') removeListener()
    }
  }, [game?.record_id])

  // ── Derived state ─────────────────────────────────────────────────────────
  const installedVersions = getInstalledVersions(game.versions || [])
  const actionVersion = selectedVersion || getDefaultVersion(installedVersions)
  const canManageLocalTitle = game.isMetadataOnly !== true && game.isCatalogEntry !== true
  // See src/utils/tagEditing.js for why Browse rows are read-only.
  const tagsEditable = canEditTagsFor(game)
  const canManageFavorite = canManageLocalTitle && Boolean(Number.parseInt(game.record_id, 10) > 0)
  const canManagePersonalRatings = canManageFavorite
  // Opened from a context menu in the grid or tree: App.jsx selects the game and
  // passes its id through, and this clears the request so re-selecting the same
  // title later does not reopen the modal.
  useEffect(() => {
    if (!openRatingFor || openRatingFor !== game?.record_id) return
    if (canManagePersonalRatings) {
      setPersonalRatingsError('')
      setRatingModalOpen(true)
    }
    onRatingOpened?.()
  }, [openRatingFor, game?.record_id, canManagePersonalRatings, onRatingOpened])
  // Title playstate: explicit override on the game wins; otherwise derived from
  // the versions. `game.playstate` is the raw override; effectivePlaystate is
  // provided by the backend but recomputed here so optimistic UI stays correct.
  const titlePlaystate = effectiveTitlePlaystate(game.playstate, game.versions || [])
  const titlePlaystateIsDerived = !game.playstate && !!titlePlaystate
  const canManageWishlist = game.isCatalogEntry === true || game.isWishlistEntry === true
  const canLaunch = Boolean(
    actionVersion &&
    actionVersion.isInstalled !== false &&
    (actionVersion.exec_path ||
      isSteamInstallPath(actionVersion.game_path) ||
      (actionVersion.source === 'steam' && actionVersion.game_path)),
  )
  const canInstallFromDetail = !canLaunch && (canManageWishlist || canManageLocalTitle || game.hasInstalledVersion === false)
  const importPanelMode = canManageWishlist ? 'catalog' : 'local'
  const canOpenFolder = Boolean(actionVersion?.game_path && actionVersion.isInstalled !== false)
  const latestVersion = game.latestVersion || game.latest_version || ''
  const versionOptions = sortVersionsDesc(game.versions || [])

  // Split previews into videos (trailers) and images, keeping each item's index
  // in the original `previews` array so the lightbox (which indexes into that
  // array) opens the right item from either section. Also dedupe by content key
  // (Steam embeds a content hash in the filename) so the same image at different
  // ?t= timestamps / CDN hosts isn't shown twice, even before a DB refresh
  // cleans the stored dupes.
  const previewContentKey = (url) => {
    const s = String(url || '')
    const p = s.split(/[?#]/)[0]
    const hexes = p.match(/[0-9a-f]{16,}/gi)
    if (hexes && hexes.length > 0) return hexes.sort((a, b) => b.length - a.length)[0].toLowerCase()
    return p.split('/').filter(Boolean).slice(-2).join('/').toLowerCase()
  }
  const seenPreviewKeys = new Set()
  const dedupedPreviews = previews
    .map((url, index) => ({ url, index }))
    .filter((p) => {
      const k = previewContentKey(p.url)
      if (seenPreviewKeys.has(k)) return false
      seenPreviewKeys.add(k)
      return true
    })
  const videoPreviews = dedupedPreviews.filter((p) => isVideoUrl(p.url))
  const imagePreviews = dedupedPreviews
    .filter((p) => !isVideoUrl(p.url))
    .filter((p) => !failedPreviews.has(p.url))

  const steamAppId = getMappedSteamAppId(game)
  // Version-aware Steam identity: when the selected/acted-on version is itself a
  // Steam version, its source_app_id is the appid to install/launch/uninstall —
  // not the title-level mapping. This lets a title hold an F95 version and a
  // Steam version side by side, with the buttons acting on whichever is
  // selected. Falls back to the title mapping for legacy Steam records that
  // predate per-version source tagging.
  const actionVersionIsSteam =
    actionVersion?.source === 'steam' ||
    (!actionVersion?.source && isSteamInstallPath(actionVersion?.game_path))
  const activeSteamAppId =
    (actionVersion?.source === 'steam' && actionVersion?.source_app_id)
      ? String(actionVersion.source_app_id)
      : steamAppId
  const gogId = getMappedGogId(game)
  const steam = isSteamGame(game)
  const developer = resolveDeveloper(game)
  const categories = splitCsv(game.category)
  const detailTags = getDetailTags(game)
  // Community scores are 0-5 at source; computeOnlineRating converts to 0-10.
  const onlineRating = computeOnlineRating({
    f95Rating: game.rating,
    lewdcornerRating: game.lewdcornerRating,
  })
  const onlineRatingSources = [
    Number(game.rating) > 0 ? 'F95' : null,
    Number(game.lewdcornerRating) > 0 ? 'LewdCorner' : null,
  ].filter(Boolean)
  const personalRatedCount = PERSONAL_RATING_CATEGORIES.filter(
    ({ gameKey }) => Number(game?.[gameKey]) > 0,
  ).length
  // onSaved refreshes the record so the library grid and filter sidebar pick up
  // the new tag list rather than showing a stale one until the next navigation.
  const tagState = useTagState(game?.record_id, {
    onSaved: () => onRefresh?.(game?.record_id),
  })
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

  const externalLinks = buildGameLinks(game)
  const personalRatingsDirty = JSON.stringify(personalRatingsDraft) !== JSON.stringify(personalRatingsSaved)
  const personalRatingsOverall = getPersonalRatingsOverall(personalRatingsDraft)

  // While viewing an uninstalled Steam game, poll every 15s to see if Steam has
  // finished installing it (e.g. after the Install button handed off to Steam).
  // When the state flips, the backend heals the version path and we refresh the
  // page so the Play button and installed UI appear without a manual reload.
  // Only runs for Steam-mapped, not-currently-launchable titles.
  useEffect(() => {
    if (!activeSteamAppId || canLaunch || !game?.record_id) return undefined
    let cancelled = false
    const versionName = actionVersion?.version
    const tick = async () => {
      try {
        const res = await window.electronAPI.steamCheckInstalled?.({
          recordId: game.record_id,
          appid: activeSteamAppId,
          version: versionName,
        })
        if (!cancelled && res?.changed) {
          onRefresh?.(game.record_id)
        }
      } catch (err) {
        // Non-fatal — just try again next tick.
        console.warn('Steam install check failed:', err?.message)
      }
    }
    const id = setInterval(tick, 15000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [activeSteamAppId, canLaunch, game?.record_id, actionVersion?.version, onRefresh])

  // ── Handlers ──────────────────────────────────────────────────────────────
  const launchSelectedGame = async () => {
    if (!canLaunch || launchState !== LAUNCH_STATE.IDLE) return
    closedDuringLaunchRef.current = false
    setLaunchState(LAUNCH_STATE.LAUNCHING)
    try {
      await window.electronAPI.launchGame({ recordId: game.record_id, version: actionVersion.version })
      // If the process already exited (crash, instant-close launcher stub), the
      // main process has told us so — don't claim RUNNING after the fact.
      if (closedDuringLaunchRef.current) return
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
  const openGog = gogId
    ? async () => {
        const url = gogStoreUrl(game, gogId)
        await window.electronAPI.openExternalUrl(url)
      }
    : null
  const openSteam = activeSteamAppId
    ? async () => { await window.electronAPI.openExternalUrl(`steam://nav/games/details/${activeSteamAppId}`) }
    : null
  // After handing an install/uninstall to the Steam client, its work happens
  // asynchronously and out of our control. Best-effort: re-pull the record a few
  // seconds later so the installed state / Play button updates without the user
  // having to manually refresh. This is a nudge, not a guarantee — a large
  // install won't be done in seconds, so the manual refresh still matters.
  const scheduleInstalledStateRefresh = () => {
    if (!onRefresh || !game?.record_id) return
    ;[4000, 12000].forEach((delay) => {
      setTimeout(() => onRefresh(game.record_id), delay)
    })
  }
  const steamInstall = activeSteamAppId
    ? async () => {
        await window.electronAPI.openExternalUrl(`steam://install/${activeSteamAppId}`)
        scheduleInstalledStateRefresh()
      }
    : null
  const uninstallSteam = activeSteamAppId && canManageLocalTitle && canLaunch
    ? async () => {
        const confirmed = window.confirm(
          `Ask Steam to uninstall "${game.title}"?\n\nAtlas will keep this title and its metadata. Atlas local files are not deleted by this action.`,
        )
        if (!confirmed) return
        await window.electronAPI.openExternalUrl(`steam://uninstall/${activeSteamAppId}`)
        scheduleInstalledStateRefresh()
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

  const handleSetTitlePlaystate = async (nextPlaystate) => {
    if (!canManageLocalTitle || !game?.record_id) return
    try {
      const result = await window.electronAPI.setGamePlaystate?.(game.record_id, nextPlaystate)
      if (!result?.success) throw new Error(result?.error || 'Playstate update failed')
      onRefresh?.(game.record_id)
    } catch (err) {
      console.error('Failed to update title playstate:', err)
      alert(`Failed to update playstate: ${err.message || err}`)
    }
  }

  const handleSetVersionPlaystate = async (versionId, nextPlaystate) => {
    if (!canManageLocalTitle || !game?.record_id || !versionId) return
    try {
      const result = await window.electronAPI.setVersionPlaystate?.(game.record_id, versionId, nextPlaystate)
      if (!result?.success) throw new Error(result?.error || 'Version playstate update failed')
      onRefresh?.(game.record_id)
    } catch (err) {
      console.error('Failed to update version playstate:', err)
      alert(`Failed to update version playstate: ${err.message || err}`)
    }
  }

  const updatePersonalRatingDraft = (field, value) => {
    setPersonalRatingsError('')
    setPersonalRatingsDraft((current) => ({
      ...current,
      [field]: normalizeRatingInput(value),
    }))
  }

  const savePersonalRatings = async (draft) => {
    if (!canManagePersonalRatings || personalRatingsBusy) return
    setPersonalRatingsBusy(true)
    setPersonalRatingsError('')
    try {
      // 0 is sent through as-is: the database stores it and every average
      // excludes it, which is what makes a category skippable.
      const payload = Object.fromEntries(
        PERSONAL_RATING_CATEGORIES.map(({ key }) => [key, Number(draft?.[key]) || 0]),
      )
      const result = await window.electronAPI.setGamePersonalRatings?.(game.record_id, payload)
      if (!result?.success) throw new Error(result?.error || 'Personal rating update failed')
      const saved = Object.fromEntries(
        PERSONAL_RATING_CATEGORIES.map(({ key, gameKey }) => [
          key,
          normalizeRatingInput(result[gameKey]),
        ]),
      )
      setPersonalRatingsDraft(saved)
      setPersonalRatingsSaved(saved)
      setRatingModalOpen(false)
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

  const refreshMetadataAndImages = () => {
    if (!game?.record_id || !canManageLocalTitle || isRefreshingMedia) return
    setRefreshModalOpen(true)
  }

  const doRefreshMedia = async (mode) => {
    if (!game?.record_id || !canManageLocalTitle) return
    setIsRefreshingMedia(true)
    try {
      const result = await window.electronAPI.refreshGameMedia(game.record_id, { mode })
      if (result?.success === false) throw new Error(result.error || 'Refresh failed')
      if (Array.isArray(result?.previewUrls)) setPreviews(filterOutBanner(result.previewUrls, game.banner_url))
      onRefresh?.(game.record_id)
      setRefreshModalOpen(false)
    } catch (error) {
      alert(`Failed to refresh media: ${error.message}`)
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
        heroOverride={(() => {
          const appId = (selectedVersion && selectedVersion.source === 'steam')
            ? (selectedVersion.source_app_id ?? selectedVersion.sourceAppId ?? null)
            : null
          if (!appId) return null
          // The tile's default hero uses the first steam id; when a different
          // Steam version is selected, prefer that appid's hero. HeroBanner
          // falls through its candidate chain if this URL fails to load.
          return `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg`
        })()}
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
        onSteamInstall={steamInstall}
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
        onOpenGog={openGog}
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
      <div className="p-3">
        {editingLayout && (
          <div className="mb-4 flex items-center gap-2 rounded border border-accent/50 bg-accent/10 px-3 py-2 text-sm">
            <i className="fas fa-up-down-left-right text-accent" aria-hidden="true"></i>
            <span className="flex-1">Editing layout — drag panels between columns, add/remove columns and set each column's width, or drop a panel into a full-width row. Changes save automatically.</span>
            <button onClick={() => handleLayoutChange(DEFAULT_DETAIL_LAYOUT)} className="px-3 py-1 rounded border border-border bg-secondary hover:bg-selected">Reset to defaults</button>
            <button onClick={() => setEditingLayout(false)} className="px-3 py-1 rounded bg-accent text-white hover:bg-accentHover">Done</button>
          </div>
        )}
        <DetailPanelGrid
          layout={detailLayout}
          editing={editingLayout}
          onLayoutChange={handleLayoutChange}
          panels={{
            videos: videoPreviews.length > 0 ? (
              <section className="border border-border bg-secondary" style={{ padding: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <h2 className="text-lg font-semibold">Videos</h2>
                  <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>{videoPreviews.length} available</span>
                </div>
                {/* Single row, scrolls horizontally. Each tile is a fixed height
                    (10% shorter than the previous ~180px row) with 16:9 width. */}
                <div
                  style={{
                    display: 'flex',
                    gap: 12,
                    overflowX: 'auto',
                    overflowY: 'hidden',
                    paddingBottom: 4,
                  }}
                >
                  {videoPreviews.map(({ url, index }) => (
                    <div key={`video-${url}-${index}`} style={{ flex: '0 0 auto', height: 162, aspectRatio: '16 / 9' }}>
                      <HoverVideo
                        src={toMediaSrc(url)}
                        poster={movieThumbs[url] || ''}
                        onClick={() => setLightboxIndex(index)}
                      />
                    </div>
                  ))}
                </div>
              </section>
            ) : null,
            previews: (
              <section className="border border-border bg-secondary" style={{ padding: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <h2 className="text-lg font-semibold">Previews</h2>
                  <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>{imagePreviews.length} available</span>
                </div>
                {imagePreviews.length > 0 ? (
                  <div
                    className="grid gap-3"
                    style={{ gridTemplateColumns: `repeat(${Math.min(4, Math.max(1, imagePreviews.length))}, minmax(0, 1fr))` }}
                  >
                    {imagePreviews.map(({ url: preview, index }) => (
                      <div
                        key={`${preview}-${index}`}
                        className="border border-border overflow-hidden aspect-video cursor-pointer hover:border-accent transition-colors relative"
                        onClick={() => setLightboxIndex(index)}
                        title="Click to view"
                      >
                        <SafeImage
                          src={preview}
                          alt={`Preview ${index + 1}`}
                          fallbackMode="hidden"
                          onError={() => setFailedPreviews((prev) => {
                            if (prev.has(preview)) return prev
                            const next = new Set(prev)
                            next.add(preview)
                            return next
                          })}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        />
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
              <section className="bg-secondary border border-border p-2">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                  <h2 className="text-lg font-semibold">Versions</h2>
                  {canManageLocalTitle && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <PlaystatePicker
                        value={titlePlaystate}
                        onChange={handleSetTitlePlaystate}
                        size="sm"
                        label="Title"
                      />
                      {titlePlaystateIsDerived && (
                        <span
                          title="Derived from this title's versions. Choosing a state here sets an explicit title override."
                          style={{ fontSize: 10, color: 'var(--color-muted)', fontStyle: 'italic' }}
                        >
                          (from versions)
                        </span>
                      )}
                    </span>
                  )}
                </div>
                {versionOptions.length > 0 ? (
                  <div className="space-y-2">
                    {versionOptions.map((version) => {
                      const isSelected = selectedVersion?.version === version.version && selectedVersion?.game_path === version.game_path
                      const installed = version.isInstalled !== false
                      return (
                        <div
                          key={`${version.version}-${version.game_path}`}
                          className={`border transition-colors ${isSelected ? 'border-accent bg-selected' : 'border-border bg-primary'}`}
                        >
                          <button
                            onClick={() => selectVersion(version)}
                            className={`w-full text-left p-3 transition-colors ${isSelected ? 'bg-selected' : 'bg-primary hover:bg-selected'}`}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                              <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>
                                {isSelected && <i className="fas fa-play" style={{ fontSize: 9, color: 'var(--color-accent,#86a8e7)' }}></i>}
                                {version.version || 'Unknown version'}
                                {version.source === 'steam' && (
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--color-muted)', border: '1px solid var(--color-border)', borderRadius: 3, padding: '1px 5px' }}>
                                    <i className="fab fa-steam" style={{ fontSize: 10 }}></i> Steam
                                  </span>
                                )}
                                {version.source === 'gog' && (
                                  <span style={{ fontSize: 10, color: 'var(--color-muted)', border: '1px solid var(--color-border)', borderRadius: 3, padding: '1px 5px' }}>GOG</span>
                                )}
                              </span>
                              <span style={{ fontSize: 11, color: installed ? 'var(--color-success)' : 'var(--color-danger)' }}>{installed ? 'Installed' : 'Missing'}</span>
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--color-text)', marginTop: 3 }}>{formatPlaytime(version.version_playtime)}</div>
                            <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{version.game_path || 'No path set'}</div>
                          </button>
                          {canManageLocalTitle && version.version_id ? (
                            <div style={{ padding: '6px 12px 10px', borderTop: '1px solid var(--color-border)' }}>
                              <PlaystatePicker
                                value={version.playstate}
                                onChange={(next) => handleSetVersionPlaystate(version.version_id, next)}
                                size="sm"
                              />
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div style={{ color: 'var(--color-muted)' }}>No versions recorded</div>
                )}
              </section>
            ),
            // Two ratings side by side, both out of 10 so they read against
            // each other. Community scores are 0-5 at source and converted; the
            // conversion lives in computeOnlineRating.
            rating: (
              <section className="bg-secondary border border-border p-2">
                <h2 className="mb-3 text-lg font-semibold">Rating</h2>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3 rounded border border-border bg-primary px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm text-text">Online Rating</div>
                      <div className="text-[11px] text-muted">
                        {onlineRatingSources.length > 0
                          ? `Average of ${onlineRatingSources.join(' and ')}`
                          : 'No community scores found'}
                      </div>
                    </div>
                    <span
                      className="shrink-0 text-base font-bold tabular-nums"
                      style={{ color: onlineRating === null ? 'var(--color-muted)' : 'var(--color-warning)' }}
                    >
                      {onlineRating === null ? 'Unrated' : `${onlineRating}/${RATING_MAX}`}
                    </span>
                  </div>

                  {canManagePersonalRatings ? (
                    <button
                      type="button"
                      onClick={() => { setPersonalRatingsError(''); setRatingModalOpen(true) }}
                      title="Set your rating"
                      className="flex w-full items-center justify-between gap-3 rounded border border-border bg-primary px-3 py-2 text-left transition-colors hover:border-accent"
                    >
                      <div className="min-w-0">
                        <div className="text-sm text-text">Personal Rating</div>
                        <div className="text-[11px] text-muted">
                          {personalRatingsOverall === null
                            ? 'Click to rate this game'
                            : `${personalRatedCount} of ${PERSONAL_RATING_CATEGORIES.length} categories rated`}
                        </div>
                      </div>
                      <span
                        className="shrink-0 text-base font-bold tabular-nums"
                        style={{ color: personalRatingsOverall === null ? 'var(--color-muted)' : 'var(--color-warning)' }}
                      >
                        {personalRatingsOverall === null ? 'Unrated' : `${personalRatingsOverall}/${RATING_MAX}`}
                      </span>
                    </button>
                  ) : (
                    <div className="flex items-center justify-between gap-3 rounded border border-border bg-primary px-3 py-2">
                      <div className="text-sm text-text">Personal Rating</div>
                      <span className="shrink-0 text-sm text-muted">Unavailable</span>
                    </div>
                  )}
                </div>
                {personalRatingsError && (
                  <div className="mt-2 text-xs text-danger">{personalRatingsError}</div>
                )}
              </section>
            ),
            details: (
              <section className="bg-secondary border border-border p-2">
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
                        {[...new Set(categories)].map((cat, i) => (
                          <div key={`${cat}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
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
              <section className="bg-secondary border border-border p-2">
                <h2 className="text-lg font-semibold mb-3">External Links</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {externalLinks.map((link) => (
                    <div key={link.key} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                      {link.iconImage ? (
                        <GogIcon size={16} style={{ width: 18, color: 'var(--color-muted)' }} />
                      ) : (
                        <i className={link.icon} style={{ width: 18, textAlign: 'center', color: 'var(--color-muted)' }} aria-hidden="true"></i>
                      )}
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
            // Editable here as well as in the properties window. When an
            // override exists the editor is the source of truth; otherwise it
            // seeds from the catalog list, which is also what detailTags shows
            // for records the user has never touched.
            tags: (tagsEditable
              ? (tagState.tags.length > 0 || tagState.catalogTags.length > 0 || tagState.loading)
              : detailTags.length > 0) ? (
              <section className="bg-secondary border border-border p-2">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold">Tags</h2>
                  {tagsEditable && tagState.overridden && (
                    <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent">
                      Custom
                    </span>
                  )}
                </div>
                {!tagsEditable ? (
                  // Browse / metadata-only rows: read-only catalog tags.
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {[...new Set(detailTags)].slice(0, 32).map((tag, i) => (
                      <span key={`${tag}-${i}`} className="bg-primary border border-border px-2 py-1 text-xs">{tag}</span>
                    ))}
                  </div>
                ) : tagState.loading ? (
                  <p className="text-xs text-muted">Loading tags…</p>
                ) : (
                  <TagEditor
                    tags={tagState.tags}
                    catalogTags={tagState.catalogTags}
                    overridden={tagState.overridden}
                    busy={tagState.busy}
                    onChange={tagState.applyTags}
                    onReset={tagState.resetTags}
                  />
                )}
                {tagsEditable && tagState.error && (
                  <p className="mt-1 text-xs text-danger">{tagState.error}</p>
                )}
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

      <RatingModal
        open={ratingModalOpen}
        title={game.title || ''}
        ratings={readRatingsFromGame(game)}
        busy={personalRatingsBusy}
        error={personalRatingsError}
        onSave={savePersonalRatings}
        onCancel={() => { if (!personalRatingsBusy) setRatingModalOpen(false) }}
      />

      <RefreshMediaModal
        open={refreshModalOpen}
        scope="game"
        busy={isRefreshingMedia}
        onConfirm={doRefreshMedia}
        onClose={() => { if (!isRefreshingMedia) setRefreshModalOpen(false) }}
      />
    </div>
  )
}

export default GameDetailPage
