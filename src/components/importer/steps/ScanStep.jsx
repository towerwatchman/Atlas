import ScanTable from './ScanTable.jsx'

export default function ScanStep({
  progress, progressLabel, visibleStats, sortedRows, isNewScanRow, sortConfig,
  hideMatches, includeUnmatched, forceReimport,
  autoSelectLatestReplaceVersion,
  selectedRowKeys, selectedRowCount = 0, badRowCount = 0, lastSelectedRowKey,
  canImport, isResolvingMatches, isScanActive, isCancelingScan, getImportDisabledReason,
  importMode, scanPath, scanMessage,
  onSort, onUpdateGame, onDeleteGame, onResultChange, getGameKey,
  onToggleRowSelection, onSelectRowRange, onSetVisibleRowSelection,
  onClearRowSelection, onDeleteSelectedRows, onDeleteBadRows,
  getRowImportStatus, onUpdateMatches, onHydrateManualF95Id, onHydrateManualLcId, onCancelMatch, onImport,
  onSelectRenpyFolder,
  setHideMatches, setIncludeUnmatched, setForceReimport,
}) {
  const isRenpyMode = importMode === 'renpySaves'

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0">
        <h2 className="text-xl mb-4">Scan Results</h2>
        <div className="flex items-center mb-4">
          <progress value={progress.value} max={progress.total} className="w-96" />
          <span className="ml-2">
            {progress.value}/{progress.total} {progressLabel ?? 'Folders Scanned'}
          </span>
        </div>
        {importMode === 'renpySaves' && (
          <div className="mb-4 border border-border bg-primary p-3 text-sm">
            <div style={{ overflowWrap: 'anywhere' }}>
              <span className="text-muted">Scanning:</span> {scanPath || 'Looking for Ren\'Py save folder...'}
            </div>
            {scanMessage && <div className="mt-1 text-yellow-200">{scanMessage}</div>}
            <button
              onClick={onSelectRenpyFolder}
              className="mt-2 bg-accent hover:bg-accentHover px-3 py-1 rounded-buttonTheme text-text"
              style={{ pointerEvents: 'auto' }}
            >
              Select Ren'Py Save Folder
            </button>
          </div>
        )}
        <div className="mb-4 flex flex-wrap gap-4 text-sm">
          <span>Ready {visibleStats.potential || 0}</span>
          <span>Pending matches {visibleStats.pendingMatch || 0}</span>
          <span>Archives {visibleStats.archives || 0}</span>
          <span>Already imported {visibleStats.alreadyImported || 0}</span>
          <span>Repairs {visibleStats.repairPath || 0}</span>
          <span>Steam versions {visibleStats.steamVersion || 0}</span>
          <span>Missing launchable {visibleStats.missingLaunchable || 0}</span>
          <span>Empty folders {visibleStats.emptyFolder || 0}</span>
          <span>Total rows {visibleStats.totalFound || 0}</span>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto">
        <ScanTable
          sortedRows={sortedRows}
          isNewScanRow={isNewScanRow}
          sortConfig={sortConfig}
          onSort={onSort}
          onUpdateGame={onUpdateGame}
          onDeleteGame={onDeleteGame}
          selectedRowKeys={selectedRowKeys}
          lastSelectedRowKey={lastSelectedRowKey}
          onToggleRowSelection={onToggleRowSelection}
          onSelectRowRange={onSelectRowRange}
          onSetVisibleRowSelection={onSetVisibleRowSelection}
          onClearRowSelection={onClearRowSelection}
          onResultChange={onResultChange}
          onHydrateManualF95Id={onHydrateManualF95Id}
          onHydrateManualLcId={onHydrateManualLcId}
          getGameKey={getGameKey}
          getRowImportStatus={getRowImportStatus}
          showReplaceVersion={true}
          scanPath={scanPath}
        />
      </div>

      <div className="shrink-0 flex flex-wrap items-center gap-x-4 gap-y-2 mt-3">
        <span className="text-sm text-text">Selected: {selectedRowCount}</span>
        <button
          onClick={onDeleteSelectedRows}
          disabled={selectedRowCount === 0}
          className={`px-3 py-1 rounded-buttonTheme text-sm text-text ${selectedRowCount === 0 ? 'bg-tertiary cursor-not-allowed opacity-70' : 'bg-danger hover:bg-dangerHover'}`}
          title="Remove selected rows from this scan only"
          style={{ pointerEvents: 'auto' }}
        >
          Remove selected{selectedRowCount > 0 ? ` (${selectedRowCount})` : ''}
        </button>
        <button
          onClick={onDeleteBadRows}
          disabled={badRowCount === 0}
          className={`px-3 py-1 rounded-buttonTheme text-sm text-text ${badRowCount === 0 ? 'bg-tertiary cursor-not-allowed opacity-70' : 'bg-danger hover:bg-dangerHover'}`}
          title="Remove incomplete rows from this scan only"
          style={{ pointerEvents: 'auto' }}
        >
          Remove incomplete{badRowCount > 0 ? ` (${badRowCount})` : ''}
        </button>
        <button
          onClick={onClearRowSelection}
          disabled={selectedRowCount === 0}
          className={`px-3 py-1 rounded-buttonTheme text-sm text-text ${selectedRowCount === 0 ? 'bg-tertiary cursor-not-allowed opacity-70' : 'bg-tertiary hover:bg-selected'}`}
          title="Clear selected scan rows"
          style={{ pointerEvents: 'auto' }}
        >
          Clear selection
        </button>

        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-2 text-sm text-text cursor-pointer">
            <input type="checkbox" checked={includeUnmatched} onChange={(e) => setIncludeUnmatched(e.target.checked)} className="h-4 w-4 accent-accent" />
            Import unmatched games
          </label>
          {!isRenpyMode && (
            <label className="flex items-center gap-2 text-sm text-text cursor-pointer" title="Safely repairs existing rows and refreshes selected media without creating duplicate game records.">
              <input type="checkbox" checked={forceReimport} onChange={(e) => setForceReimport(e.target.checked)} className="h-4 w-4 accent-accent" />
              Force re-import existing games
            </label>
          )}
        </div>
      </div>
    </div>
  )
}
