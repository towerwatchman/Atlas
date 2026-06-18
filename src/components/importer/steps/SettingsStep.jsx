export default function SettingsStep({
  folder, customFormat, useUnstructured, gameExt, archiveExt,
  downloadBannerImages, downloadPreviewImages, previewLimit,
  deleteSourceArchiveAfterImport, autoSelectLatestReplaceVersion,
  defaultLibraryPath, askingForLibraryFolder,
  onSelectFolder, onStartScan,
  setCustomFormat, setUseUnstructured, setGameExt, setArchiveExt,
  setDownloadBannerImages, setDownloadPreviewImages,
  setDeleteSourceArchiveAfterImport, onAutoSelectChange,
}) {
  return (
    <div className="space-y-4 flex-1">
      <div className="flex items-center">
        <label>Game Path:</label>
        <input type="text" value={folder} readOnly className="ml-2 flex-1 bg-secondary border border-border p-1" />
        <button onClick={onSelectFolder} className="ml-2 bg-accent p-1" style={{ pointerEvents: 'auto', zIndex: 1000 }}>
          Set Folder
        </button>
      </div>

      <div className="flex items-center">
        <label>Folder Structure:</label>
        <input
          type="text" value={customFormat}
          onChange={(e) => setCustomFormat(e.target.value)}
          disabled={useUnstructured}
          className="ml-2 flex-1 bg-secondary border border-border p-1"
        />
        <input type="checkbox" checked={useUnstructured} onChange={(e) => setUseUnstructured(e.target.checked)} className="ml-2"
          title="When enabled, Atlas infers title and version from folder/archive names." />
        <label title="When enabled, Atlas infers title and version from folder/archive names.">Unstructured Format</label>
      </div>

      <div className="flex items-center">
        <label>Game Extensions:</label>
        <input type="text" value={gameExt} onChange={(e) => setGameExt(e.target.value)} className="ml-2 flex-1 bg-secondary border border-border p-1" />
      </div>

      <div className="flex items-center">
        <label>Archive Extensions:</label>
        <input type="text" value={archiveExt} onChange={(e) => setArchiveExt(e.target.value)} className="ml-2 flex-1 bg-secondary border border-border p-1" />
      </div>

      <p className="text-sm text-text leading-relaxed">
        Source folder structure options: <span className="font-semibold">Title</span>, <span className="font-semibold">Creator</span>,{' '}
        <span className="font-semibold">Engine</span>, and <span className="font-semibold">Version</span>.<br />
        - Enclose each option in braces, e.g., <span className="font-mono">{'{Title}'}</span>. Use <span className="font-mono">/</span> for folder separators.<br /><br />
        Examples:<br />
        <span className="font-mono">{'{engine}/{creator}/{title}/{version}'}</span><br />
        <span className="font-mono">{'[{engine}] [{title}] [{version}]'}</span><br />
        <span className="font-mono">{'{title-version}'}</span><br />
        Atlas Library Structure also supports <span className="font-mono">{'{f95Id}'}</span>, for example{' '}
        <span className="font-mono">{'{f95Id}/{creator}/{title}/{version}'}</span>.
      </p>

      <div className="space-y-2">
        <div>
          <input type="checkbox" checked={downloadBannerImages} onChange={(e) => setDownloadBannerImages(e.target.checked)} />
          <label>Download banner images to local storage</label>
        </div>
        <div>
          <input type="checkbox" checked={downloadPreviewImages} onChange={(e) => setDownloadPreviewImages(e.target.checked)} />
          <label>Download preview images to local storage {previewLimit === 'Unlimited' ? '(all available)' : `(limit: ${previewLimit})`}</label>
        </div>

        <div className="mt-4 text-sm">
          {defaultLibraryPath ? (
            <span className="text-success">Library destination: <strong>{defaultLibraryPath}</strong></span>
          ) : askingForLibraryFolder ? (
            <span className="text-warning">Waiting for library folder selection...</span>
          ) : (
            <span className="text-warning">No default library folder set. You will be asked to choose one before import.</span>
          )}
        </div>

        <div className="mt-4">
          <input type="checkbox" checked={deleteSourceArchiveAfterImport} onChange={(e) => setDeleteSourceArchiveAfterImport(e.target.checked)} className="mr-2" />
          <label className="font-medium">Delete source archive after successful extraction</label>
          <div className="mt-1 ml-6 text-sm text-muted">Applies only to archive files. Folder imports move to the library automatically.</div>
        </div>

        <div className="mt-4">
          <input type="checkbox" checked={autoSelectLatestReplaceVersion} onChange={onAutoSelectChange} className="mr-2" />
          <label className="font-medium">Auto-select latest installed version for replacement</label>
          <div className="mt-1 ml-6 text-sm text-muted">
            Preselects the newest installed version in Replace Version dropdowns. You can still change it to None before importing.
          </div>
        </div>
      </div>

      <div className="flex justify-end space-x-2">
        <button onClick={onStartScan} className="bg-accent p-2" style={{ pointerEvents: 'auto', zIndex: 1000 }}>Next</button>
        <button onClick={() => window.electronAPI.closeWindow()} className="bg-accent p-2" style={{ pointerEvents: 'auto', zIndex: 1000 }}>Cancel</button>
      </div>
    </div>
  )
}
