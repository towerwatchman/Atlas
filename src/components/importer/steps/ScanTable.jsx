import { useEffect, useMemo, useRef } from 'react'
import { formatVersionDate } from '../../../utils/formatVersionDate.js'

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

export default function ScanTable({
  sortedRows, isNewScanRow, sortConfig,
  onSort, onUpdateGame, onDeleteGame, onResultChange, getGameKey,
  getRowImportStatus, onHydrateManualF95Id, onHydrateManualLcId,
  selectedRowKeys = new Set(), lastSelectedRowKey = '',
  onToggleRowSelection, onSelectRowRange, onSetVisibleRowSelection,
}) {
  const selectAllRef = useRef(null)
  const visibleRowKeys = useMemo(() => sortedRows.map(({ game }) => getGameKey(game)), [getGameKey, sortedRows])
  const selectedVisibleCount = visibleRowKeys.filter((key) => selectedRowKeys.has(key)).length
  const allVisibleSelected = visibleRowKeys.length > 0 && selectedVisibleCount === visibleRowKeys.length
  const someVisibleSelected = selectedVisibleCount > 0 && selectedVisibleCount < visibleRowKeys.length

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

  const renderSortableHeader = (sortKey, label, className = '') => (
    <th
      className={`border border-border p-1 cursor-pointer select-none hover:bg-tertiary ${className}`}
      onClick={() => onSort(sortKey)}
      title="Click to sort"
    >
      {label}{getSortIndicator(sortKey)}
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
    <table className="border-collapse border border-border" style={{ minWidth: '1504px' }}>
      <thead>
        <tr className="bg-secondary sticky top-0">
          <th className="border border-border p-1 w-10 min-w-[44px]">
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allVisibleSelected}
              onChange={handleHeaderCheckboxChange}
              title="Select all visible rows"
              aria-label="Select all visible rows"
              className="h-4 w-4"
            />
          </th>
          {renderSortableHeader('atlasId', 'Atlas ID', 'min-w-[80px]')}
          {renderSortableHeader('f95Id', 'F95 ID', 'min-w-[80px]')}
          {renderSortableHeader('lcId', 'LC ID', 'min-w-[80px]')}
          {renderSortableHeader('title', 'Title', 'min-w-[200px]')}
          {renderSortableHeader('creator', 'Creator', 'min-w-[150px]')}
          {renderSortableHeader('engine', 'Engine', 'min-w-[100px]')}
          {renderSortableHeader('version', 'Version', 'min-w-[200px]')}
          {renderSortableHeader('replaceVersion', 'Replace Version', 'min-w-[180px]')}
          {renderSortableHeader('executable', 'Executable', 'min-w-[180px]')}
          {renderSortableHeader('databaseMatch', 'Possible Database Matches', 'min-w-[220px] !max-w-[220px]')}
          {renderSortableHeader('source', 'Source', 'min-w-[250px]')}
          {renderSortableHeader('status', 'Status', 'min-w-[150px]')}
          <th className="border border-border p-1 min-w-[220px]">Actions</th>
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
              <td className="border border-border p-1 text-center w-10 min-w-[44px]">
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
              <td className="border border-border p-1 min-w-[100px]">
                {matchResults.length > 1 && <i className="fa-solid fa-triangle-exclamation text-yellow-400 mr-1"></i>}
                {game.atlasId}
              </td>
              <td className="border border-border p-1 min-w-[100px]">
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
                  placeholder="F95 ID or thread URL"
                  title="Enter a numeric F95 ID or F95 thread URL. Press Enter to update this row."
                  className="w-full bg-secondary border border-border p-1"
                />
              </td>
              <td className="border border-border p-1 min-w-[100px]">
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
                  placeholder="LC ID or LewdCorner URL"
                  title="Enter a numeric LC ID or LewdCorner URL. Press Enter to update this row."
                  className="w-full bg-secondary border border-border p-1"
                />
              </td>
              <td className="border border-border p-1">
                <input value={game.title} disabled={!rowIsNew} onChange={(e) => onUpdateGame(gameKey, 'title', e.target.value)} className="w-full bg-secondary border border-border p-1" />
              </td>
              <td className="border border-border p-1">
                <input value={game.creator} disabled={!rowIsNew} onChange={(e) => onUpdateGame(gameKey, 'creator', e.target.value)} className="w-full bg-secondary border border-border p-1" />
              </td>
              <td className="border border-border p-1">
                <input value={game.engine} disabled={!rowIsNew} onChange={(e) => onUpdateGame(gameKey, 'engine', e.target.value)} className="w-full bg-secondary border border-border p-1" />
              </td>
              <td className="border border-border p-1">
                <input value={game.version} disabled={!rowIsNew || isRenpySave} onChange={(e) => onUpdateGame(gameKey, 'version', e.target.value)} className="w-full bg-secondary border border-border p-1" />
              </td>
              <td className="border border-border p-1">
                <select
                  value={game.replaceVersion || ''}
                  disabled={!rowIsNew || !game.replaceOptions?.length}
                  onChange={(e) => onUpdateGame(gameKey, 'replaceVersion', e.target.value)}
                  className="w-full bg-secondary border border-border p-1"
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
              <td className="border border-border p-1">
                {isRenpySave ? 'N/A' : game.multipleVisible === 'visible' ? (
                  <select value={game.selectedValue} disabled={!rowIsNew} onChange={(e) => onUpdateGame(gameKey, 'selectedValue', e.target.value)} className="w-full bg-secondary border border-border p-1">
                    {game.executables.map((opt) => <option key={opt.key} value={opt.key}>{opt.value}</option>)}
                  </select>
                ) : game.singleExecutable}
              </td>
              <td className="border border-border p-1" style={{ visibility: showMatchCell ? 'visible' : 'hidden' }}>
                {matchResults.length === 1 && matchResults[0]?.key === 'match' ? (
                  <span className="text-text select-none">{matchResults[0].value}</span>
                ) : matchResults.length > 1 && (
                  <select value={selectedMatchValue} disabled={!rowIsNew} onChange={(e) => onResultChange(gameKey, e.target.value)} className="w-full bg-secondary border border-border p-1">
                    {matchResults.map((opt) => <option key={opt.key} value={opt.key}>{opt.value}</option>)}
                  </select>
                )}
              </td>
              <td className="border border-border p-1">
                <div title={game.glInfosPath || undefined}>
                  {game.hasGlInfos && (
                    <span className="inline-block mr-1 px-1 rounded bg-tertiary text-[10px] text-green-300">
                      GL
                    </span>
                  )}
                  {isRenpySave ? game.savePath || game.folder : game.isArchive ? game.sourceFile || game.folder || 'Archive' : game.folder || 'Metadata only'}
                </div>
              </td>
              <td className={`border border-border p-1 ${statusClass}`}>{statusText}</td>
              <td className="border border-border p-1 min-w-[220px]">
                <div className="flex flex-wrap gap-2">
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
                <button onClick={() => onDeleteGame(gameKey)} className="bg-danger hover:bg-dangerHover text-text text-xs p-1 rounded whitespace-nowrap" style={{ pointerEvents: 'auto' }}>Delete</button>
                <button onClick={() => window.electronAPI.openDirectory(game.folder || game.sourceFile)} className="bg-accent hover:bg-accentHover text-text text-xs p-1 rounded whitespace-nowrap" style={{ pointerEvents: 'auto' }}>Open Folder</button>
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
