import ScanTable from './ScanTable.jsx'

export default function ScanStep({
  progress, progressLabel, visibleStats, sortedRows, isNewScanRow, sortConfig,
  hideMatches, includeUnmatched, includeArchives, forceReimport,
  canImport, isResolvingMatches, isScanActive, isCancelingScan, getImportDisabledReason,
  importMode, scanPath, scanMessage,
  onSort, onUpdateGame, onDeleteGame, onResultChange, getGameKey,
  getRowImportStatus, onUpdateMatches, onCancelMatch, onImport,
  onSelectRenpyFolder,
  setHideMatches, setIncludeUnmatched, setIncludeArchives, setForceReimport,
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
              className="mt-2 bg-accent hover:bg-accentHover px-3 py-1 rounded text-text"
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
          onResultChange={onResultChange}
          getGameKey={getGameKey}
          getRowImportStatus={getRowImportStatus}
        />
      </div>

      <div className="flex justify-between items-center space-x-4 mt-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center space-x-2">
            <input type="checkbox" id="include-unmatched" checked={includeUnmatched} onChange={(e) => setIncludeUnmatched(e.target.checked)} className="h-4 w-4" />
            <label htmlFor="include-unmatched" className="text-sm text-text">Import unmatched games</label>
          </div>
          {!isRenpyMode && (
            <>
              <div className="flex items-center space-x-2">
                <input type="checkbox" id="include-archives" checked={includeArchives} onChange={(e) => setIncludeArchives(e.target.checked)} className="h-4 w-4" />
                <label htmlFor="include-archives" className="text-sm text-text">Extract and import archives</label>
              </div>
              <div className="flex items-center space-x-2">
                <input type="checkbox" id="force-reimport" checked={forceReimport} onChange={(e) => setForceReimport(e.target.checked)} className="h-4 w-4" />
                <label htmlFor="force-reimport" className="text-sm text-text" title="Safely repairs existing rows and refreshes selected media without creating duplicate game records.">
                  Force re-import existing games
                </label>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={onUpdateMatches}
            disabled={isResolvingMatches || isScanActive || isCancelingScan}
            className={`px-4 py-2 rounded text-text ${(isResolvingMatches || isScanActive || isCancelingScan) ? 'bg-tertiary cursor-not-allowed opacity-70' : 'bg-accent hover:bg-accentHover'}`}
            style={{ pointerEvents: 'auto', zIndex: 1000 }}
          >
            {isResolvingMatches ? 'Resolving...' : 'Update Matches'}
          </button>
          {(isResolvingMatches || isScanActive || isCancelingScan) && (
            <button
              onClick={onCancelMatch}
              disabled={isCancelingScan}
              className={`px-4 py-2 rounded text-white ${isCancelingScan ? 'bg-danger cursor-not-allowed opacity-70' : 'bg-danger hover:bg-dangerHover'}`}
              style={{ pointerEvents: 'auto', zIndex: 1000 }}
            >
              {isScanActive || isCancelingScan ? (isCancelingScan ? 'Canceling...' : 'Cancel Scan') : 'Stop Matching'}
            </button>
          )}
          <button onClick={() => setHideMatches(!hideMatches)} className="bg-tertiary hover:bg-selected px-4 py-2 rounded text-text" style={{ pointerEvents: 'auto', zIndex: 1000 }}>
            {hideMatches ? 'Show All' : 'Hide Matches'}
          </button>
          <button
            onClick={onImport}
            disabled={!canImport || isScanActive || isCancelingScan}
            className={`px-6 py-2 rounded font-medium transition-colors ${(canImport && !isScanActive && !isCancelingScan) ? 'bg-success hover:bg-successHover text-white' : 'bg-tertiary cursor-not-allowed opacity-70 text-muted'}`}
            title={getImportDisabledReason()}
            style={{ pointerEvents: 'auto' }}
          >
            Import
          </button>
          <button onClick={() => window.electronAPI.closeWindow()} className="bg-danger hover:bg-dangerHover px-6 py-2 rounded text-white" style={{ pointerEvents: 'auto', zIndex: 1000 }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
