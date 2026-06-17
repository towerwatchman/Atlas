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
  const steamId = getCleanId(game.steamId || game.steam_id || game.appid)
  const f95Url = [game.siteUrl, game.site_url, game.f95Url]
    .find(isValidHttpUrl) || (f95Id ? `https://f95zone.to/threads/${f95Id}/` : '')
  const steamUrl = [game.steamUrl, game.storeUrl]
    .find(isValidHttpUrl) || (steamId ? `https://store.steampowered.com/app/${steamId}/` : '')
  const atlasUrl = [game.atlasUrl, game.sourceUrl]
    .find(isValidHttpUrl) || ''

  return {
    f95: isValidHttpUrl(f95Url) ? f95Url : '',
    steam: isValidHttpUrl(steamUrl) ? steamUrl : '',
    atlas: isValidHttpUrl(atlasUrl) ? atlasUrl : '',
  }
}

export default function ScanTable({
  sortedRows, isNewScanRow, sortConfig,
  onSort, onUpdateGame, onDeleteGame, onResultChange, getGameKey,
  getRowImportStatus,
}) {
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

  return (
    <table className="border-collapse border border-border" style={{ minWidth: '1380px' }}>
      <thead>
        <tr className="bg-secondary sticky top-0">
          {renderSortableHeader('atlasId', 'Atlas ID', 'min-w-[80px]')}
          {renderSortableHeader('f95Id', 'F95 ID', 'min-w-[80px]')}
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
            : rowStatus.type === 'blocked' ? 'text-yellow-200'
            : rowStatus.type === 'missingLaunchable' ? 'text-red-300'
            : 'text-green-300'
          const sourceUrls = getSourceUrls(game)
          const isRenpySave = game.sourceType === 'renpySave'

          return (
            <tr key={getGameKey(game)} className="bg-primary">
              <td className="border border-border p-1 min-w-[100px]">
                {game.results?.length > 1 && <i className="fa-solid fa-triangle-exclamation text-yellow-400 mr-1"></i>}
                {game.atlasId}
              </td>
              <td className="border border-border p-1 min-w-[100px]">
                <input value={game.f95Id} disabled={!rowIsNew} onChange={(e) => onUpdateGame(getGameKey(game), 'f95Id', e.target.value)} className="w-full bg-secondary border border-border p-1" />
              </td>
              <td className="border border-border p-1">
                <input value={game.title} disabled={!rowIsNew} onChange={(e) => onUpdateGame(getGameKey(game), 'title', e.target.value)} className="w-full bg-secondary border border-border p-1" />
              </td>
              <td className="border border-border p-1">
                <input value={game.creator} disabled={!rowIsNew} onChange={(e) => onUpdateGame(getGameKey(game), 'creator', e.target.value)} className="w-full bg-secondary border border-border p-1" />
              </td>
              <td className="border border-border p-1">
                <input value={game.engine} disabled={!rowIsNew} onChange={(e) => onUpdateGame(getGameKey(game), 'engine', e.target.value)} className="w-full bg-secondary border border-border p-1" />
              </td>
              <td className="border border-border p-1">
                <input value={game.version} disabled={!rowIsNew || isRenpySave} onChange={(e) => onUpdateGame(getGameKey(game), 'version', e.target.value)} className="w-full bg-secondary border border-border p-1" />
              </td>
              <td className="border border-border p-1">
                <select
                  value={game.replaceVersion || ''}
                  disabled={!rowIsNew || !game.replaceOptions?.length}
                  onChange={(e) => onUpdateGame(getGameKey(game), 'replaceVersion', e.target.value)}
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
                  <select value={game.selectedValue} disabled={!rowIsNew} onChange={(e) => onUpdateGame(getGameKey(game), 'selectedValue', e.target.value)} className="w-full bg-secondary border border-border p-1">
                    {game.executables.map((opt) => <option key={opt.key} value={opt.key}>{opt.value}</option>)}
                  </select>
                ) : game.singleExecutable}
              </td>
              <td className="border border-border p-1" style={{ visibility: game.resultVisibility }}>
                {game.results?.length === 1 && game.results[0]?.key === 'match' ? (
                  <span className="text-text select-none">{game.results[0].value}</span>
                ) : game.results?.length > 1 && (
                  <select value={game.resultSelectedValue} disabled={!rowIsNew} onChange={(e) => onResultChange(getGameKey(game), e.target.value)} className="w-full bg-secondary border border-border p-1">
                    {game.results.map((opt) => <option key={opt.key} value={opt.key}>{opt.value}</option>)}
                  </select>
                )}
              </td>
              <td className="border border-border p-1">
                {isRenpySave ? game.savePath || game.folder : game.isArchive ? game.sourceFile || game.folder || 'Archive' : game.folder || 'Metadata only'}
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
                <button onClick={() => onDeleteGame(getGameKey(game))} className="bg-danger hover:bg-dangerHover text-text text-xs p-1 rounded whitespace-nowrap" style={{ pointerEvents: 'auto' }}>Delete</button>
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
