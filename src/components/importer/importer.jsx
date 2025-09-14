const { useState, useEffect } = window.React;
const ReactDOM = window.ReactDOM || {};
const createRoot = ReactDOM.createRoot || ((container) => {
  return {
    render: (component) => ReactDOM.render(component, container)
  };
});

const Importer = () => {
  const [view, setView] = useState('settings');
  const [folder, setFolder] = useState('');
  const [useUnstructured, setUseUnstructured] = useState(true);
  const [customFormat, setCustomFormat] = useState('{creator}/{title}/{version}');
  const [gameExt, setGameExt] = useState('exe,swf,flv,f4v,rag,cmd,bat,jar,html');
  const [archiveExt, setArchiveExt] = useState('zip,7z,rar');
  const [isCompressed, setIsCompressed] = useState(false);
  const [downloadBannerImages, setDownloadBannerImages] = useState(false);
  const [downloadPreviewImages, setDownloadPreviewImages] = useState(false);
  const [previewLimit, setPreviewLimit] = useState('5');
  const [downloadVideos, setDownloadVideos] = useState(false);
  const [scanSize, setScanSize] = useState(false);
  const [deleteAfter, setDeleteAfter] = useState(false);
  const [moveGame, setMoveGame] = useState(false);
  const [progress, setProgress] = useState({ value: 0, total: 0, potential: 0 });
  const [updateProgress, setUpdateProgress] = useState({ value: 0, total: 0 });
  const [gamesList, setGamesList] = useState([]);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    console.log('Importer component mounted');
    window.electronAPI.log('Importer component mounted');
    window.electronAPI.onWindowStateChanged((state) => {
      console.log(`Window state changed: ${state}`);
      window.electronAPI.log(`Window state changed: ${state}`);
      setIsMaximized(state === 'maximized');
    });
    window.electronAPI.onScanProgress((prog) => {
      //console.log(`Scan progress: ${JSON.stringify(prog)}`);
      //window.electronAPI.log(`Scan progress: ${JSON.stringify(prog)}`);
      setProgress(prog);
    });
    window.electronAPI.onScanComplete((game) => {
      //console.log(`Received incremental game: ${JSON.stringify(game)}`);
      //window.electronAPI.log(`Received incremental game: ${JSON.stringify(game)}`);
      setGamesList(prev => [...prev, game]); // Append new game incrementally
    });
    window.electronAPI.onScanCompleteFinal((games) => {
      //console.log(`Scan complete, received ${games.length} games`);
      //window.electronAPI.log(`Scan complete, received ${games.length} games`);
      setGamesList(games); // Set final games list to ensure all are included
    });
    window.electronAPI.onUpdateProgress((prog) => {
      console.log(`Update progress: ${JSON.stringify(prog)}`);
      window.electronAPI.log(`Update progress: ${JSON.stringify(prog)}`);
      setUpdateProgress(prog);
    });
    window.electronAPI.getConfig().then((config) => {
      console.log(`Config loaded: ${JSON.stringify(config)}`);
      window.electronAPI.log(`Config loaded: ${JSON.stringify(config)}`);
      const librarySettings = config.Library || {};
      setGameExt(librarySettings.gameExtensions || 'exe,swf,flv,f4v,rag,cmd,bat,jar,html');
      setArchiveExt(librarySettings.extractionExtensions || 'zip,7z,rar');
    }).catch((err) => {
      console.error('Error loading config:', err);
      window.electronAPI.log(`Error loading config: ${err.message}`);
    });
  }, []);

  const selectFolder = async () => {
    console.log('Selecting folder');
    window.electronAPI.log('Selecting folder');
    const path = await window.electronAPI.selectDirectory();
    if (path) {
      console.log(`Folder selected: ${path}`);
      window.electronAPI.log(`Folder selected: ${path}`);
      setFolder(path);
    }
  };

  const startScan = async () => {
    if (!folder) {
      console.log('No folder selected');
      window.electronAPI.log('No folder selected');
      return alert('Select a folder');
    }
    console.log('Starting scan');
    window.electronAPI.log('Starting scan');
    setView('scan');
    setGamesList([]); // Clear gamesList to start fresh
    const params = {
      folder,
      format: useUnstructured ? '' : customFormat,
      gameExt: gameExt.split(',').map(e => e.trim()),
      archiveExt: archiveExt.split(',').map(e => e.trim()),
      isCompressed,
      deleteAfter,
      scanSize,
      downloadBannerImages,
      downloadPreviewImages,
      previewLimit,
      downloadVideos
    };
    console.log(`Scan params: ${JSON.stringify(params)}`);
    window.electronAPI.log(`Scan params: ${JSON.stringify(params)}`);
    const result = await window.electronAPI.startScan(params);
    if (!result.success) {
      console.error(`Scan error: ${result.error}`);
      window.electronAPI.log(`Scan error: ${result.error}`);
      alert(`Error: ${result.error}`);
    }
  };

  const updateGame = (index, field, value) => {
    console.log(`Updating game at index ${index}, field ${field} to ${value}`);
    window.electronAPI.log(`Updating game at index ${index}, field ${field} to ${value}`);
    const updated = [...gamesList];
    updated[index][field] = value;
    setGamesList(updated);
  };

  const handleResultChange = async (index, value) => {
    console.log(`Handling result change for index ${index}, value ${value}`);
    window.electronAPI.log(`Handling result change for index ${index}, value ${value}`);
    const updated = [...gamesList];
    const game = updated[index];
    game.resultSelectedValue = value;
    const selected = game.results.find(r => r.key === value);
    if (selected && value !== 'match') {
      const parts = selected.value.split(' | ');
      game.atlasId = parts[0];
      game.f95Id = parts[1] || '';
      game.title = parts[2];
      game.creator = parts[3];
      const atlasData = await window.electronAPI.getAtlasData(game.atlasId);
      game.engine = atlasData.engine || 'Unknown';
      console.log(`Updated game: ${JSON.stringify(game)}`);
      window.electronAPI.log(`Updated game: ${JSON.stringify(game)}`);
    }
    setGamesList(updated);
  };

  const updateMatches = async () => {
    console.log('Updating games');
    window.electronAPI.log('Updating games');
    const total = gamesList.length;
    setUpdateProgress({ value: 0, total });
    window.electronAPI.sendUpdateProgress({ value: 0, total });
    let updated = [...gamesList];
    for (let i = 0; i < updated.length; i++) {
      const game = updated[i];
      console.log(`Searching for game: ${game.title}, Creator: ${game.creator}`);
      window.electronAPI.log(`Searching for game: ${game.title}, Creator: ${game.creator}`);
      const data = await window.electronAPI.searchAtlas(game.title, game.creator);
      console.log(`Search results for ${game.title}: ${JSON.stringify(data)}`);
      window.electronAPI.log(`Search results for ${game.title}: ${JSON.stringify(data)}`);
      if (data.length === 1) {
        game.atlasId = data[0].atlas_id;
        game.f95Id = data[0].f95_id || '';
        game.title = data[0].title;
        game.creator = data[0].creator;
        game.engine = data[0].engine || game.engine || 'Unknown';
        game.results = [{ key: 'match', value: 'Match Found' }];
        game.resultSelectedValue = 'match';
        game.resultVisibility = 'visible';
      } else if (data.length > 1) {
        game.results = data.map(d => ({
          key: d.atlas_id,
          value: `${d.atlas_id} | ${d.f95_id || ''} | ${d.title} | ${d.creator}`
        }));
        // Preserve existing selection if still valid
        const currentSelection = game.resultSelectedValue;
        const validSelection = game.results.find(r => r.key === currentSelection);
        game.resultSelectedValue = validSelection ? currentSelection : game.results[0].key;
        game.resultVisibility = 'visible';
        const selectedResult = game.results.find(r => r.key === game.resultSelectedValue) || game.results[0];
        const parts = selectedResult.value.split(' | ');
        game.atlasId = parts[0];
        game.f95Id = parts[1] || '';
        game.title = parts[2];
        game.creator = parts[3];
        const atlasData = await window.electronAPI.getAtlasData(parts[0]);
        game.engine = atlasData.engine || game.engine || 'Unknown';
      } else {
        game.atlasId = '';
        game.f95Id = '';
        game.results = [];
        game.resultSelectedValue = '';
        game.resultVisibility = 'hidden';
      }
      // Update the table incrementally with a slight delay to ensure rendering
      await new Promise(resolve => setTimeout(resolve, 0));
      setGamesList([...updated]);
      setUpdateProgress({ value: i + 1, total });
      window.electronAPI.sendUpdateProgress({ value: i + 1, total });
    }
    console.log('Finished updating games');
    window.electronAPI.log('Finished updating games');
    setUpdateProgress({ value: total, total });
    window.electronAPI.sendUpdateProgress({ value: total, total });
  };

  const importGamesFunc = () => {
    console.log('Importing games');
    window.electronAPI.log('Importing games');
    const params = {
      games: gamesList,
      deleteAfter,
      scanSize,
      downloadBannerImages,
      downloadPreviewImages,
      previewLimit,
      downloadVideos,
      gameExt: gameExt.split(',').map(e => e.trim())
    };
    window.electronAPI.importGames(params);
    window.electronAPI.closeWindow();
  };

  const handleUpdateClick = (event) => {
    console.log('Update button clicked', event);
    window.electronAPI.log('Update button clicked');
    updateMatches();
  };

  //console.log('Rendering Importer component, view:', view);
  //window.electronAPI.log(`Rendering Importer component, view: ${view}`);
  return (
    <div className="h-screen flex flex-col fixed w-full">
      {/* Window Controls */}
      <div className="bg-primary h-8 flex justify-end items-center pr-2 -webkit-app-region-drag">
        <p className="text-sm absolute left-2 top-1">Import Games Wizard</p>
        <div className="flex absolute top-1 right-2 h-[70px] -webkit-app-region-no-drag">
          <button
            onClick={() => window.electronAPI.minimizeWindow()}
            className="w-6 h-6 flex items-center justify-center bg-transparent hover:bg-tertiary transition-colors duration-200"
            style={{ pointerEvents: 'auto', zIndex: 1000 }}
          >
            <i className="fas fa-minus fa-xs text-text"></i>
          </button>
          <button
            onClick={() => window.electronAPI.maximizeWindow()}
            className="w-6 h-6 flex items-center justify-center bg-transparent hover:bg-tertiary transition-colors duration-200"
            style={{ pointerEvents: 'auto', zIndex: 1000 }}
          >
            <i className={isMaximized ? "fas fa-window-restore fa-xs text-text" : "fas fa-window-maximize fa-xs text-text"}></i>
          </button>
          <button
            onClick={() => window.electronAPI.closeWindow()}
            className="w-6 h-6 flex items-center justify-center bg-transparent hover:bg-[DarkRed] transition-colors duration-200"
            style={{ pointerEvents: 'auto', zIndex: 1000 }}
          >
            <i className="fas fa-times fa-xs text-text"></i>
          </button>
        </div>
      </div>
      <div className="flex-1 p-4 bg-secondary overflow-y-auto">
        {view === 'settings' ? (
          <div className="space-y-4 flex-1">
            <div className="flex items-center">
              <label>Game Path:</label>
              <input
                type="text"
                value={folder}
                readOnly
                className="ml-2 flex-1 bg-secondary border border-border p-1"
              />
              <button
                onClick={selectFolder}
                className="ml-2 bg-accent p-1"
                style={{ pointerEvents: 'auto', zIndex: 1000 }}
              >
                Set Folder
              </button>
            </div>
            <div className="flex items-center">
              <label>Folder Structure:</label>
              <input
                type="text"
                value={customFormat}
                onChange={(e) => setCustomFormat(e.target.value)}
                disabled={useUnstructured}
                className="ml-2 flex-1 bg-secondary border border-border p-1"
              />
              <input
                type="checkbox"
                checked={useUnstructured}
                onChange={(e) => setUseUnstructured(e.target.checked)}
                className="ml-2"
              />
              <label>Unstructured Format</label>
            </div>
            <div className="flex items-center">
              <label>Game Extensions:</label>
              <input
                type="text"
                value={gameExt}
                onChange={(e) => setGameExt(e.target.value)}
                className="ml-2 flex-1 bg-secondary border border-border p-1"
              />
              <input
                type="checkbox"
                checked={isCompressed}
                onChange={(e) => setIsCompressed(e.target.checked)}
                className="ml-2"
              />
              <label>Extract Games</label>
            </div>
            {isCompressed && (
              <div className="flex items-center">
                <label>Archive formats:</label>
                <input
                  type="text"
                  value={archiveExt}
                  onChange={(e) => setArchiveExt(e.target.value)}
                  className="ml-2 flex-1 bg-secondary border border-border p-1"
                />
              </div>
            )}
            <p className="text-sm text-text leading-relaxed">
              Valid folder structure options: <span className="font-semibold">Title</span>, <span className="font-semibold">Creator</span>, <span className="font-semibold">Engine</span>, and <span className="font-semibold">Version</span>.<br />
              - Enclose each option in braces, e.g., <span className="font-mono">{'{Title}'}</span>. Use <span className="font-mono">/</span> for folder separators.<br />
              - For unsorted games, check "Unstructured Format" to let the program parse the title and version automatically.<br /><br />
              Examples:<br />
              <span className="font-mono">{'{engine}/{creator}/{title}/{version}'}</span><br />
              <span className="font-mono">{'[{engine}] [{title}] [{version}]'}</span><br />
              <span className="font-mono">{'{title-version}'}</span>
            </p>
            <div className="space-y-2">
              <div>
                <input
                  type="checkbox"
                  checked={downloadBannerImages}
                  onChange={(e) => setDownloadBannerImages(e.target.checked)}
                />
                <label>Download Banner Images</label>
              </div>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={downloadPreviewImages}
                  onChange={(e) => setDownloadPreviewImages(e.target.checked)}
                />
                <label className="mr-2">Download Preview Images</label>
                <select
                  value={previewLimit}
                  onChange={(e) => setPreviewLimit(e.target.value)}
                  className="bg-secondary border border-border p-1"
                >
                  <option value="5">5</option>
                  <option value="10">10</option>
                  <option value="Unlimited">Unlimited</option>
                </select>
                <label className="ml-2">Amount of Previews to Download</label>
              </div>
              <div>
                <input
                  type="checkbox"
                  checked={downloadVideos}
                  onChange={(e) => setDownloadVideos(e.target.checked)}
                />
                <label>Download Videos (.gif, .mp4, .webm)</label>
              </div>
              <div>
                <input
                  type="checkbox"
                  checked={moveGame}
                  onChange={(e) => setMoveGame(e.target.checked)}
                  disabled
                />
                <label>Move to Atlas game folder</label>
              </div>
              <div>
                <input
                  type="checkbox"
                  checked={scanSize}
                  onChange={(e) => setScanSize(e.target.checked)}
                />
                <label>Scan folder size during import</label>
              </div>
              {isCompressed && (
                <div>
                  <input
                    type="checkbox"
                    checked={deleteAfter}
                    onChange={(e) => setDeleteAfter(e.target.checked)}
                  />
                  <label>Delete Folder After Extraction</label>
                </div>
              )}
            </div>
            <div className="flex justify-end space-x-2">
              <button
                onClick={startScan}
                className="bg-accent p-2"
                style={{ pointerEvents: 'auto', zIndex: 1000 }}
              >
                Next
              </button>
              <button
                onClick={() => window.electronAPI.closeWindow()}
                className="bg-accent p-2"
                style={{ pointerEvents: 'auto', zIndex: 1000 }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col">
            <div className="shrink-0">
              <h2 className="text-xl mb-4">Scan Results</h2>
              <div className="flex items-center mb-4">
                <progress value={progress.value} max={progress.total} className="w-96" />
                <span className="ml-2">{progress.value}/{progress.total} Folders Scanned</span>
              </div>
              <span className="mb-4">Found {progress.potential} Games</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full border-collapse border border-border">
                <thead>
                  <tr className="bg-secondary sticky top-0">
                    <th className="border border-border p-1">Atlas ID</th>
                    <th className="border border-border p-1">F95 ID</th>
                    <th className="border border-border p-1">Title</th>
                    <th className="border border-border p-1">Creator</th>
                    <th className="border border-border p-1">Engine</th>
                    <th className="border border-border p-1">Version</th>
                    <th className="border border-border p-1">Executable</th>
                    <th className="border border-border p-1">Possible Database Matches</th>
                    <th className="border border-border p-1">Folder</th>
                  </tr>
                </thead>
                <tbody>
                  {gamesList.map((game, index) => (
                    <tr key={index} className="bg-primary">
                      <td className="border border-border p-1">{game.atlasId}</td>
                      <td className="border border-border p-1">{game.f95Id}</td>
                      <td className="border border-border p-1">
                        <input
                          value={game.title}
                          onChange={(e) => updateGame(index, 'title', e.target.value)}
                          className="w-full bg-secondary border border-border p-1"
                        />
                      </td>
                      <td className="border border-border p-1">
                        <input
                          value={game.creator}
                          onChange={(e) => updateGame(index, 'creator', e.target.value)}
                          className="w-full bg-secondary border border-border p-1"
                        />
                      </td>
                      <td className="border border-border p-1">
                        <input
                          value={game.engine}
                          onChange={(e) => updateGame(index, 'engine', e.target.value)}
                          className="w-full bg-secondary border border-border p-1"
                        />
                      </td>
                      <td className="border border-border p-1">
                        <input
                          value={game.version}
                          onChange={(e) => updateGame(index, 'version', e.target.value)}
                          className="w-full bg-secondary border border-border p-1"
                        />
                      </td>
                      <td className="border border-border p-1">
                        {game.multipleVisible === 'visible' ? (
                          <select
                            value={game.selectedValue}
                            onChange={(e) => updateGame(index, 'selectedValue', e.target.value)}
                            className="w-full bg-secondary border border-border p-1"
                          >
                            {game.executables.map((opt) => (
                              <option key={opt.key} value={opt.key}>{opt.value}</option>
                            ))}
                          </select>
                        ) : (
                          game.singleExecutable
                        )}
                      </td>
                      <td className="border border-border p-1" style={{ visibility: game.resultVisibility }}>
                        {game.results.length === 1 && game.results[0].key === 'match' ? (
                          <span className="text-text select-none">{game.results[0].value}</span>
                        ) : (
                          game.results.length > 1 && (
                            <select
                              value={game.resultSelectedValue}
                              onChange={(e) => handleResultChange(index, e.target.value)}
                              className="w-full bg-secondary border border-border p-1"
                            >
                              {game.results.map((opt) => (
                                <option key={opt.key} value={opt.key}>{opt.value}</option>
                              ))}
                            </select>
                          )
                        )}
                      </td>
                      <td className="border border-border p-1">{game.folder}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="shrink-0 mt-4 flex justify-end space-x-2">
              <button
                onClick={handleUpdateClick}
                className="bg-elementNormal hover:bg-elementSelected text-text p-2 rounded"
                style={{ pointerEvents: 'auto', zIndex: 1000 }}
              >
                Update
              </button>
              <button
                onClick={importGamesFunc}
                className="bg-elementNormal hover:bg-elementSelected text-text p-2 rounded"
                style={{ pointerEvents: 'auto', zIndex: 1000 }}
              >
                Import
              </button>
              <button
                onClick={() => window.electronAPI.closeWindow()}
                className="bg-elementNormal hover:bg-elementSelected text-text p-2 rounded"
                style={{ pointerEvents: 'auto', zIndex: 1000 }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById('root')) || {
  render: (component) => ReactDOM.render(component, document.getElementById('root'))
};
root.render(<Importer />);