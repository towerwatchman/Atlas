import { buildFolderRegex } from '../folderRegex.js'

// Checkbox + label row used throughout the settings form. Defined at module
// scope so it isn't re-created (and its children re-mounted) on every render.
function Check({ checked, onChange, title, children }) {
  return (
    <label className="flex items-start gap-2 cursor-pointer" title={title}>
      <input type="checkbox" checked={checked} onChange={onChange} className="mt-1 h-4 w-4 shrink-0" />
      <span className="min-w-0">{children}</span>
    </label>
  )
}

export default function SettingsStep({
  folder, customFormat, useUnstructured, gameExt, archiveExt,
  includeArchives, useCustomRegex, customRegex,
  downloadBannerImages, downloadPreviewImages, previewLimit,
  moveFoldersToLibrary, deleteSourceArchiveAfterImport, autoSelectLatestReplaceVersion,
  defaultLibraryPath, askingForLibraryFolder,
  onSelectFolder, onStartScan,
  setCustomFormat, setUseUnstructured, setGameExt, setArchiveExt,
  setIncludeArchives, setUseCustomRegex, setCustomRegex,
  setDownloadBannerImages, setDownloadPreviewImages, setMoveFoldersToLibrary,
  setDeleteSourceArchiveAfterImport, onAutoSelectChange,
}) {
  const formatPresets = [
    { label: 'Creator / Title / Version', value: '{creator}/{title}/{version}' },
    { label: 'Title / Version', value: '{title}/{version}' },
    { label: 'Creator / Title - Version', value: '{creator}/{title} - {version}' },
    { label: 'Title / Version, Creator', value: '{title}/{version},{creator}' },
    { label: 'F95 ID / Title / Version', value: '{f95Id}/{title}/{version}' },
    { label: 'LewdCorner ID / Title / Version', value: '{lcId}/{title}/{version}' },
  ]
  // "Auto detect" (unstructured name guessing) has been removed for now, so the
  // dropdown only offers real schemes plus Custom. A stored scheme that isn't one
  // of the presets shows as "Custom".
  const presetValue = formatPresets.some((preset) => preset.value === customFormat)
    ? customFormat
    : 'custom'

  // The regex the scanner will actually use. When the user is not editing a
  // custom pattern, this is generated from the format template above.
  const generatedRegex = buildFolderRegex(customFormat)
  const regexFieldValue = useCustomRegex ? customRegex : generatedRegex
  const regexDisabled = !useCustomRegex

  const fieldRow = 'flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-0'
  const fieldLabel = 'sm:w-40 sm:shrink-0'
  const sectionHeader = 'text-xs font-semibold uppercase tracking-wide text-muted border-b border-border pb-1 mb-1 mt-5'

  return (
    <div className="space-y-4 flex-1">
      <div className={fieldRow}>
        <label className={fieldLabel}>Game Path:</label>
        <input type="text" value={folder} readOnly className="sm:ml-2 flex-1 min-w-0 bg-secondary border border-border p-1" />
        <button onClick={onSelectFolder} className="sm:ml-2 bg-accent p-1" style={{ pointerEvents: 'auto', zIndex: 1000 }}>
          Set Folder
        </button>
      </div>

      <div className={fieldRow}>
        <label className={fieldLabel}>Scan Scheme:</label>
        <div className="flex flex-1 min-w-0 flex-col sm:flex-row gap-1 sm:gap-0">
          <select
            value={presetValue}
            onChange={(event) => {
              const value = event.target.value
              setUseUnstructured(false)
              if (value !== 'custom') setCustomFormat(value)
            }}
            className="sm:ml-2 bg-secondary border border-border p-1"
          >
            {formatPresets.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
            <option value="custom">Custom</option>
          </select>
          <input
            type="text" value={customFormat}
            onChange={(e) => setCustomFormat(e.target.value)}
            className="sm:ml-2 flex-1 min-w-0 bg-secondary border border-border p-1"
          />
        </div>
      </div>

      <div className={fieldRow}>
        <label className={fieldLabel}>Folder Regex:</label>
        <input
          type="text"
          value={regexFieldValue}
          onChange={(e) => setCustomRegex(e.target.value)}
          disabled={regexDisabled}
          spellCheck={false}
          placeholder="Regex generated from the scheme above"
          title="This is the regex used to parse folder names. Enable 'Edit regex' to override it with named groups like (?<title>...)."
          className={`sm:ml-2 flex-1 min-w-0 bg-secondary border border-border p-1 font-mono text-xs ${regexDisabled ? 'opacity-70' : ''}`}
        />
        <label className="sm:ml-2 flex items-center gap-1 whitespace-nowrap" title="Edit the regex directly">
          <input
            type="checkbox"
            checked={useCustomRegex}
            onChange={(e) => setUseCustomRegex(e.target.checked)}
            className="h-4 w-4"
          />
          <span className="text-sm">Edit regex</span>
        </label>
      </div>

      <div className={fieldRow}>
        <label className={fieldLabel}>Game Extensions:</label>
        <input type="text" value={gameExt} onChange={(e) => setGameExt(e.target.value)} className="sm:ml-2 flex-1 min-w-0 bg-secondary border border-border p-1" />
      </div>

      <Check checked={includeArchives} onChange={(e) => setIncludeArchives(e.target.checked)}>
        <span className="font-medium">Include archives</span>
        <span className="block text-sm text-muted">Scan archive files (zip, 7z, rar) in addition to folders.</span>
      </Check>

      {includeArchives && (
        <div className={fieldRow}>
          <label className={fieldLabel}>Archive Extensions:</label>
          <input type="text" value={archiveExt} onChange={(e) => setArchiveExt(e.target.value)} className="sm:ml-2 flex-1 min-w-0 bg-secondary border border-border p-1" />
        </div>
      )}

      <p className="text-sm text-text leading-relaxed">
        Pick a scheme that matches how your game folders are named. Custom schemes support <span className="font-semibold">Title</span>, <span className="font-semibold">Creator</span>,{' '}
        <span className="font-semibold">Engine</span>, <span className="font-semibold">Version</span>, <span className="font-semibold">F95 ID</span>, and <span className="font-semibold">LC ID</span>.<br />
        - Enclose each option in braces, e.g., <span className="font-mono">{'{Title}'}</span>. Use <span className="font-mono">/</span> for folder separators.<br />
        - The <span className="font-semibold">Folder Regex</span> field shows the pattern derived from your scheme. Enable <span className="font-semibold">Edit regex</span> to supply your own, using named groups such as <span className="font-mono">{'(?<title>.+?)'}</span>.<br /><br />
        Examples:<br />
        <span className="font-mono">{'{engine}/{creator}/{title}/{version}'}</span><br />
        <span className="font-mono">{'[{engine}] [{title}] [{version}]'}</span><br />
        <span className="font-mono">{'{title-version}'}</span><br />
        Atlas Library Structure also supports <span className="font-mono">{'{f95Id}'}</span>, for example{' '}
        <span className="font-mono">{'{f95Id}/{creator}/{title}/{version}'}</span>.
      </p>

      <div>
        <div className={sectionHeader}>Media</div>
        <div className="space-y-2">
          <Check checked={downloadBannerImages} onChange={(e) => setDownloadBannerImages(e.target.checked)}>
            Download banner images to local storage
          </Check>
          <Check checked={downloadPreviewImages} onChange={(e) => setDownloadPreviewImages(e.target.checked)}>
            Download preview images to local storage {previewLimit === 'Unlimited' ? '(all available)' : `(limit: ${previewLimit})`}
          </Check>
        </div>
      </div>

      <div>
        <div className={sectionHeader}>Import behavior</div>
        <div className="space-y-3">
          <Check checked={moveFoldersToLibrary} onChange={(e) => setMoveFoldersToLibrary(e.target.checked)}>
            <span className="font-medium">Move folder imports to the library</span>
            <span className="block text-sm text-muted">When disabled, folder imports are added in place. Archive imports still extract to the library.</span>
          </Check>
          <Check checked={deleteSourceArchiveAfterImport} onChange={(e) => setDeleteSourceArchiveAfterImport(e.target.checked)}>
            <span className="font-medium">Delete source archive after successful extraction</span>
            <span className="block text-sm text-muted">Applies only to archive files.</span>
          </Check>
          <div className="text-sm">
            {defaultLibraryPath ? (
              <span className="text-success">Library destination: <strong>{defaultLibraryPath}</strong></span>
            ) : askingForLibraryFolder ? (
              <span className="text-warning">Waiting for library folder selection...</span>
            ) : (
              <span className="text-warning">No default library folder set. You will be asked to choose one before import.</span>
            )}
          </div>
        </div>
      </div>

      <div>
        <div className={sectionHeader}>Replacement</div>
        <Check checked={autoSelectLatestReplaceVersion} onChange={onAutoSelectChange}>
          <span className="font-medium">Auto-select latest installed version for replacement</span>
          <span className="block text-sm text-muted">
            Preselects the newest installed version in Replace Version dropdowns and shows the Replace Version column. You can still change it to None before importing.
          </span>
        </Check>
      </div>

      <div className="flex justify-end space-x-2">
        <button onClick={onStartScan} className="bg-accent p-2" style={{ pointerEvents: 'auto', zIndex: 1000 }}>Next</button>
        <button onClick={() => window.electronAPI.closeWindow()} className="bg-accent p-2" style={{ pointerEvents: 'auto', zIndex: 1000 }}>Cancel</button>
      </div>
    </div>
  )
}
