export default function ScanTable({
  sortedRows, isNewScanRow, sortConfig,
  onSort, onUpdateGame, onDeleteGame, onResultChange, getGameKey,
  getRowImportStatus,
}) {
  const getSortIndicator = (key) => {
    if (sortConfig.key !== key) return ''
    return sortConfig.direction === 'asc' ? ' ▲' : ' ▼'
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
          <th className="border border-border p-1 min-w-[150px]">Actions</th>
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
            : rowStatus.type === 'blocked' ? 'text-yellow-200'
            : rowStatus.type === 'missingLaunchable' ? 'text-red-300'
            : 'text-green-300'

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
                <input value={game.version} disabled={!rowIsNew} onChange={(e) => onUpdateGame(getGameKey(game), 'version', e.target.value)} className="w-full bg-secondary border border-border p-1" />
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
                      {version.version}{version.date_added ? ` - ${new Date(version.date_added * 1000).toLocaleDateString()}` : ''}
                    </option>
                  ))}
                </select>
              </td>
              <td className="border border-border p-1">
                {game.multipleVisible === 'visible' ? (
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
                {game.isArchive ? game.sourceFile || game.folder || 'Archive' : game.folder || 'Metadata only'}
              </td>
              <td className={`border border-border p-1 ${statusClass}`}>{statusText}</td>
              <td className="border border-border p-1 min-w-[150px] flex space-x-2">
                <button onClick={() => onDeleteGame(getGameKey(game))} className="bg-red-600 hover:bg-red-700 text-text text-xs p-1 rounded whitespace-nowrap" style={{ pointerEvents: 'auto' }}>Delete</button>
                <button onClick={() => window.electronAPI.openDirectory(game.folder || game.sourceFile)} className="bg-accent hover:bg-selected text-text text-xs p-1 rounded whitespace-nowrap" style={{ pointerEvents: 'auto' }}>Open Folder</button>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
