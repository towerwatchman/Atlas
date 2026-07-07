import { buildFolderRegex } from '../folderRegex.js'

// Checkbox + label row used throughout the settings form. Defined at module
// scope so it isn't re-created (and its children re-mounted) on every render.
function Check({ checked, onChange, title, children }) {
  return (
    <label className="flex items-start gap-2 cursor-pointer" title={title}>
      <input type="checkbox" checked={checked} onChange={onChange} className="mt-1 h-4 w-4 shrink-0 accent-accent" />
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
  onSelectFolder, onStartScan, onOpenHelp, livePreview,
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
        <input type="text" value={folder} readOnly className="sm:ml-2 flex-1 min-w-0 bg-secondary text-text border border-border rounded-buttonTheme p-1 focus:outline-none focus:ring-1 focus:ring-accent" />
        <button onClick={onSelectFolder} className="sm:ml-2 bg-accent hover:bg-accentHover text-white rounded-buttonTheme px-3 py-1 transition-colors" style={{ pointerEvents: 'auto', zIndex: 1000 }}>
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
            className="sm:ml-2 bg-secondary text-text border border-border rounded-buttonTheme p-1 focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {formatPresets.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
            <option value="custom">Custom</option>
          </select>
          <input
            type="text" value={customFormat}
            onChange={(e) => setCustomFormat(e.target.value)}
            className="sm:ml-2 flex-1 min-w-0 bg-secondary text-text border border-border rounded-buttonTheme p-1 focus:outline-none focus:ring-1 focus:ring-accent"
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
          className={`sm:ml-2 flex-1 min-w-0 bg-secondary text-text border border-border rounded-buttonTheme p-1 focus:outline-none focus:ring-1 focus:ring-accent font-mono text-xs ${regexDisabled ? 'opacity-70' : ''}`}
        />
        <label className="sm:ml-2 flex items-center gap-1 whitespace-nowrap" title="Edit the regex directly">
          <input
            type="checkbox"
            checked={useCustomRegex}
            onChange={(e) => setUseCustomRegex(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          <span className="text-sm">Edit regex</span>
        </label>
      </div>

      <div className={fieldRow}>
        <label className={fieldLabel}>Game Extensions:</label>
        <input type="text" value={gameExt} onChange={(e) => setGameExt(e.target.value)} className="sm:ml-2 flex-1 min-w-0 bg-secondary text-text border border-border rounded-buttonTheme p-1 focus:outline-none focus:ring-1 focus:ring-accent" />
      </div>

      <Check checked={includeArchives} onChange={(e) => setIncludeArchives(e.target.checked)}>
        <span className="font-medium">Include archives</span>
        <span className="block text-sm text-muted">Scan archive files (zip, 7z, rar) in addition to folders.</span>
      </Check>

      {includeArchives && (
        <div className={fieldRow}>
          <label className={fieldLabel}>Archive Extensions:</label>
          <input type="text" value={archiveExt} onChange={(e) => setArchiveExt(e.target.value)} className="sm:ml-2 flex-1 min-w-0 bg-secondary text-text border border-border rounded-buttonTheme p-1 focus:outline-none focus:ring-1 focus:ring-accent" />
        </div>
      )}

      {/* Live parse preview — shows how the first folder parses under the
          current scheme so the user can confirm before scanning. */}
      <div className="border border-border rounded-buttonTheme bg-primary p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Live Preview</span>
          {onOpenHelp && (
            <button type="button" onClick={onOpenHelp} className="text-xs text-accent hover:underline">
              <i className="fas fa-circle-question mr-1" aria-hidden="true"></i>Scheme help &amp; examples
            </button>
          )}
        </div>
        {!folder ? (
          <p className="text-sm text-muted">Set a game path to preview how your folders will be parsed.</p>
        ) : !livePreview ? (
          <p className="text-sm text-muted">Reading first folder…</p>
        ) : (
          <div className="space-y-2">
            {livePreview.sample && (
              <div className="text-xs text-muted break-all">
                Sample: <span className="font-mono text-text">{livePreview.sample}</span>
              </div>
            )}
            {livePreview.note && <div className="text-sm text-warning">{livePreview.note}</div>}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
              {[
                ['Title', livePreview.fields.title, true],
                ['Creator', livePreview.fields.creator, true],
                ['Version', livePreview.fields.version, true],
                ['Engine', livePreview.fields.engine, false],
                ['F95 ID', livePreview.fields.f95Id, false],
                ['LC ID', livePreview.fields.lcId, false],
              ].filter(([, value, always]) => always || value).map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
                  <div className="truncate">{value || <span className="text-muted">—</span>}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div>
        <div className={sectionHeader}>Options</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
          <Check checked={downloadBannerImages} onChange={(e) => setDownloadBannerImages(e.target.checked)}>
            <span className="font-medium">Download banner images</span>
            <span className="block text-sm text-muted">Save banners to local storage.</span>
          </Check>
          <Check checked={downloadPreviewImages} onChange={(e) => setDownloadPreviewImages(e.target.checked)}>
            <span className="font-medium">Download preview images</span>
            <span className="block text-sm text-muted">{previewLimit === 'Unlimited' ? 'All available previews.' : `Up to ${previewLimit} previews.`}</span>
          </Check>
          <Check checked={moveFoldersToLibrary} onChange={(e) => setMoveFoldersToLibrary(e.target.checked)}>
            <span className="font-medium">Move folder imports to the library</span>
            <span className="block text-sm text-muted">When off, folder imports are added in place. Archives still extract to the library.</span>
          </Check>
          <Check checked={deleteSourceArchiveAfterImport} onChange={(e) => setDeleteSourceArchiveAfterImport(e.target.checked)}>
            <span className="font-medium">Delete source archive after extraction</span>
            <span className="block text-sm text-muted">Applies only to archive files.</span>
          </Check>
          <Check checked={autoSelectLatestReplaceVersion} onChange={onAutoSelectChange}>
            <span className="font-medium">Auto-select latest version for replacement</span>
            <span className="block text-sm text-muted">Preselects the newest installed version in Replace Version dropdowns.</span>
          </Check>
        </div>
        <div className="text-sm mt-3">
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
  )
}
