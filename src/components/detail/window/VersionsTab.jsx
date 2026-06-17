export default function VersionsTab({
  versions, selectedVersion, versionData,
  onVersionSelect, onVersionInputChange,
  onSetPath, onOpenGamePath, onRefreshVersionSize, onChangeExecutable,
  onAddVersion, onRemoveVersion, onDeleteVersionFiles,
}) {
  return (
    <div className="flex h-full">
      <div className="w-40 bg-primary border-r border-border">
        <ul className="space-y-1">
          {versions.map((version, index) => (
            <li
              key={index}
              onClick={() => onVersionSelect(version)}
              className={`p-2 cursor-pointer ${selectedVersion?.version === version.version ? 'bg-selected' : 'hover:bg-button_hover'} ${version.isInstalled === false ? 'text-red-300' : ''}`}
            >
              {version.version}
              {version.isInstalled === false && <span className="block text-xs">Missing</span>}
            </li>
          ))}
        </ul>
        <div className="flex flex-col space-y-2 mt-2 px-2">
          <button onClick={onAddVersion} className="w-full px-3 py-1 bg-tertiary hover:bg-button_hover rounded text-xs">Add</button>
          <button onClick={onRemoveVersion} className="w-full px-3 py-1 bg-tertiary hover:bg-button_hover rounded text-xs">Remove from Library</button>
          <button onClick={onDeleteVersionFiles} className="w-full px-3 py-1 bg-tertiary hover:bg-button_hover rounded text-xs">Delete Files</button>
        </div>
      </div>

      <div className="flex-grow p-4 space-y-2">
        {selectedVersion?.isInstalled === false && (
          <div className="text-red-300 text-sm">
            Installed files are missing. Update the game path and executable, then save to repair this version.
          </div>
        )}
        <div className="flex items-center">
          <label className="w-24">Version</label>
          <input name="game_version" value={versionData.game_version || ''} onChange={onVersionInputChange} className="flex-grow bg-tertiary border border-border p-1 rounded" />
        </div>
        <div className="flex items-center">
          <label className="w-24">Game Path</label>
          <input name="game_path" value={versionData.game_path || ''} onChange={onVersionInputChange} className="flex-grow bg-tertiary border border-border p-1 rounded" />
          <button onClick={onSetPath} className="ml-2 px-2 py-1 bg-tertiary hover:bg-button_hover rounded">Change</button>
          <button
            onClick={onOpenGamePath}
            disabled={!versionData.game_path}
            className="ml-2 px-2 py-1 bg-tertiary hover:bg-button_hover rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Open
          </button>
        </div>
        <div className="flex items-center">
          <label className="w-24">Executable</label>
          <input name="executable" value={versionData.executable || ''} onChange={onVersionInputChange} className="flex-grow bg-tertiary border border-border p-1 rounded" />
          <button onClick={onChangeExecutable} className="ml-2 px-2 py-1 bg-tertiary hover:bg-button_hover rounded">Change</button>
        </div>
        {[
          { name: 'last_played', label: 'Last Played' },
          { name: 'playtime', label: 'Playtime' },
          { name: 'version_size', label: 'Version Size' },
          { name: 'date_added', label: 'Date Added' },
        ].map(({ name, label }) => (
          <div key={name} className="flex items-center opacity-75">
            <label className="w-24">{label}</label>
            <input name={name} value={versionData[name] || ''} disabled className="flex-grow bg-tertiary border border-border p-1 rounded cursor-not-allowed" />
            {name === 'version_size' && (
              <button
                onClick={onRefreshVersionSize}
                disabled={!versionData.game_path}
                className="ml-2 px-2 py-1 bg-tertiary hover:bg-button_hover rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Refresh
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
