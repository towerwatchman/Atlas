import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import SettingsStep from './steps/SettingsStep.jsx'
import ScanStep from './steps/ScanStep.jsx'
import { normalizeImporterSource } from './importerSources.js'

const deriveImportStats = (games) => ({
  potential: games.filter((game) => (game.scanStatus || 'new') === 'new').length,
  pendingMatch: games.filter((game) => game.scanStatus === 'pendingMatch').length,
  archives: games.filter((game) => game.isArchive && (game.scanStatus || 'new') === 'new').length,
  alreadyImported: games.filter((game) => game.scanStatus === 'alreadyImported').length,
  repairPath: games.filter((game) => game.scanStatus === 'repairPath').length,
  steamVersion: games.filter((game) => game.scanStatus === 'steamVersion').length,
  missingLaunchable: games.filter((game) => game.scanStatus === 'missingLaunchable').length,
  emptyFolder: games.filter((game) => game.scanStatus === 'emptyFolder').length,
  totalFound: games.length,
})

const initialScanProgress = { value: 0, total: 0, potential: 0, pendingMatch: 0, archives: 0, alreadyImported: 0, repairPath: 0, steamVersion: 0, missingLaunchable: 0, emptyFolder: 0, totalFound: 0 }
const defaultSourceFolderStructure = '{creator}/{title}/{version}'
const defaultGameExtensions = 'exe,swf,flv,f4v,rag,cmd,bat,jar,html'
const defaultArchiveExtensions = 'zip,7z,rar'

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

