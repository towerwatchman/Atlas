import { useEffect, useMemo, useRef, useState } from 'react'
import { formatVersionDate } from '../../../utils/formatVersionDate.js'

const SCAN_TABLE_COLUMNS = [
  { key: 'select', width: 44, minWidth: 44 },
  { key: 'atlasId', width: 90, minWidth: 80 },
  { key: 'f95Id', width: 100, minWidth: 80 },
  { key: 'lcId', width: 100, minWidth: 80 },
  { key: 'title', width: 220, minWidth: 140 },
  { key: 'creator', width: 160, minWidth: 120 },
  { key: 'engine', width: 110, minWidth: 90 },
  { key: 'version', width: 200, minWidth: 120 },
  { key: 'replaceVersion', width: 180, minWidth: 140 },
  { key: 'executable', width: 180, minWidth: 130 },
  { key: 'databaseMatch', width: 220, minWidth: 160 },
  { key: 'source', width: 280, minWidth: 160 },
  { key: 'status', width: 150, minWidth: 110 },
  { key: 'actions', width: 220, minWidth: 180 },
]

const DEFAULT_COLUMN_WIDTHS = Object.fromEntries(SCAN_TABLE_COLUMNS.map((column) => [column.key, column.width]))
const MIN_COLUMN_WIDTHS = Object.fromEntries(SCAN_TABLE_COLUMNS.map((column) => [column.key, column.minWidth]))

// In-row editable controls render with a transparent background (so the row
// color shows through) and no border or vertical padding — the surrounding
// <td> already draws the grid lines, so the control blends into the cell.
const ROW_INPUT_CLASS = 'w-full bg-transparent border-0 px-1 py-0 focus:outline-none focus:ring-1 focus:ring-accent'
// Combo boxes keep a solid background and text color so the dropdown list stays
// readable, and reserve right padding so the native arrow never overlaps text.
const ROW_SELECT_CLASS = 'w-full bg-secondary text-text border-0 pl-1 pr-6 py-0 focus:outline-none focus:ring-1 focus:ring-accent'

