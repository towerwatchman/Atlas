export default function SettingsStep({
  folder, customFormat, useUnstructured, gameExt, archiveExt,
  downloadBannerImages, downloadPreviewImages, previewLimit,
  moveFoldersToLibrary, deleteSourceArchiveAfterImport, autoSelectLatestReplaceVersion,
  defaultLibraryPath, askingForLibraryFolder,
  onSelectFolder, onStartScan,
  setCustomFormat, setUseUnstructured, setGameExt, setArchiveExt,
  setDownloadBannerImages, setDownloadPreviewImages, setMoveFoldersToLibrary,
  setDeleteSourceArchiveAfterImport, onAutoSelectChange,
}) {
  const formatPresets = [
    { label: 'Auto detect', value: 'auto' },
    { label: 'Creator / Title / Version', value: '{creator}/{title}/{version}' },
    { label: 'Title / Version', value: '{title}/{version}' },
    { label: 'Creator / Title - Version', value: '{creator}/{title} - {version}' },
    { label: 'Title / Version, Creator', value: '{title}/{version},{creator}' },
    { label: 'F95 ID / Title / Version', value: '{f95Id}/{title}/{version}' },
    { label: 'LewdCorner ID / Title / Version', value: '{lcId}/{title}/{version}' },
  ]
  const presetValue = useUnstructured
    ? 'auto'
    : formatPresets.some((preset) => preset.value === customFormat)
      ? customFormat
      : 'custom'

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
        <label>Scan Scheme:</label>
        <select
          value={presetValue}
          onChange={(event) => {
            const value = event.target.value
            if (value === 'auto') {
              setUseUnstructured(true)
            } else {
              setUseUnstructured(false)
              if (value !== 'custom') setCustomFormat(value)
            }
          }}
          className="ml-2 bg-secondary border border-border p-1"
        >
          {formatPresets.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
          <option value="custom">Custom</option>
        </select>
        <input
          type="text" value={customFormat}
          onChange={(e) => setCustomFormat(e.target.value)}
          disabled={useUnstructured}
          className="ml-2 flex-1 bg-secondary border border-border p-1"
        />
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
        Auto detect infers metadata from folder/archive names. Custom schemes support <span className="font-semibold">Title</span>, <span className="font-semibold">Creator</span>,{' '}
        <span className="font-semibold">Engine</span>, <span className="font-semibold">Version</span>, <span className="font-semibold">F95 ID</span>, and <span className="font-semibold">LC ID</span>.<br />
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
          <input type="checkbox" checked={moveFoldersToLibrary} onChange={(e) => setMoveFoldersToLibrary(e.target.checked)} className="mr-2" />
          <label className="font-medium">Move folder imports to the library</label>
          <div className="mt-1 ml-6 text-sm text-muted">When disabled, folder imports are added in place. Archive imports still extract to the library.</div>
        </div>

        <div className="mt-4">
          <input type="checkbox" checked={deleteSourceArchiveAfterImport} onChange={(e) => setDeleteSourceArchiveAfterImport(e.target.checked)} className="mr-2" />
          <label className="font-medium">Delete source archive after successful extraction</label>
          <div className="mt-1 ml-6 text-sm text-muted">Applies only to archive files.</div>
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