const normalizeF95IdInput = (value) => {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const threadMatch = raw.match(/f95zone\.to\/threads\/(?:[^/?#]*\.)?(\d+)(?:[/?#]|$)/i)
  if (threadMatch) return threadMatch[1]
  const prefixedMatch = raw.match(/\bf95[\s_-]*(\d+)\b/i)
  if (prefixedMatch) return prefixedMatch[1]
  return /^\d+$/.test(raw) ? raw : ''
}

const normalizeLcIdInput = (value) => {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const prefixedMatch = raw.match(/\b(?:lc|lewdcorner|lewd\s*corner)[\s_-]*(\d+)\b/i)
  if (prefixedMatch) return prefixedMatch[1]
  if (/lewdcorner\.com/i.test(raw)) {
    const withoutHash = raw.split('#')[0].split('?')[0].replace(/\/+$/, '')
    const tailMatch = withoutHash.match(/(?:^|[/.])(\d+)$/)
    if (tailMatch) return tailMatch[1]
  }
  return /^\d+$/.test(raw) ? raw : ''
}

const Importer = () => {
  // ── View ──────────────────────────────────────────────────────────────────
  const [view, setView] = useState('settings')
  const [isMaximized, setIsMaximized] = useState(false)

  // ── Scan settings ─────────────────────────────────────────────────────────
  const [folder, setFolder] = useState('')
  const [useUnstructured, setUseUnstructured] = useState(true)
  const [customFormat, setCustomFormat] = useState(defaultSourceFolderStructure)
  const [gameExt, setGameExt] = useState(defaultGameExtensions)
  const [archiveExt, setArchiveExt] = useState(defaultArchiveExtensions)
  const [downloadBannerImages, setDownloadBannerImages] = useState(false)
  const [downloadPreviewImages, setDownloadPreviewImages] = useState(false)
  const [previewLimit, setPreviewLimit] = useState('Unlimited')
  const [downloadVideos, setDownloadVideos] = useState(false)
  const [scanSize, setScanSize] = useState(false)
  const [moveFoldersToLibrary, setMoveFoldersToLibrary] = useState(false)
  const [deleteSourceArchiveAfterImport, setDeleteSourceArchiveAfterImport] = useState(false)
  const [includeUnmatched, setIncludeUnmatched] = useState(false)
  const [forceReimport, setForceReimport] = useState(false)
  const [defaultLibraryPath, setDefaultLibraryPath] = useState(null)
  const [autoSelectLatestReplaceVersion, setAutoSelectLatestReplaceVersion] = useState(false)
  const autoSelectLatestReplaceVersionRef = useRef(false)
  const [libraryFormat, setLibraryFormat] = useState(defaultSourceFolderStructure)
  const [askingForLibraryFolder, setAskingForLibraryFolder] = useState(false)
  const [importMode, setImportMode] = useState('games')
  const [scanPath, setScanPath] = useState('')
  const [scanMessage, setScanMessage] = useState('')

  // ── Scan results ──────────────────────────────────────────────────────────
  const [progress, setProgress] = useState(initialScanProgress)
  const [progressLabel, setProgressLabel] = useState(null)
  const [gamesList, setGamesList] = useState([])
  const [hideMatches, setHideMatches] = useState(false)
  const [sortConfig, setSortConfig] = useState({ key: '', direction: 'asc' })
  const [isResolvingMatches, setIsResolvingMatches] = useState(false)
  const [updateProgress, setUpdateProgress] = useState({ value: 0, total: 0 })
  const [selectedScanRowKeys, setSelectedScanRowKeys] = useState(() => new Set())
  const [lastSelectedScanRowKey, setLastSelectedScanRowKey] = useState('')
  const deletedScanGameKeysRef = useRef(new Set())
  const matchCancelRef = useRef(false)
  const steamScanActiveRef = useRef(false)
  const currentScanIdRef = useRef(null)
  const lastSourceSelectionRef = useRef({ source: null, at: 0 })
  const [isScanActive, setIsScanActive] = useState(false)
  const [isCancelingScan, setIsCancelingScan] = useState(false)

  // ── Helpers ───────────────────────────────────────────────────────────────
  const getScanGameKey = (game) => {
    if (game?.sourceType === 'renpySave') return `renpy:${game.savePath || game.saveId || game.title}`
    if (game?.sourceFile) return `source:${game.sourceFile}`
    if (game?.folder && game?.singleExecutable) return `folder-file:${game.folder}/${game.singleExecutable}`
    if (game?.folder) return `folder:${game.folder}`
    return [game?.sourceFile, game?.folder, game?.singleExecutable, game?.title, game?.creator, game?.version, game?.f95Id, game?.lcId, game?.lewdCornerId, game?.atlasId].join('|')
  }

  const isNewScanRow = (game) => ['new', 'repairPath', 'steamVersion', 'lewdCornerVersion'].includes(game.scanStatus || 'new')
  const isExistingImportRow = (game) => game.scanStatus === 'alreadyImported' && forceReimport
  const hasDatabaseMatch = (game) => game.results?.length === 1 && game.results[0]?.key === 'match'
  const hasSelectedDatabaseMatch = (game) => game.results?.length > 1 && !!game.resultSelectedValue
  const isUnmatchedGame = (game) => (game.results || []).length === 0
  const isSteamImportRow = (game = {}) => (
    game.sourceType === 'steam' ||
    game.scanStatus === 'steamVersion' ||
    /^\d+$/.test(String(game.steamId || game.steam_id || game.steam_appid || game.appid || '').trim())
  )

  const normalizeMatchState = (game = {}) => {
    const results = Array.isArray(game.results) ? game.results : []
    if (results.length === 1 && results[0]?.key === 'match') {
      return { ...game, results, resultSelectedValue: 'match', resultVisibility: 'visible' }
    }
    if (results.length > 1) {
      const selectedValue = results.some((result) => result.key === game.resultSelectedValue)
        ? game.resultSelectedValue
        : results[0]?.key || ''
      return { ...game, results, resultSelectedValue: selectedValue, resultVisibility: 'visible' }
    }
    return { ...game, results: [], resultSelectedValue: '', resultVisibility: 'hidden' }
  }

  const isImportableGame = (game, { includeUnmatchedGames = false } = {}) => {
    if (game.sourceType === 'renpySave') {
      if ((game.scanStatus || 'new') !== 'new' || !game.savePath) return false
      if (hasDatabaseMatch(game) || hasSelectedDatabaseMatch(game)) return true
      return includeUnmatchedGames && isUnmatchedGame(game)
    }
    if (!isNewScanRow(game) && !isExistingImportRow(game)) return false
    if (!game.isArchive && !game.selectedValue) return false
    if (hasDatabaseMatch(game) || hasSelectedDatabaseMatch(game)) return true
    return includeUnmatchedGames && isUnmatchedGame(game)
  }

  const importOptions = { includeUnmatchedGames: includeUnmatched }
  const importableGames = gamesList.filter((game) => isImportableGame(game, importOptions))
  const visibleStats = useMemo(() => deriveImportStats(gamesList), [gamesList])
  const canImport = importableGames.length > 0

  const getCleanId = (value) => {
    const id = String(value || '').trim()
    return /^\d+$/.test(id) ? id : ''
  }

  const hasText = (value) => String(value || '').trim().length > 0

  const isBadScanRow = (game = {}) => {
    const isRenpySave = game.sourceType === 'renpySave'
    const hasValidRenpySave = isRenpySave && hasText(game.savePath || game.folder) && hasText(game.title || game.inferredTitle || game.saveId)
    const hasAnyIdentifier = Boolean(
      getCleanId(game.atlasId || game.atlas_id) ||
      getCleanId(game.f95Id || game.f95_id) ||
      getCleanId(game.lcId || game.lc_id || game.lewdCornerId || game.lewdcornerId) ||
      getCleanId(game.steamId || game.steam_id || game.appid)
    )
    if (!hasAnyIdentifier && !hasValidRenpySave) return true
    if (!hasText(game.title || game.inferredTitle || game.saveId)) return true
    if (!hasText(game.version)) return true
    if (!hasText(game.creator)) return true
    if (!hasText(game.engine)) return true
    if (!game.isArchive && !isRenpySave && !hasText(game.selectedValue)) return true
    return ['missingLaunchable', 'emptyFolder'].includes(game.scanStatus)
  }

  const getRowImportStatus = (game) => {
    const scanStatus = game.scanStatus || 'new'

    if (scanStatus === 'pendingMatch') return { text: 'Pending match', type: 'pending' }
    if (scanStatus === 'alreadyImported') return { text: 'Already imported', type: 'alreadyImported' }
    if (scanStatus === 'repairPath') return { text: 'Repair path', type: 'repairPath' }
    if (scanStatus === 'steamVersion') return { text: 'Add as Steam version', type: 'steamVersion' }
    if (scanStatus === 'lewdCornerVersion') return { text: 'Add as LewdCorner version', type: 'lewdCornerVersion' }
    if (scanStatus === 'missingLaunchable') return { text: 'Missing launchable', type: 'missingLaunchable' }
    if (scanStatus === 'emptyFolder') return { text: 'Empty folder', type: 'emptyFolder' }
    if (scanStatus !== 'new') return { text: game.scanMessage || 'Skipped', type: 'blocked' }

    const needsUnmatched = isUnmatchedGame(game) && !includeUnmatched

    if (game.sourceType === 'renpySave') {
      if (needsUnmatched) return { text: 'Requires Import unmatched games', type: 'blocked' }
      if (game.recordId) return { text: 'Already in Library', type: 'ready' }
      if (isImportableGame(game, importOptions)) return { text: 'Ready to import', type: 'ready' }
      return { text: game.scanMessage || 'Not importable', type: 'blocked' }
    }

    if (needsUnmatched) return { text: 'Requires Import unmatched games', type: 'blocked' }
    if (!game.isArchive && !game.selectedValue) {
      return { text: 'Missing launchable', type: 'missingLaunchable' }
    }
    if (isImportableGame(game, importOptions)) {
      if (isSteamImportRow(game)) return { text: 'Steam mapped in-place', type: 'steamVersion' }
      if (game.isArchive) return { text: 'Archive detected - will extract on import', type: 'ready' }
      return {
        text: moveFoldersToLibrary
          ? 'Folder detected - will move to library'
          : 'Folder detected - will import in place',
        type: 'ready',
      }
    }

    return { text: game.scanMessage || 'Not importable', type: 'blocked' }
  }

  const getImportDisabledReason = () => {
    if (canImport) return ''
    if (importMode === 'renpySaves') return 'No Ren\'Py save rows are ready to import'
    const newRows = gamesList.filter((game) => isNewScanRow(game) || isExistingImportRow(game))
    if (newRows.length === 0) return 'No new importable scan rows found'
    const hasUnmatched = newRows.some(isUnmatchedGame)
    if (hasUnmatched && !includeUnmatched) return "Unmatched rows require 'Import unmatched games'"
    return 'No eligible rows are ready to import'
  }

  const saveImporterDefaults = useCallback(async (updates = {}, sectionUpdates = {}) => {
    try {
      const config = await window.electronAPI.getConfig()
      const nextConfig = {
        ...config,
        ...Object.fromEntries(Object.entries(sectionUpdates).map(([section, values]) => [
          section,
          {
            ...(config[section] || {}),
            ...(values || {}),
          },
        ])),
        Importer: {
          ...(config.Importer || {}),
          ...updates,
        },
      }
      const result = await window.electronAPI.saveSettings(nextConfig)
      if (result?.success === false) throw new Error(result.error || 'Save failed')
    } catch (err) {
      console.error('Failed to save importer defaults:', err)
    }
  }, [])

  const currentImporterDefaults = useCallback(() => ({
    sourceGamePath: folder,
    sourceFolderStructure: customFormat,
    useUnstructured,
    downloadBannerImages,
    downloadPreviewImages,
    previewLimit,
    downloadVideos,
    scanSize,
    moveFoldersToLibrary,
    deleteSourceArchiveAfterImport,
    includeUnmatched,
    forceReimport,
  }), [
    folder,
    customFormat,
    useUnstructured,
    downloadBannerImages,
    downloadPreviewImages,
    previewLimit,
    downloadVideos,
    scanSize,
    moveFoldersToLibrary,
    deleteSourceArchiveAfterImport,
    includeUnmatched,
    forceReimport,
  ])

  const persistCurrentImporterDefaults = useCallback(() => saveImporterDefaults(currentImporterDefaults(), {
    Library: {
      gameExtensions: gameExt,
      extractionExtensions: archiveExt,
      libraryFolderStructure: libraryFormat,
      autoSelectLatestReplaceVersion,
    },
    Metadata: {
      mediaStorageMode: downloadBannerImages ? 'download' : 'stream',
      downloadPreviews: downloadPreviewImages,
    },
  }), [
    archiveExt,
    autoSelectLatestReplaceVersion,
    currentImporterDefaults,
    downloadBannerImages,
    downloadPreviewImages,
    gameExt,
    libraryFormat,
    saveImporterDefaults,
  ])

  // ── Sort ──────────────────────────────────────────────────────────────────
  const alphaNumericCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

  const getSortValue = (game, key) => {
    switch (key) {
      case 'atlasId': return game.atlasId || ''
      case 'f95Id': return game.f95Id || ''
      case 'lcId': return game.lcId || game.lewdCornerId || ''
      case 'title': return game.title || ''
      case 'creator': return game.creator || ''
      case 'engine': return game.engine || ''
      case 'version': return game.version || ''
      case 'replaceVersion': return game.replaceVersion || ''
      case 'executable': return game.selectedValue || game.singleExecutable || ''
      case 'databaseMatch':
        if (game.results?.length === 1 && game.results[0]?.key === 'match') return game.results[0].value || 'Match Found'
        if (game.results?.length > 1) { const sel = game.results.find((r) => r.key === game.resultSelectedValue); return sel?.value || game.results[0]?.value || '' }
        return ''
      case 'source': return game.isArchive ? game.sourceFile || game.folder || 'Archive' : game.folder || 'Metadata only'
      case 'status': return getRowImportStatus(game).text
      default: return ''
    }
  }

  const compareRows = (a, b, key, direction) => {
    if (key === 'replaceVersion') {
      const aEmpty = !String(a.game?.replaceVersion || '').trim()
      const bEmpty = !String(b.game?.replaceVersion || '').trim()
      if (aEmpty !== bEmpty) return aEmpty ? 1 : -1
    }
    const aVal = String(getSortValue(a.game, key) ?? '').trim()
    const bVal = String(getSortValue(b.game, key) ?? '').trim()
    const result = alphaNumericCollator.compare(aVal, bVal)
    if (result !== 0) return direction === 'desc' ? -result : result
    return a.originalIndex - b.originalIndex
  }

  const handleSort = (key) => {
    setSortConfig((prev) => {
      if (prev.key !== key) return { key, direction: 'asc' }
      if (prev.direction === 'asc') return { key, direction: 'desc' }
      return { key: '', direction: 'asc' }
    })
  }

  const sortedRows = useMemo(() => {
    const rows = gamesList
      .map((game, originalIndex) => ({ game, originalIndex }))
      .filter(({ game }) => !(hideMatches && game.results?.length === 1 && game.results[0]?.value === 'Match Found'))
    if (!sortConfig.key) return rows
    return [...rows].sort((a, b) => compareRows(a, b, sortConfig.key, sortConfig.direction))
  }, [gamesList, hideMatches, sortConfig, includeUnmatched, forceReimport, moveFoldersToLibrary])

  const selectedScanRowCount = selectedScanRowKeys.size
  const badScanRowCount = useMemo(() => gamesList.filter(isBadScanRow).length, [gamesList])

  useEffect(() => {
    const visibleKeys = new Set(gamesList.map(getScanGameKey))
    setSelectedScanRowKeys((prev) => {
      const next = new Set([...prev].filter((key) => visibleKeys.has(key)))
      return next.size === prev.size ? prev : next
    })
    setLastSelectedScanRowKey((prev) => (prev && visibleKeys.has(prev) ? prev : ''))
  }, [gamesList])

  const clearScanRowSelection = useCallback(() => {
    setSelectedScanRowKeys(new Set())
    setLastSelectedScanRowKey('')
  }, [])

  const deleteScanRowsByKeys = useCallback((keys) => {
    const keysToDelete = new Set([...keys].filter(Boolean))
    if (keysToDelete.size === 0) return
    keysToDelete.forEach((key) => deletedScanGameKeysRef.current.add(key))
    setGamesList((prev) => prev.filter((game) => !keysToDelete.has(getScanGameKey(game))))
    setSelectedScanRowKeys((prev) => new Set([...prev].filter((key) => !keysToDelete.has(key))))
    setLastSelectedScanRowKey((prev) => (keysToDelete.has(prev) ? '' : prev))
  }, [])

  const toggleScanRowSelection = useCallback((gameKey, { replace = false } = {}) => {
    if (!gameKey) return
    setSelectedScanRowKeys((prev) => {
      if (replace) return new Set([gameKey])
      const next = new Set(prev)
      if (next.has(gameKey)) next.delete(gameKey)
      else next.add(gameKey)
      return next
    })
    setLastSelectedScanRowKey(gameKey)
  }, [])

  const selectScanRowRange = useCallback((fromKey, toKey, visibleRowKeys = [], { replace = false } = {}) => {
    if (!toKey) return
    const keys = visibleRowKeys.filter(Boolean)
    const fromIndex = keys.indexOf(fromKey)
    const toIndex = keys.indexOf(toKey)
    if (fromIndex === -1 || toIndex === -1) {
      toggleScanRowSelection(toKey, { replace })
      return
    }
    const [start, end] = fromIndex < toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex]
    const rangeKeys = keys.slice(start, end + 1)
    setSelectedScanRowKeys((prev) => {
      const next = replace ? new Set() : new Set(prev)
      rangeKeys.forEach((key) => next.add(key))
      return next
    })
    setLastSelectedScanRowKey(toKey)
  }, [toggleScanRowSelection])

  const setVisibleScanRowSelection = useCallback((visibleRowKeys = [], shouldSelect = true) => {
    const keys = visibleRowKeys.filter(Boolean)
    setSelectedScanRowKeys((prev) => {
      if (!shouldSelect) return new Set([...prev].filter((key) => !keys.includes(key)))
      const next = new Set(prev)
      keys.forEach((key) => next.add(key))
      return next
    })
    if (shouldSelect && keys.length > 0) setLastSelectedScanRowKey(keys[keys.length - 1])
    if (!shouldSelect && keys.includes(lastSelectedScanRowKey)) setLastSelectedScanRowKey('')
  }, [lastSelectedScanRowKey])

  const deleteSelectedGames = useCallback(({ confirmMany = false } = {}) => {
    if (selectedScanRowKeys.size === 0) return
    if (confirmMany && selectedScanRowKeys.size > 10) {
      const confirmed = window.confirm(`Remove ${selectedScanRowKeys.size} selected rows from this scan? This does not delete files.`)
      if (!confirmed) return
    }
    deleteScanRowsByKeys(selectedScanRowKeys)
    clearScanRowSelection()
  }, [clearScanRowSelection, deleteScanRowsByKeys, selectedScanRowKeys])

  const deleteBadRows = useCallback(() => {
    const keysToDelete = gamesList.filter(isBadScanRow).map(getScanGameKey)
    if (keysToDelete.length === 0) return
    const confirmed = window.confirm(`Remove ${keysToDelete.length} incomplete rows from this scan? This does not delete files.`)
    if (!confirmed) return
    deleteScanRowsByKeys(keysToDelete)
  }, [deleteScanRowsByKeys, gamesList])

  useEffect(() => {
    const isEditableTarget = (target) => {
      if (!target) return false
      if (target.isContentEditable) return true
      return Boolean(target.closest?.('input, textarea, select, button, [contenteditable="true"]'))
    }
    const handleKeyDown = (event) => {
      if (view !== 'scan') return
      if (selectedScanRowKeys.size === 0) return
      if (event.key !== 'Delete') return
      if (isEditableTarget(event.target)) return
      event.preventDefault()
      deleteSelectedGames({ confirmMany: true })
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [deleteSelectedGames, selectedScanRowKeys, view])

  // ── Match resolution ──────────────────────────────────────────────────────
  const applyReplaceOptions = async (game) => {
    const recordId = game?.existingRecordId || game?.recordId
    if (!recordId) return { ...game, replaceVersion: game.replaceVersion || '', replaceOptions: [] }
    try {
      const versions = await window.electronAPI.getReplaceVersionOptions({ recordId })
      const normalizedNew = String(game.version || '').trim().toLowerCase()
      const replaceOptions = (versions || [])
        .filter((v) => { const cv = String(v.version || '').trim().toLowerCase(); return cv && cv !== normalizedNew })
        .sort((a, b) => Number(b.date_added || 0) - Number(a.date_added || 0))
      const defaultReplaceVersion = autoSelectLatestReplaceVersionRef.current && replaceOptions.length > 0 ? replaceOptions[0].version || '' : ''
      return { ...game, replaceVersion: game.replaceVersion || defaultReplaceVersion, replaceOptions }
    } catch (err) {
      return { ...game, replaceVersion: game.replaceVersion || '', replaceOptions: [] }
    }
  }

  const applyImportStatus = async (game) => {
    if (!game) return game
    try {
      const status = await window.electronAPI.getImportRecordStatus(game)
      const recordExist = status?.status === 'alreadyImported'
      const isSteamVersion = status?.status === 'steamVersion'
      const isLewdCornerVersion = status?.status === 'lewdCornerVersion'
      return applyReplaceOptions({
        ...game, recordExist,
        existingRecordId: status?.recordId || '',
        scanStatus: recordExist ? 'alreadyImported' : isSteamVersion ? 'steamVersion' : isLewdCornerVersion ? 'lewdCornerVersion' : status?.status === 'repairPath' ? 'repairPath' : 'new',
        scanMessage: recordExist ? 'Already imported' : isSteamVersion ? 'Add as Steam version' : isLewdCornerVersion ? 'Add as LewdCorner version' : status?.status === 'repairPath' ? 'Repair path' : game.scanMessage || (game.isArchive ? 'Archive' : 'Ready to import'),
      })
    } catch { return applyReplaceOptions(game) }
  }

  const buildMatchResult = (match) => ({
    key: String(match.atlas_id || match.atlasId || ''),
    value: `${match.atlas_id || match.atlasId || ''} | ${match.f95_id || match.f95Id || ''} | ${match.title || ''} | ${match.creator || ''}`,
    atlasId: String(match.atlas_id || match.atlasId || ''),
    f95Id: match.f95_id || match.f95Id || '',
    lcId: match.lc_id || match.lcId || match.lewdCornerId || '',
    lewdCornerSiteUrl: match.lewdCornerSiteUrl || match.lewdcornerSiteUrl || '',
    title: match.title || '',
    creator: match.creator || '',
    engine: match.engine || '',
    latestVersion: match.latestVersion || '',
  })

  const applyAtlasMatchData = (game, match, { f95Id = '', lcId = '' } = {}) => ({
    ...game,
    atlasId: String(match.atlas_id || match.atlasId || ''),
    f95Id: match.f95_id || match.f95Id || f95Id || game.f95Id || '',
    lcId: match.lc_id || match.lcId || match.lewdCornerId || lcId || game.lcId || game.lewdCornerId || '',
    lewdCornerId: match.lc_id || match.lcId || match.lewdCornerId || lcId || game.lewdCornerId || game.lcId || '',
    lewdCornerSiteUrl: match.lewdCornerSiteUrl || match.lewdcornerSiteUrl || game.lewdCornerSiteUrl || '',
    siteUrl: match.siteUrl || match.site_url || game.siteUrl || '',
    title: match.title || game.title,
    creator: match.creator || game.creator,
    engine: match.engine || game.engine || 'Unknown',
    latestVersion: match.latestVersion || game.latestVersion || '',
  })

  const applySelectedMatch = async (game, value) => {
    let updatedGame = normalizeMatchState({ ...game, resultSelectedValue: value })
    const selected = game.results?.find((r) => r.key === value)
    if (selected && value !== 'match') {
      const parts = String(selected.value || '').split(' | ')
      updatedGame = {
        ...updatedGame,
        atlasId: selected.atlasId || parts[0],
        f95Id: selected.f95Id || parts[1] || updatedGame.f95Id || '',
        lcId: selected.lcId || updatedGame.lcId || updatedGame.lewdCornerId || '',
        lewdCornerId: selected.lcId || updatedGame.lewdCornerId || updatedGame.lcId || '',
        lewdCornerSiteUrl: selected.lewdCornerSiteUrl || updatedGame.lewdCornerSiteUrl || '',
        title: selected.title || parts[2],
        creator: selected.creator || parts[3],
        engine: selected.engine || updatedGame.engine,
        latestVersion: selected.latestVersion || updatedGame.latestVersion || '',
      }
      try {
        const atlasData = await window.electronAPI.getAtlasData(updatedGame.atlasId)
        updatedGame = {
          ...updatedGame,
          engine: atlasData.engine || 'Unknown',
          f95Id: atlasData.f95_id || updatedGame.f95Id || '',
          siteUrl: atlasData.siteUrl || atlasData.site_url || updatedGame.siteUrl || '',
          latestVersion: atlasData.latestVersion || '',
        }
      } catch (err) { console.error('Failed to hydrate selected match:', err) }
    }
    if (updatedGame.sourceType === 'renpySave') {
      return normalizeMatchState({
        ...updatedGame,
        version: 'No version',
        selectedValue: '',
        singleExecutable: 'N/A',
        scanMessage: 'Ready as Uninstalled',
      })
    }
    return applyImportStatus(normalizeMatchState(updatedGame))
  }

  const chooseInstalledMatch = async (game, results) => {
    const baseGame = normalizeMatchState({ ...game, results })
    for (const result of results) {
      const candidate = await applySelectedMatch(baseGame, result.key)
      if (['alreadyImported', 'repairPath', 'steamVersion'].includes(candidate.scanStatus)) return candidate
    }
    return applySelectedMatch(baseGame, baseGame.resultSelectedValue || results[0]?.key || '')
  }

  const resolvePendingMatches = async (rows) => {
    const pendingRows = rows.filter((game) => game.scanStatus === 'pendingMatch')
    if (pendingRows.length === 0) return
    matchCancelRef.current = false
    setIsResolvingMatches(true)
    setProgressLabel('Resolving Matches')
    setProgress((prev) => ({ ...prev, value: 0, total: pendingRows.length }))
    await new Promise((r) => setTimeout(r, 16))
    const chunkSize = 10
    let resolvedCount = 0
    for (let i = 0; i < pendingRows.length; i += chunkSize) {
      if (matchCancelRef.current) break
      const chunk = pendingRows.slice(i, i + chunkSize)
      const resolvedRows = await window.electronAPI.resolveImportMatches(chunk)
      if (matchCancelRef.current) break
      const resolvedChunk = await Promise.all(resolvedRows.map((game) => applyImportStatus(game)))
      if (matchCancelRef.current) break
      resolvedCount += resolvedChunk.length
      const resolvedByKey = new Map(resolvedChunk.map((game) => [getScanGameKey(game), game]))
      setGamesList((prev) => prev.map((game) => resolvedByKey.get(getScanGameKey(game)) || game))
      setProgress((prev) => ({ ...prev, value: resolvedCount }))
      window.electronAPI.sendUpdateProgress({ value: resolvedCount, total: pendingRows.length })
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    setIsResolvingMatches(false)
    setProgressLabel(null)
  }

  // ── IPC Setup ─────────────────────────────────────────────────────────────
  const loadConfig = useCallback(() => {
    window.electronAPI.getConfig()
      .then((config) => {
        window.electronAPI.log(`Config loaded: ${JSON.stringify(config)}`)
        const lib = config.Library || {}
        const meta = config.Metadata || {}
        const importer = config.Importer || {}
        const shouldDownload = meta.mediaStorageMode === 'download'
        setFolder(importer.sourceGamePath || '')
        setUseUnstructured(toBoolean(importer.useUnstructured, true))
        setCustomFormat(importer.sourceFolderStructure || defaultSourceFolderStructure)
        setGameExt(lib.gameExtensions || defaultGameExtensions)
        setArchiveExt(lib.extractionExtensions || defaultArchiveExtensions)
        setLibraryFormat(lib.libraryFolderStructure || defaultSourceFolderStructure)
        const autoSelect = lib.autoSelectLatestReplaceVersion === true || lib.autoSelectLatestReplaceVersion === 'true'
        autoSelectLatestReplaceVersionRef.current = autoSelect
        setAutoSelectLatestReplaceVersion(autoSelect)
        setDownloadBannerImages(toBoolean(importer.downloadBannerImages, shouldDownload))
        setDownloadPreviewImages(toBoolean(importer.downloadPreviewImages, toBoolean(meta.downloadPreviews, false)))
        setPreviewLimit(importer.previewLimit || 'Unlimited')
        setDownloadVideos(toBoolean(importer.downloadVideos, false))
        setScanSize(toBoolean(importer.scanSize, false))
        setMoveFoldersToLibrary(toBoolean(importer.moveFoldersToLibrary, false))
        setDeleteSourceArchiveAfterImport(toBoolean(importer.deleteSourceArchiveAfterImport, false))
        setIncludeUnmatched(toBoolean(importer.includeUnmatched, false))
        setForceReimport(toBoolean(importer.forceReimport, false))
        window.electronAPI.getDefaultGameFolder().then((path) => setDefaultLibraryPath(path))
      })
      .catch((err) => console.error('Error loading config:', err))
  }, [])

  const isCurrentScanEvent = (payload) => {
    const eventScanId = payload?.scanId
    return !eventScanId || eventScanId === currentScanIdRef.current
  }

  const normalizeScanFinalPayload = (payload) => {
    if (Array.isArray(payload)) return { games: payload, scanId: null, canceled: false }
    return {
      games: Array.isArray(payload?.games) ? payload.games : [],
      scanId: payload?.scanId || null,
      canceled: payload?.canceled === true,
    }
  }

  useEffect(() => {
    window.electronAPI.log('Importer component mounted')
    window.electronAPI.onWindowStateChanged((state) => setIsMaximized(state === 'maximized'))
    window.electronAPI.onScanProgress((prog) => {
      if (!isCurrentScanEvent(prog)) return
      setProgress(prog)
    })

    window.electronAPI.onScanComplete(async (game) => {
      if (!isCurrentScanEvent(game)) return
      if (game.scanStatus === 'pendingMatch') { addScannedGame(game); return }
      if (game.results?.length > 1 && game.resultSelectedValue && game.resultSelectedValue !== 'match') {
        addScannedGame(await chooseInstalledMatch(game, game.results))
      } else {
        addScannedGame(await applyImportStatus(game))
      }
    })

    window.electronAPI.onScanCompleteFinal(async (payload) => {
      const { games, canceled, scanId } = normalizeScanFinalPayload(payload)
      if (scanId && scanId !== currentScanIdRef.current) return
      steamScanActiveRef.current = false
      setIsScanActive(false)
      setIsCancelingScan(false)
      if (currentScanIdRef.current === scanId) currentScanIdRef.current = null
      if (canceled) {
        matchCancelRef.current = true
        setIsResolvingMatches(false)
        setProgressLabel('Scan canceled')
        setScanMessage('Scan canceled')
        return
      }
      const visibleGamesList = await Promise.all(
        games
          .filter((game) => !deletedScanGameKeysRef.current.has(getScanGameKey(game)))
          .map((game) => game.scanStatus === 'pendingMatch' ? game : applyImportStatus(game))
      )
      setGamesList(visibleGamesList)
      setView('scan')
      resolvePendingMatches(visibleGamesList)
    })

    // When no installed Steam games are found at the default location, the
    // scanner asks for a directory. Let the user point us at their Steam root
    // and re-run the scan against it.
    window.electronAPI.onPromptSteamDirectory(async () => {
      if (!steamScanActiveRef.current) return
      steamScanActiveRef.current = false
      const selected = await window.electronAPI.selectSteamDirectory()
      if (selected) {
        startSteamScan(selected)
      } else {
        alert('No Steam games found and no Steam directory selected.')
        setView('source')
      }
    })

    window.electronAPI.onUpdateProgress((prog) => {
      console.log(`Update progress: ${JSON.stringify(prog)}`)
      setUpdateProgress(prog)
    })

    loadConfig()

    return () => {
      ;['window-state-changed', 'scan-progress', 'scan-complete', 'scan-complete-final', 'update-progress', 'prompt-steam-directory']
        .forEach((ch) => window.electronAPI.removeAllListeners(ch))
    }
  }, [])

  // ── Actions ───────────────────────────────────────────────────────────────
  const addScannedGame = (game) => {
    const gameKey = getScanGameKey(game)
    if (deletedScanGameKeysRef.current.has(gameKey)) return
    setGamesList((prev) => {
      // Guard against the scan-complete (append) vs scan-complete-final
      // (replace) race: if a row with this key already exists, replace it
      // instead of appending a duplicate.
      const idx = prev.findIndex((g) => getScanGameKey(g) === gameKey)
      if (idx !== -1) {
        const next = prev.slice()
        next[idx] = game
        return next
      }
      return [...prev, game]
    })
  }

  const resetImporterSourceState = () => {
    currentScanIdRef.current = null
    steamScanActiveRef.current = false
    matchCancelRef.current = true
    deletedScanGameKeysRef.current.clear()
    setIsScanActive(false)
    setIsCancelingScan(false)
    setIsResolvingMatches(false)
    setGamesList([])
    clearScanRowSelection()
    setProgress(initialScanProgress)
    setProgressLabel(null)
    setScanPath('')
    setScanMessage('')
  }

  // Re-read config when user navigates to settings step so latest saved settings apply
  useEffect(() => {
    if (view === 'settings') loadConfig()
  }, [view, loadConfig])

  const selectFolder = async () => {
    const path = await window.electronAPI.selectDirectory()
    if (path) {
      window.electronAPI.log(`Folder selected: ${path}`)
      setFolder(path)
      saveImporterDefaults({ sourceGamePath: path })
    }
  }

  const handleCustomFormatChange = (value) => {
    setCustomFormat(value)
    saveImporterDefaults({ sourceFolderStructure: value })
  }

  const handleUseUnstructuredChange = (checked) => {
    setUseUnstructured(checked)
    saveImporterDefaults({ useUnstructured: checked })
  }

  const handleGameExtChange = (value) => {
    setGameExt(value)
    saveImporterDefaults({}, { Library: { gameExtensions: value } })
  }

  const handleArchiveExtChange = (value) => {
    setArchiveExt(value)
    saveImporterDefaults({}, { Library: { extractionExtensions: value } })
  }

  const handleDownloadBannerImagesChange = (checked) => {
    setDownloadBannerImages(checked)
    saveImporterDefaults(
      { downloadBannerImages: checked },
      { Metadata: { mediaStorageMode: checked ? 'download' : 'stream' } },
    )
  }

  const handleDownloadPreviewImagesChange = (checked) => {
    setDownloadPreviewImages(checked)
    saveImporterDefaults(
      { downloadPreviewImages: checked },
      { Metadata: { downloadPreviews: checked } },
    )
  }

  const handleDeleteSourceArchiveAfterImportChange = (checked) => {
    setDeleteSourceArchiveAfterImport(checked)
    saveImporterDefaults({ deleteSourceArchiveAfterImport: checked })
  }

  const handleMoveFoldersToLibraryChange = (checked) => {
    setMoveFoldersToLibrary(checked)
    saveImporterDefaults({ moveFoldersToLibrary: checked })
  }

  const startScan = async () => {
    if (!folder) return alert('Select a folder')
    if (isScanActive || isCancelingScan) return alert('Another scan is already running')
    await persistCurrentImporterDefaults()
    const scanId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`
    currentScanIdRef.current = scanId
    setImportMode('games')
    setScanPath(folder)
    setScanMessage('')
    setProgressLabel('Scanning')
    setProgress(initialScanProgress)
    setView('scan')
    setIsScanActive(true)
    setIsCancelingScan(false)
    matchCancelRef.current = false
    steamScanActiveRef.current = false
    deletedScanGameKeysRef.current.clear()
    clearScanRowSelection()
    setGamesList([])
    const params = {
      folder, mode: 'local', scanId, deferMatching: true,
      format: useUnstructured ? '' : customFormat,
      gameExt: gameExt.split(',').map((e) => e.trim()),
      archiveExt: archiveExt.split(',').map((e) => e.trim()),
      scanSize, downloadBannerImages,
      downloadPreviewImages, previewLimit, downloadVideos,
    }
    window.electronAPI.log(`Scan params: ${JSON.stringify(params)}`)
    const result = await window.electronAPI.startScan(params)
    if (result?.scanId && result.scanId !== currentScanIdRef.current) return
    if (result?.canceled) {
      setScanMessage('Scan canceled')
      setProgressLabel('Scan canceled')
      return
    }
    if (!result.success) {
      currentScanIdRef.current = null
      setIsScanActive(false)
      setIsCancelingScan(false)
      setProgressLabel(null)
      console.error(`Scan error: ${result.error}`)
      alert(`Error: ${result.error}`)
    }
  }

  // Kick off a scan of the local Steam library. Steam rows are emitted through
  // the same scan-progress / scan-complete / scan-complete-final channel as the
  // Atlas importer, so they flow into the existing ScanStep table unchanged.
  const startSteamScan = async (steamPath = null) => {
    currentScanIdRef.current = null
    setImportMode('steam')
    setScanPath(steamPath || 'Steam library')
    setScanMessage('')
    setProgressLabel('Scanning Steam')
    setProgress(initialScanProgress)
    setView('scan')
    setIsScanActive(false)
    setIsCancelingScan(false)
    matchCancelRef.current = false
    deletedScanGameKeysRef.current.clear()
    clearScanRowSelection()
    setGamesList([])
    steamScanActiveRef.current = true
    const result = await window.electronAPI.startSteamScan(steamPath ? { steamPath } : {})
    if (result && result.success === false && result.error) {
      // A "no games found" miss is surfaced via prompt-steam-directory instead
      // of an error, so only alert on genuine failures.
      console.error(`Steam scan error: ${result.error}`)
    }
  }

  const startRenpyScan = async (renpyRoot = null) => {
    currentScanIdRef.current = null
    setImportMode('renpySaves')
    setView('scan')
    setIsScanActive(false)
    setIsCancelingScan(false)
    matchCancelRef.current = false
    deletedScanGameKeysRef.current.clear()
    clearScanRowSelection()
    setGamesList([])
    setProgress({ ...initialScanProgress, total: 1 })
    setProgressLabel("Looking for Ren'Py save folder...")
    setScanPath(renpyRoot || '')
    setScanMessage('')
    try {
      let result = await window.electronAPI.scanRenpySaves(renpyRoot ? { rootPath: renpyRoot } : {})
      if (result?.needsSelection) {
        setScanPath(result.rootPath || '')
        setScanMessage(result.message || "Ren'Py save folder was not found. Select it manually.")
        setProgress(initialScanProgress)
        setProgressLabel("Ren'Py save folder not found")
        return
      }
      if (!result?.success) {
        setScanPath(result?.rootPath || renpyRoot || '')
        setScanMessage(result?.error || "Ren'Py save scan failed")
        setProgress(initialScanProgress)
        setProgressLabel("Ren'Py save scan failed")
        return
      }
      const rows = result.games || []
      setFolder(result.rootPath || renpyRoot || '')
      setScanPath(result.rootPath || renpyRoot || '')
      setScanMessage(result.warning || (rows.length === 0 ? `Found 0 folders in ${result.rootPath || renpyRoot || 'selected folder'}` : ''))
      setProgress({ ...initialScanProgress, value: rows.length, total: rows.length, potential: rows.length, totalFound: rows.length })
      setGamesList(rows)
      setProgressLabel("Ren'Py Save Folders")
    } catch (err) {
      setScanMessage(`Ren'Py save scan failed: ${err.message || err}`)
      setProgress(initialScanProgress)
      setProgressLabel("Ren'Py save scan failed")
    }
  }

  const selectRenpySaveFolder = async () => {
    const selected = await window.electronAPI.selectRenpySaveDirectory()
    if (selected) startRenpyScan(selected)
  }

  useEffect(() => {
    const handleImporterSource = (source) => {
      const safeSource = normalizeImporterSource(source)
      const now = Date.now()
      if (
        lastSourceSelectionRef.current.source === safeSource &&
        now - lastSourceSelectionRef.current.at < 750
      ) {
        return
      }
      lastSourceSelectionRef.current = { source: safeSource, at: now }

      if (safeSource === 'steam') {
        startSteamScan()
        return
      }
      if (safeSource === 'renpy') {
        startRenpyScan()
        return
      }
      resetImporterSourceState()
      setImportMode('games')
      setView('settings')
    }

    const querySource = new URLSearchParams(window.location.search).get('source') || 'atlas'
    handleImporterSource(querySource)
    window.electronAPI.onImportSource?.(handleImporterSource)
    return () => window.electronAPI.removeAllListeners?.('import-source')
  }, [])

  const updateGame = (gameKey, field, value) => {
    setGamesList((prev) => prev.map((g) => getScanGameKey(g) === gameKey ? { ...g, [field]: value } : g))
  }

  const hydrateManualF95Id = async (gameKey, rawValue, { refresh = false } = {}) => {
    const normalizedF95Id = normalizeF95IdInput(rawValue)
    setGamesList((prev) => prev.map((game) =>
      getScanGameKey(game) === gameKey
        ? { ...game, f95Id: normalizedF95Id }
        : game
    ))

    if (!refresh || !normalizedF95Id) return

    const sourceGame = gamesList.find((game) => getScanGameKey(game) === gameKey)
    if (!sourceGame || !isNewScanRow(sourceGame)) return

    let data = []
    try {
      data = await window.electronAPI.searchAtlasByF95Id(normalizedF95Id)
    } catch (err) {
      console.error('Failed to hydrate manual F95 ID:', err)
    }

    const applyIfCurrent = (nextGame) => {
      setGamesList((prev) => prev.map((game) => {
        if (getScanGameKey(game) !== gameKey) return game
        if (normalizeF95IdInput(game.f95Id) !== normalizedF95Id) return game
        return nextGame
      }).filter((game) => !deletedScanGameKeysRef.current.has(getScanGameKey(game))))
    }

    if (data.length === 1) {
      const matchedGame = await applyImportStatus({
        ...sourceGame,
        atlasId: String(data[0].atlas_id),
        f95Id: data[0].f95_id || normalizedF95Id,
        siteUrl: data[0].siteUrl || data[0].site_url || sourceGame.siteUrl || '',
        title: data[0].title,
        creator: data[0].creator,
        engine: data[0].engine || sourceGame.engine || 'Unknown',
        latestVersion: data[0].latestVersion || '',
        results: [{ key: 'match', value: 'Match Found' }],
        resultSelectedValue: 'match',
        resultVisibility: 'visible',
      })
      applyIfCurrent(matchedGame)
      return
    }

    if (data.length > 1) {
      const results = data.map((match) => ({
        key: String(match.atlas_id),
        value: `${match.atlas_id} | ${match.f95_id || ''} | ${match.title} | ${match.creator}`,
      }))
      const validSelection = results.some((result) => result.key === sourceGame.resultSelectedValue)
        ? sourceGame.resultSelectedValue
        : results[0]?.key || ''
      applyIfCurrent(normalizeMatchState({
        ...sourceGame,
        f95Id: normalizedF95Id,
        atlasId: '',
        results,
        resultSelectedValue: validSelection,
        resultVisibility: 'visible',
        scanMessage: 'Select matching result',
      }))
      return
    }

    const unmatchedGame = await applyImportStatus({
      ...sourceGame,
      atlasId: '',
      f95Id: normalizedF95Id,
      results: [],
      resultSelectedValue: '',
      resultVisibility: 'hidden',
    })
    applyIfCurrent({ ...unmatchedGame, f95Id: normalizedF95Id, scanMessage: 'No F95 match found' })
  }

  const hydrateManualLcId = async (gameKey, rawValue, { refresh = false } = {}) => {
    const normalizedLcId = normalizeLcIdInput(rawValue)
    setGamesList((prev) => prev.map((game) =>
      getScanGameKey(game) === gameKey
        ? { ...game, lcId: normalizedLcId || rawValue, lewdCornerId: normalizedLcId || game.lewdCornerId || '' }
        : game
    ))

    if (!refresh || !normalizedLcId) return

    const sourceGame = gamesList.find((game) => getScanGameKey(game) === gameKey)
    if (!sourceGame || !isNewScanRow(sourceGame)) return

    let data = []
    try {
      data = await window.electronAPI.searchAtlasByLewdCornerId(normalizedLcId)
    } catch (err) {
      console.error('Failed to hydrate manual LewdCorner ID:', err)
    }

    const applyIfCurrent = (nextGame) => {
      setGamesList((prev) => prev.map((game) => {
        if (getScanGameKey(game) !== gameKey) return game
        if (normalizeLcIdInput(game.lcId || game.lewdCornerId) !== normalizedLcId) return game
        return nextGame
      }).filter((game) => !deletedScanGameKeysRef.current.has(getScanGameKey(game))))
    }

    if (data.length === 1) {
      const matchedGame = await applyImportStatus({
        ...applyAtlasMatchData(sourceGame, data[0], { lcId: normalizedLcId }),
        results: [{ key: 'match', value: 'Match Found' }],
        resultSelectedValue: 'match',
        resultVisibility: 'visible',
      })
      applyIfCurrent(matchedGame)
      return
    }

    if (data.length > 1) {
      const results = data.map(buildMatchResult).filter((result) => result.key)
      const validSelection = results.some((result) => result.key === sourceGame.resultSelectedValue)
        ? sourceGame.resultSelectedValue
        : results[0]?.key || ''
      applyIfCurrent(normalizeMatchState({
        ...sourceGame,
        lcId: normalizedLcId,
        lewdCornerId: normalizedLcId,
        atlasId: '',
        results,
        resultSelectedValue: validSelection,
        resultVisibility: 'visible',
        scanMessage: 'Select matching result',
      }))
      return
    }

    const unmatchedGame = await applyImportStatus({
      ...sourceGame,
      atlasId: '',
      lcId: normalizedLcId,
      lewdCornerId: normalizedLcId,
      results: [],
      resultSelectedValue: '',
      resultVisibility: 'hidden',
    })
    applyIfCurrent({ ...unmatchedGame, lcId: normalizedLcId, lewdCornerId: normalizedLcId, scanMessage: 'No LewdCorner match found' })
  }

  const deleteGame = (gameKey) => {
    deleteScanRowsByKeys([gameKey])
  }

  const handleResultChange = async (gameKey, value) => {
    const updatedGames = gamesList.map((game) =>
      getScanGameKey(game) === gameKey ? applySelectedMatch(game, value) : game
    )
    Promise.all(updatedGames).then((newGamesList) =>
      setGamesList(newGamesList.filter((game) => !deletedScanGameKeysRef.current.has(getScanGameKey(game))))
    )
  }

  const updateMatches = async () => {
    const total = gamesList.length
    if (total === 0) return
    matchCancelRef.current = false
    setIsResolvingMatches(true)
    setProgressLabel('Updating Matches')
    setProgress((prev) => ({ ...prev, value: 0, total }))
    await new Promise((r) => setTimeout(r, 16))
    let updatedGames = gamesList.map((game) => ({ ...game }))
    const originalF95ByKey = new Map(updatedGames.map((game) => [getScanGameKey(game), normalizeF95IdInput(game.f95Id)]))
    const originalLcByKey = new Map(updatedGames.map((game) => [getScanGameKey(game), normalizeLcIdInput(game.lcId || game.lewdCornerId)]))
    for (let i = 0; i < updatedGames.length; i++) {
      if (matchCancelRef.current) break
      let game = { ...updatedGames[i] }
      if (!isNewScanRow(game) && game.scanStatus !== 'pendingMatch') {
        setProgress((prev) => ({ ...prev, value: i + 1 }))
        await new Promise((r) => setTimeout(r, 0))
        continue
      }
      const f95IdStr = normalizeF95IdInput(game.f95Id)
      const lcIdStr = normalizeLcIdInput(game.lcId || game.lewdCornerId)
      game = { ...game, f95Id: f95IdStr, lcId: lcIdStr || game.lcId || '', lewdCornerId: lcIdStr || game.lewdCornerId || '' }
      if (game.sourceType !== 'renpySave' && !f95IdStr && !lcIdStr && game.atlasId && game.results?.length === 1 && game.results[0]?.key === 'match' && game.resultVisibility === 'visible') {
        updatedGames[i] = game
        setProgress((prev) => ({ ...prev, value: i + 1 }))
        await new Promise((r) => setTimeout(r, 0))
        continue
      }
      let data
      try {
        data = f95IdStr ? await window.electronAPI.searchAtlasByF95Id(f95IdStr) : []
        if (matchCancelRef.current) break
        if (!data.length && !f95IdStr && lcIdStr) {
          data = await window.electronAPI.searchAtlasByLewdCornerId(lcIdStr)
        }
        if (matchCancelRef.current) break
        if (!data.length && !f95IdStr && !lcIdStr) {
          data = await window.electronAPI.searchAtlas(game.lookupTitle || game.title, game.creator)
        }
        if (matchCancelRef.current) break
      } catch { data = [] }
      if (data.length === 1) {
        game = await applyImportStatus({
          ...applyAtlasMatchData(game, data[0], { f95Id: f95IdStr, lcId: lcIdStr }),
          results: [{ key: 'match', value: 'Match Found' }],
          resultSelectedValue: 'match',
          resultVisibility: 'visible',
        })
        if (matchCancelRef.current) break
      } else if (data.length > 1) {
        const results = data.map(buildMatchResult).filter((result) => result.key)
        const valid = results.find((r) => r.key === game.resultSelectedValue)
        game = await chooseInstalledMatch({ ...game, resultSelectedValue: valid ? game.resultSelectedValue : results[0].key }, results)
        if (matchCancelRef.current) break
      } else {
        game = await applyImportStatus({ ...game, atlasId: '', f95Id: f95IdStr || game.f95Id || '', lcId: lcIdStr || game.lcId || game.lewdCornerId || '', lewdCornerId: lcIdStr || game.lewdCornerId || '', results: [], resultSelectedValue: '', resultVisibility: 'hidden' })
        if (f95IdStr) game = { ...game, f95Id: f95IdStr, scanMessage: 'No F95 match found' }
        else if (lcIdStr) game = { ...game, lcId: lcIdStr, lewdCornerId: lcIdStr, scanMessage: 'No LewdCorner match found' }
        if (matchCancelRef.current) break
      }
      updatedGames[i] = game
      setProgress((prev) => ({ ...prev, value: i + 1 }))
      window.electronAPI.sendUpdateProgress({ value: i + 1, total })
      await new Promise((r) => setTimeout(r, 50))
    }
    if (!matchCancelRef.current) {
      setGamesList((prev) => {
        const currentByKey = new Map(prev.map((game) => [getScanGameKey(game), game]))
        return updatedGames.reduce((rows, game) => {
          const gameKey = getScanGameKey(game)
          if (deletedScanGameKeysRef.current.has(gameKey)) return rows
          const current = currentByKey.get(gameKey)
          if (current && normalizeF95IdInput(current.f95Id) !== originalF95ByKey.get(gameKey)) {
            rows.push(current)
          } else if (current && normalizeLcIdInput(current.lcId || current.lewdCornerId) !== originalLcByKey.get(gameKey)) {
            rows.push(current)
          } else {
            rows.push(game)
          }
          return rows
        }, [])
      })
      setProgress((prev) => ({ ...prev, value: total }))
      window.electronAPI.sendUpdateProgress({ value: total, total })
    }
    setIsResolvingMatches(false)
    setProgressLabel(null)
  }

  const cancelScanOrMatch = async () => {
    matchCancelRef.current = true
    if (isScanActive && !isCancelingScan) {
      setIsCancelingScan(true)
      setProgressLabel('Canceling scan...')
      setScanMessage('Canceling scan...')
      await window.electronAPI.cancelScan?.()
    }
    setIsResolvingMatches(false)
  }

  const importGamesFunc = async () => {
    const gamesToImport = gamesList.filter((game) => isImportableGame(game, importOptions))
    if (gamesToImport.length === 0) { alert('No games to import'); return }
    if (importMode === 'renpySaves') {
      try {
        const result = await window.electronAPI.importRenpySaveGames(gamesToImport)
        if (!result?.success) {
          alert(result?.error || "Ren'Py save import failed")
          return
        }
        window.electronAPI.closeWindow()
      } catch (err) {
        alert(`Ren'Py save import failed: ${err.message || 'Unknown error'}`)
      }
      return
    }
    let finalLibraryPath = defaultLibraryPath
    const importNeedsLibrary = gamesToImport.some((game) => game.isArchive || (moveFoldersToLibrary && !isSteamImportRow(game)))
    if (importNeedsLibrary && !finalLibraryPath) {
      setAskingForLibraryFolder(true)
      const selected = await window.electronAPI.selectDirectory()
      setAskingForLibraryFolder(false)
      if (!selected) return alert('Choose a library folder to continue')
      else {
        try {
          const saveResult = await window.electronAPI.setDefaultGameFolder(selected)
          if (saveResult.success) { finalLibraryPath = selected; setDefaultLibraryPath(selected) }
          else {
            alert('Failed to save default library folder.')
            return
          }
        } catch {
          alert('Error saving library path.')
          return
        }
      }
    }
    const gamesForImport = gamesToImport.map((game) => {
      if (!isSteamImportRow(game)) return game
      const steamId = String(game.steamId || game.steam_id || game.steam_appid || game.appid || '').trim()
      return { ...game, sourceType: 'steam', steamId: /^\d+$/.test(steamId) ? steamId : game.steamId }
    })
    const importParams = {
      games: gamesForImport,
      sourceRoot: folder,
      deleteSourceArchiveAfterImport,
      moveFoldersToLibrary,
      scanSize,
      downloadBannerImages,
      downloadPreviewImages,
      previewLimit,
      downloadVideos,
      gameExt: gameExt.split(',').map((e) => e.trim()),
      forceReimport,
      libraryFormat,
    }
    try {
      window.electronAPI.importGames(importParams)
      window.electronAPI.closeWindow()
    } catch (err) { alert(`Import failed: ${err.message || 'Unknown error'}`) }
  }

  const handleAutoSelectChange = async (e) => {
    const checked = e.target.checked
    autoSelectLatestReplaceVersionRef.current = checked
    setAutoSelectLatestReplaceVersion(checked)
    if (checked) {
      setGamesList((prev) => prev.map((game) => {
        if (game.replaceVersion || !game.replaceOptions?.length) return game
        return { ...game, replaceVersion: game.replaceOptions[0].version || '' }
      }))
    }
    try {
      const config = await window.electronAPI.getConfig()
      await window.electronAPI.saveSettings({ ...config, Library: { ...(config.Library || {}), autoSelectLatestReplaceVersion: checked } })
    } catch (err) { console.error('Failed to save replacement default setting:', err) }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="h-screen flex flex-col fixed w-full">
      <div className="bg-primary h-8 flex justify-end items-center pr-2 -webkit-app-region-drag">
        <p className="text-sm absolute left-2 top-1">Import Games Wizard</p>
        <div className="flex absolute top-1 right-2 h-[70px] -webkit-app-region-no-drag">
          <button onClick={() => window.electronAPI.minimizeWindow()} className="w-6 h-6 flex items-center justify-center bg-transparent hover:bg-tertiary transition-colors duration-200" style={{ pointerEvents: 'auto', zIndex: 1000 }}>
            <i className="fas fa-minus fa-xs text-text"></i>
          </button>
          <button onClick={() => window.electronAPI.maximizeWindow()} className="w-6 h-6 flex items-center justify-center bg-transparent hover:bg-tertiary transition-colors duration-200" style={{ pointerEvents: 'auto', zIndex: 1000 }}>
            <i className={isMaximized ? 'fas fa-window-restore fa-xs text-text' : 'fas fa-window-maximize fa-xs text-text'}></i>
          </button>
          <button onClick={() => window.electronAPI.closeWindow()} className="w-6 h-6 flex items-center justify-center bg-transparent hover:bg-danger transition-colors duration-200" style={{ pointerEvents: 'auto', zIndex: 1000 }}>
            <i className="fas fa-times fa-xs text-text"></i>
          </button>
        </div>
      </div>

      <div className="flex-1 p-4 bg-secondary overflow-y-auto">
        {view === 'settings' && (
          <SettingsStep
            folder={folder} customFormat={customFormat} useUnstructured={useUnstructured}
            gameExt={gameExt} archiveExt={archiveExt}
            downloadBannerImages={downloadBannerImages} downloadPreviewImages={downloadPreviewImages}
            previewLimit={previewLimit} deleteSourceArchiveAfterImport={deleteSourceArchiveAfterImport}
            moveFoldersToLibrary={moveFoldersToLibrary}
            autoSelectLatestReplaceVersion={autoSelectLatestReplaceVersion}
            defaultLibraryPath={defaultLibraryPath} askingForLibraryFolder={askingForLibraryFolder}
            onSelectFolder={selectFolder} onStartScan={startScan}
            setCustomFormat={handleCustomFormatChange} setUseUnstructured={handleUseUnstructuredChange}
            setGameExt={handleGameExtChange} setArchiveExt={handleArchiveExtChange}
            setDownloadBannerImages={handleDownloadBannerImagesChange}
            setDownloadPreviewImages={handleDownloadPreviewImagesChange}
            setMoveFoldersToLibrary={handleMoveFoldersToLibraryChange}
            setDeleteSourceArchiveAfterImport={handleDeleteSourceArchiveAfterImportChange}
            onAutoSelectChange={handleAutoSelectChange}
          />
        )}

        {view === 'scan' && (
          <ScanStep
            progress={progress} progressLabel={progressLabel}
            visibleStats={visibleStats}
            sortedRows={sortedRows} isNewScanRow={isNewScanRow} sortConfig={sortConfig}
            hideMatches={hideMatches} includeUnmatched={includeUnmatched}
            forceReimport={forceReimport}
            selectedRowKeys={selectedScanRowKeys}
            selectedRowCount={selectedScanRowCount}
            badRowCount={badScanRowCount}
            lastSelectedRowKey={lastSelectedScanRowKey}
            canImport={canImport} isResolvingMatches={isResolvingMatches}
            isScanActive={isScanActive} isCancelingScan={isCancelingScan}
            getImportDisabledReason={getImportDisabledReason}
            importMode={importMode} scanPath={scanPath} scanMessage={scanMessage}
            onSort={handleSort} onUpdateGame={updateGame} onDeleteGame={deleteGame}
            onToggleRowSelection={toggleScanRowSelection}
            onSelectRowRange={selectScanRowRange}
            onSetVisibleRowSelection={setVisibleScanRowSelection}
            onClearRowSelection={clearScanRowSelection}
            onDeleteSelectedRows={deleteSelectedGames}
            onDeleteBadRows={deleteBadRows}
            onResultChange={handleResultChange} onUpdateMatches={updateMatches}
            onHydrateManualF95Id={hydrateManualF95Id}
            onHydrateManualLcId={hydrateManualLcId}
            onCancelMatch={cancelScanOrMatch} onImport={importGamesFunc}
            onSelectRenpyFolder={selectRenpySaveFolder}
            getGameKey={getScanGameKey} getRowImportStatus={getRowImportStatus}
            setHideMatches={setHideMatches} setIncludeUnmatched={setIncludeUnmatched}
            setForceReimport={setForceReimport}
          />
        )}
      </div>
    </div>
  )
}

export default Importer