const isValidHttpUrl = (value) => {
  try {
    const url = new URL(String(value || '').trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const getCleanId = (value) => {
  const id = String(value || '').trim()
  return /^\d+$/.test(id) ? id : ''
}

const getSourceUrls = (game = {}) => {
  const f95Id = getCleanId(game.f95Id || game.f95_id)
  const lcId = getCleanId(game.lcId || game.lc_id || game.lewdCornerId || game.lewdcornerId)
  const steamId = getCleanId(game.steamId || game.steam_id || game.appid)
  const f95Url = [game.siteUrl, game.site_url, game.f95Url]
    .find(isValidHttpUrl) || (f95Id ? `https://f95zone.to/threads/${f95Id}/` : '')
  const steamUrl = [game.steamUrl, game.storeUrl]
    .find(isValidHttpUrl) || (steamId ? `https://store.steampowered.com/app/${steamId}/` : '')
  const lewdCornerUrl = [game.lewdCornerSiteUrl, game.lewdcornerSiteUrl]
    .find(isValidHttpUrl) || (lcId ? `https://lewdcorner.com/threads/${lcId}/` : '')
  const atlasUrl = [game.atlasUrl, game.sourceUrl]
    .find(isValidHttpUrl) || ''

  return {
    f95: isValidHttpUrl(f95Url) ? f95Url : '',
    lewdcorner: isValidHttpUrl(lewdCornerUrl) ? lewdCornerUrl : '',
    steam: isValidHttpUrl(steamUrl) ? steamUrl : '',
    atlas: isValidHttpUrl(atlasUrl) ? atlasUrl : '',
  }
}

const normalizePathForCompare = (value) =>
  String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '')

const getRelativeScanPath = (targetPath, scanPath) => {
  const target = normalizePathForCompare(targetPath)
  const root = normalizePathForCompare(scanPath)
  if (!target || !root) return targetPath || ''
  const targetLower = target.toLowerCase()
  const rootLower = root.toLowerCase()
  if (targetLower === rootLower) return target.split('/').pop() || targetPath || ''
  if (!targetLower.startsWith(`${rootLower}/`)) return targetPath || ''
  return target.slice(root.length + 1) || targetPath || ''
}

export default function ScanTable({
  sortedRows, isNewScanRow, sortConfig,
  onSort, onUpdateGame, onDeleteGame, onResultChange, getGameKey,
  getRowImportStatus, onHydrateManualF95Id, onHydrateManualLcId,
  selectedRowKeys = new Set(), lastSelectedRowKey = '',
  onToggleRowSelection, onSelectRowRange, onSetVisibleRowSelection,
  showReplaceVersion = true,
  scanPath = '',
}) {
  const selectAllRef = useRef(null)
  const [columnWidths, setColumnWidths] = useState(DEFAULT_COLUMN_WIDTHS)
  // Columns the user has dragged to resize — auto-sizing leaves these alone.
  const manualResizeRef = useRef(new Set())
  const visibleColumns = useMemo(
    () => (showReplaceVersion ? SCAN_TABLE_COLUMNS : SCAN_TABLE_COLUMNS.filter((column) => column.key !== 'replaceVersion')),
    [showReplaceVersion],
  )
  const visibleRowKeys = useMemo(() => sortedRows.map(({ game }) => getGameKey(game)), [getGameKey, sortedRows])
  const selectedVisibleCount = visibleRowKeys.filter((key) => selectedRowKeys.has(key)).length
  const allVisibleSelected = visibleRowKeys.length > 0 && selectedVisibleCount === visibleRowKeys.length
  const someVisibleSelected = selectedVisibleCount > 0 && selectedVisibleCount < visibleRowKeys.length
  const tableMinWidth = useMemo(
    () => visibleColumns.reduce((sum, column) => sum + (columnWidths[column.key] || column.width), 0),
    [columnWidths, visibleColumns],
  )

  // Size the Database Match column to its longest value so the full match text
  // is visible (capped, and skipped if the user has manually resized it).
  const databaseMatchWidth = useMemo(() => {
    let maxLen = 'Database Match'.length
    for (const { game } of sortedRows) {
      const results = Array.isArray(game.results) ? game.results : []
      if (results.length === 1 && results[0]?.key === 'match') {
        maxLen = Math.max(maxLen, String(results[0].value || '').length)
      } else {
        for (const result of results) maxLen = Math.max(maxLen, String(result.value || '').length)
      }
    }
    // ~7px/char + horizontal padding (pl-1 pr-6) + arrow + cell padding.
    const px = Math.round(maxLen * 7.2) + 48
    return Math.min(640, Math.max(MIN_COLUMN_WIDTHS.databaseMatch || 160, px))
  }, [sortedRows])

  useEffect(() => {
    if (manualResizeRef.current.has('databaseMatch')) return
    setColumnWidths((prev) => (
      prev.databaseMatch === databaseMatchWidth ? prev : { ...prev, databaseMatch: databaseMatchWidth }
    ))
  }, [databaseMatchWidth])

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someVisibleSelected
  }, [someVisibleSelected])

  const getSortIndicator = (key) => {
    if (sortConfig.key !== key) return ''
    return sortConfig.direction === 'asc' ? ' ▲' : ' ▼'
  }

  const formatReplaceVersionLabel = (version) => {
    const dateAdded = formatVersionDate(version.date_added, '')
    return `${version.version}${dateAdded.isValid ? ` - ${dateAdded.absolute}` : ''}`
  }

  const beginColumnResize = (event, columnKey) => {
    event.preventDefault()
    event.stopPropagation()
    manualResizeRef.current.add(columnKey)
    const startX = event.clientX
    const startWidth = columnWidths[columnKey] || DEFAULT_COLUMN_WIDTHS[columnKey]
    const minWidth = MIN_COLUMN_WIDTHS[columnKey] || 80

    const handleMouseMove = (moveEvent) => {
      const nextWidth = Math.max(minWidth, startWidth + moveEvent.clientX - startX)
      setColumnWidths((current) => ({ ...current, [columnKey]: nextWidth }))
    }
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  const renderResizeHandle = (columnKey) => (
    <span
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize column"
      onMouseDown={(event) => beginColumnResize(event, columnKey)}
      className="absolute top-0 right-0 h-full w-2 cursor-col-resize select-none hover:bg-accent/40"
      style={{ pointerEvents: 'auto' }}
    />
  )

  const renderSortableHeader = (sortKey, label, className = '') => (
    <th
      className={`relative border border-border p-1 pr-3 cursor-pointer select-none hover:bg-tertiary ${className}`}
      onClick={() => onSort(sortKey)}
      title="Click to sort"
    >
      {label}{getSortIndicator(sortKey)}
      {renderResizeHandle(sortKey)}
    </th>
  )

  const openSourceUrl = async (url) => {
    if (!isValidHttpUrl(url)) return
    try {
      const result = await window.electronAPI.openExternalUrl(url)
      if (result?.success === false) {
        alert(`Failed to open URL: ${result.error || 'Unknown error'}`)
      }
    } catch (err) {
      console.error('Failed to open source URL:', err)
      alert(`Failed to open URL: ${err.message || 'Unknown error'}`)
    }
  }

  const isInteractiveTarget = (target) => Boolean(
    target?.closest?.('input, textarea, select, button, a, [contenteditable="true"]')
  )

  const handleRowSelection = (event, gameKey, { replaceOnPlainClick = false } = {}) => {
    const shiftKey = event.shiftKey || event.nativeEvent?.shiftKey
    const ctrlKey = event.ctrlKey || event.nativeEvent?.ctrlKey
    const metaKey = event.metaKey || event.nativeEvent?.metaKey
    if (shiftKey && lastSelectedRowKey) {
      onSelectRowRange?.(lastSelectedRowKey, gameKey, visibleRowKeys, { replace: false })
      return
    }
    if (ctrlKey || metaKey || !replaceOnPlainClick) {
      onToggleRowSelection?.(gameKey)
      return
    }
    onToggleRowSelection?.(gameKey, { replace: true })
  }

  const handleHeaderCheckboxChange = () => {
    onSetVisibleRowSelection?.(visibleRowKeys, !allVisibleSelected)
  }

  return (
    <table className="border-collapse border border-border table-fixed" style={{ minWidth: `${tableMinWidth}px` }}>
      <colgroup>
        {visibleColumns.map((column) => (
          <col key={column.key} style={{ width: `${columnWidths[column.key] || column.width}px` }} />
        ))}
      </colgroup>
      <thead>
        <tr className="bg-secondary sticky top-0">
          <th className="relative border border-border p-1">
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allVisibleSelected}
              onChange={handleHeaderCheckboxChange}
              title="Select all visible rows"
              aria-label="Select all visible rows"
              className="h-4 w-4"
            />
            {renderResizeHandle('select')}
          </th>
          {renderSortableHeader('atlasId', 'Atlas ID')}
          {renderSortableHeader('f95Id', 'F95 ID')}
          {renderSortableHeader('lcId', 'LC ID')}
          {renderSortableHeader('title', 'Title')}
          {renderSortableHeader('creator', 'Creator')}
          {renderSortableHeader('engine', 'Engine')}
          {renderSortableHeader('version', 'Version')}
          {showReplaceVersion && renderSortableHeader('replaceVersion', 'Replace Version')}
          {renderSortableHeader('executable', 'Executable')}
          {renderSortableHeader('databaseMatch', 'Database Match')}
          {renderSortableHeader('source', 'Source')}
          {renderSortableHeader('status', 'Status')}
          <th className="relative border border-border p-1 pr-3">
            Actions
            {renderResizeHandle('actions')}
          </th>
        </tr>
      </thead>
      <tbody>
        {sortedRows.map(({ game, originalIndex }) => {
          const rowIsNew = isNewScanRow(game)
          const rowStatus = getRowImportStatus(game)
          const statusText = rowStatus.text
          const statusClass =
            rowStatus.type === 'alreadyImported' ? 'text-yellow-300'
            : rowStatus.type === 'pending' ? 'text-blue-200'
            : rowStatus.type === 'emptyFolder' ? 'text-gray-300'
            : rowStatus.type === 'repairPath' ? 'text-cyan-300'
            : rowStatus.type === 'steamVersion' ? 'text-sky-300'
            : rowStatus.type === 'lewdCornerVersion' ? 'text-pink-300'
            : rowStatus.type === 'blocked' ? 'text-yellow-200'
            : rowStatus.type === 'missingLaunchable' ? 'text-red-300'
            : 'text-green-300'
          const sourceUrls = getSourceUrls(game)
          const isRenpySave = game.sourceType === 'renpySave'
          const matchResults = Array.isArray(game.results) ? game.results : []
          const showMatchCell = matchResults.length > 0 || game.resultVisibility === 'visible'
          const selectedMatchValue = matchResults.some((result) => result.key === game.resultSelectedValue)
            ? game.resultSelectedValue
            : matchResults[0]?.key || ''
          const gameKey = getGameKey(game)
          const isSelected = selectedRowKeys.has(gameKey)
          const rowClassName = isSelected
            ? 'bg-selected outline outline-2 outline-accent outline-offset-[-2px]'
            : 'bg-primary'
          const sourcePath = isRenpySave
            ? game.savePath || game.folder
            : game.isArchive
              ? game.sourceFile || game.folder || 'Archive'
              : game.folder || 'Metadata only'
          const sourceDisplay = getRelativeScanPath(sourcePath, scanPath)

          return (
            <tr
              key={gameKey}
              className={rowClassName}
              aria-selected={isSelected}
              onClick={(event) => {
                if (isInteractiveTarget(event.target)) return
                handleRowSelection(event, gameKey, { replaceOnPlainClick: true })
              }}
            >
              <td className="border border-border p-1 text-center">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={(event) => handleRowSelection(event, gameKey)}
                  onClick={(event) => event.stopPropagation()}
                  title={`Select row ${originalIndex + 1}`}
                  aria-label={`Select row ${originalIndex + 1}`}
                  className="h-4 w-4"
                />
              </td>
              <td className="border border-border p-1 truncate">
                {matchResults.length > 1 && <i className="fa-solid fa-triangle-exclamation text-yellow-400 mr-1"></i>}
                {game.atlasId}
              </td>
              <td className="border border-border p-1">
                <input
                  value={game.f95Id || ''}
                  disabled={!rowIsNew}
                  onChange={(e) => onUpdateGame(gameKey, 'f95Id', e.target.value)}
                  onBlur={(e) => onHydrateManualF95Id?.(gameKey, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    onHydrateManualF95Id?.(gameKey, e.currentTarget.value, { refresh: true })
                  }}
                  title="Enter a numeric F95 ID or F95 thread URL. Press Enter to update this row."
                  className={ROW_INPUT_CLASS}
                />
              </td>
              <td className="border border-border p-1">
                <input
                  value={game.lcId || game.lewdCornerId || ''}
                  disabled={!rowIsNew}
                  onChange={(e) => onUpdateGame(gameKey, 'lcId', e.target.value)}
                  onBlur={(e) => onHydrateManualLcId?.(gameKey, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    onHydrateManualLcId?.(gameKey, e.currentTarget.value, { refresh: true })
                  }}
                  title="Enter a numeric LC ID or LewdCorner URL. Press Enter to update this row."
                  className={ROW_INPUT_CLASS}
                />
              </td>
              <td className="border border-border p-1">
                <input value={game.title} disabled={!rowIsNew} onChange={(e) => onUpdateGame(gameKey, 'title', e.target.value)} className={ROW_INPUT_CLASS} />
              </td>
              <td className="border border-border p-1">
                <input value={game.creator} disabled={!rowIsNew} onChange={(e) => onUpdateGame(gameKey, 'creator', e.target.value)} className={ROW_INPUT_CLASS} />
              </td>
              <td className="border border-border p-1">
                <input value={game.engine} disabled={!rowIsNew} onChange={(e) => onUpdateGame(gameKey, 'engine', e.target.value)} className={ROW_INPUT_CLASS} />
              </td>
              <td className="border border-border p-1">
                <input value={game.version} disabled={!rowIsNew || isRenpySave} onChange={(e) => onUpdateGame(gameKey, 'version', e.target.value)} className={ROW_INPUT_CLASS} />
              </td>
              {showReplaceVersion && (
                <td className="border border-border p-1">
                  <select
                    value={game.replaceVersion || ''}
                    disabled={!rowIsNew || !game.replaceOptions?.length}
                    onChange={(e) => onUpdateGame(gameKey, 'replaceVersion', e.target.value)}
                    className={ROW_SELECT_CLASS}
                    title={game.replaceOptions?.length ? 'Optionally delete this installed version after the new import succeeds' : 'No installed versions available to replace'}
                  >
                    <option value="">None</option>
                    {(game.replaceOptions || []).map((version) => (
                      <option key={version.version} value={version.version}>
                        {formatReplaceVersionLabel(version)}
                      </option>
                    ))}
                  </select>
                </td>
              )}
              <td className="border border-border p-1">
                <div className="truncate">
                {isRenpySave ? 'N/A' : game.multipleVisible === 'visible' ? (
                  <select value={game.selectedValue} disabled={!rowIsNew} onChange={(e) => onUpdateGame(gameKey, 'selectedValue', e.target.value)} className={ROW_SELECT_CLASS}>
                    {game.executables.map((opt) => <option key={opt.key} value={opt.key}>{opt.value}</option>)}
                  </select>
                ) : game.singleExecutable}
                </div>
              </td>
              <td className="border border-border p-1" style={{ visibility: showMatchCell ? 'visible' : 'hidden' }}>
                {matchResults.length === 1 && matchResults[0]?.key === 'match' ? (
                  <span className="text-text select-none">{matchResults[0].value}</span>
                ) : matchResults.length > 1 && (
                  <select value={selectedMatchValue} disabled={!rowIsNew} onChange={(e) => onResultChange(gameKey, e.target.value)} className={ROW_SELECT_CLASS}>
                    {matchResults.map((opt) => <option key={opt.key} value={opt.key}>{opt.value}</option>)}
                  </select>
                )}
              </td>
              <td className="border border-border p-1">
                <div className="truncate" title={sourcePath || game.glInfosPath || undefined}>
                  {game.hasGlInfos && (
                    <span className="inline-block mr-1 px-1 rounded bg-tertiary text-[10px] text-green-300">
                      GL
                    </span>
                  )}
                  {sourceDisplay}
                </div>
              </td>
              <td className={`border border-border p-1 ${statusClass}`}>{statusText}</td>
              <td className="border border-border p-1 min-w-[220px]">
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => onDeleteGame(gameKey)} className="bg-danger hover:bg-dangerHover text-text text-xs p-1 rounded whitespace-nowrap" style={{ pointerEvents: 'auto' }}>Remove</button>
                  <button onClick={() => window.electronAPI.openDirectory(game.folder || game.sourceFile)} className="bg-accent hover:bg-accentHover text-text text-xs p-1 rounded whitespace-nowrap" style={{ pointerEvents: 'auto' }}>Open Folder</button>
                  {sourceUrls.f95 && (
                    <button
                      onClick={() => openSourceUrl(sourceUrls.f95)}
                      title="Open F95 thread"
                      className="bg-tertiary hover:bg-buttonHover text-text text-xs p-1 rounded whitespace-nowrap"
                      style={{ pointerEvents: 'auto' }}
                    >
                      F95
                    </button>
                  )}
                  {sourceUrls.lewdcorner && (
                    <button
                      onClick={() => openSourceUrl(sourceUrls.lewdcorner)}
                      title="Open LewdCorner thread"
                      className="bg-tertiary hover:bg-buttonHover text-text text-xs p-1 rounded whitespace-nowrap"
                      style={{ pointerEvents: 'auto' }}
                    >
                      LewdCorner
                    </button>
                  )}
                  {sourceUrls.steam && (
                    <button
                      onClick={() => openSourceUrl(sourceUrls.steam)}
                      title="Open Steam store page"
                      className="bg-tertiary hover:bg-buttonHover text-text text-xs p-1 rounded whitespace-nowrap"
                      style={{ pointerEvents: 'auto' }}
                    >
                      Steam
                    </button>
                  )}
                  {sourceUrls.atlas && (
                    <button
                      onClick={() => openSourceUrl(sourceUrls.atlas)}
                      title="Open source page"
                      className="bg-tertiary hover:bg-buttonHover text-text text-xs p-1 rounded whitespace-nowrap"
                      style={{ pointerEvents: 'auto' }}
                    >
                      Atlas
                    </button>
                  )}
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
