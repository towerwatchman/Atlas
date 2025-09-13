const { useState, useEffect } = window.React;
const ReactDOM = window.ReactDOM || {};
const createRoot = ReactDOM.createRoot || ((container) => {
  // Fallback to ReactDOM.render if createRoot is not available
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
  const [downloadImages, setDownloadImages] = useState(false);
  const [scanSize, setScanSize] = useState(false);
  const [deleteAfter, setDeleteAfter] = useState(false);
  const [moveGame, setMoveGame] = useState(false);
  const [progress, setProgress] = useState({ value: 0, total: 0, potential: 0 });
  const [gamesList, setGamesList] = useState([]);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    window.electronAPI.onWindowStateChanged((state) => {
      setIsMaximized(state === 'maximized');
    });
    window.electronAPI.onScanProgress((prog) => {
      setProgress(prog);
    });
    window.electronAPI.onScanComplete((games) => {
      setGamesList(games);
    });
    window.electronAPI.getConfig().then((config) => {
      const librarySettings = config.Library || {};
      setGameExt(librarySettings.gameExtensions || 'exe,swf,flv,f4v,rag,cmd,bat,jar,html');
      setArchiveExt(librarySettings.extractionExtensions || 'zip,7z,rar');
    });
  }, []);

  const selectFolder = async () => {
    const path = await window.electronAPI.selectDirectory();
    if (path) setFolder(path);
  };

  const startScan = async () => {
    if (!folder) return alert('Select a folder');
    setView('scan'); // Switch to scan view immediately
    const params = {
      folder,
      format: useUnstructured ? '' : customFormat,
      gameExt: gameExt.split(',').map(e => e.trim()),
      archiveExt: archiveExt.split(',').map(e => e.trim()),
      isCompressed,
      deleteAfter,
      scanSize,
      downloadImages
    };
    const result = await window.electronAPI.startScan(params);
    if (!result.success) alert(`Error: ${result.error}`);
  };

  const updateGame = (index, field, value) => {
    const updated = [...gamesList];
    updated[index][field] = value;
    setGamesList(updated);
  };

  const handleResultChange = async (index, value) => {
    const updated = [...gamesList];
    const game = updated[index];
    game.resultSelectedValue = value;
    const selected = game.results.find(r => r.key === value);
    if (selected) {
      const parts = selected.value.split(' | ');
      game.atlasId = parts[0];
      game.title = parts[1];
      game.creator = parts[2];
      game.f95Id = await window.electronAPI.findF95Id(game.atlasId);
    }
    setGamesList(updated);
  };

  const updateMatches = async () => {
    if (gamesList.length === 0) {
      alert('No games to update. Please scan a folder first.');
      return;
    }
    const updated = [...gamesList];
    for (let i = 0; i < updated.length; i++) {
      const game = updated[i];
      const data = await window.electronAPI.searchAtlas(game.title, game.creator);
      if (data.length === 1) {
        game.atlasId = data[0].atlas_id;
        game.f95Id = await window.electronAPI.findF95Id(game.atlasId);
        game.title = data[0].title;
        game.creator = data[0].creator;
        game.engine = data[0].engine || game.engine;
        game.results = [];
        game.resultVisibility = 'hidden';
      } else if (data.length > 1) {
        game.results = data.map(d => ({ key: d.atlas_id, value: `${d.atlas_id} | ${d.title} | ${d.creator}` }));
        game.resultSelectedValue = game.results[0].key;
        game.resultVisibility = 'visible';
      } else {
        game.atlasId = '';
        game.f95Id = '';
        game.results = [];
        game.resultVisibility = 'hidden';
      }
    }
    setGamesList(updated);
  };

  const importGamesFunc = () => {
    const params = {
      games: gamesList,
      deleteAfter,
      scanSize,
      downloadImages,
      gameExt: gameExt.split(',').map(e => e.trim())
    };
    window.electronAPI.importGames(params); // Do not await, run in background
    window.electronAPI.closeWindow(); // Close importer immediately
  };

  return (
    <div className="h-screen flex flex-col bg-canvas text-text">
      {/* Window Controls */}
      <div className="bg-primary h-8 flex justify-end items-center pr-2 border-b border-windowAccent">
        <button onClick={() => window.electronAPI.minimizeWindow()} className="text-text hover:text-highlight mx-1">−</button>
        <button onClick={() => window.electronAPI.maximizeWindow()} className="text-text hover:text-highlight mx-1">{isMaximized ? '↙' : '□'}</button>
        <button onClick={() => window.electronAPI.closeWindow()} className="text-text hover:text-highlight mx-1">×</button>
      </div>
      <div className="flex-1 p-4">
        {view === 'settings' ? (
          <div className="space-y-4">
            <h2 className="text-xl">Import Games Wizard</h2>
            <div className="flex items-center">
              <label className="w-24">Game Path:</label>
              <input type="text" value={folder} readOnly className="ml-2 flex-1 bg-secondary border border-border p-1" />
              <button onClick={selectFolder} className="ml-2 bg-elementNormal hover:bg-elementSelected text-text p-1 rounded">Set Folder</button>
            </div>
            <div className="flex items-center">
              <label className="w-24">Folder Structure:</label>
              <input type="text" value={customFormat} onChange={(e) => setCustomFormat(e.target.value)} disabled={useUnstructured} className="ml-2 flex-1 bg-secondary border border-border p-1" />
              <input type="checkbox" checked={useUnstructured} onChange={(e) => setUseUnstructured(e.target.checked)} className="ml-2" />
              <label>Unstructured Format</label>
            </div>
            <div className="flex items-center">
              <label className="w-24">Game Extensions:</label>
              <input type="text" value={gameExt} onChange={(e) => setGameExt(e.target.value)} className="ml-2 flex-1 bg-secondary border border-border p-1" />
              <input type="checkbox" checked={isCompressed} onChange={(e) => setIsCompressed(e.target.checked)} className="ml-2" />
              <label>Extract Games</label>
            </div>
            {isCompressed && (
              <div className="flex items-center">
                <label className="w-24">Archive formats:</label>
                <input type="text" value={archiveExt} onChange={(e) => setArchiveExt(e.target.value)} className="ml-2 flex-1 bg-secondary border border-border p-1" />
              </div>
            )}
            <p className="text-sm">
              There are 4 valid options you can use for the folder structure: Title, Creator, Engine, and Version<br/>
              - Each of the options need to be surrounded by braces {'{{}}'}. Use / for folders.<br/>
              - If you have games that are not sorted, use the check box and the program will attempt to parse the title and version<br/><br/>
              Examples<br/>
              {'{engine}/{creator}/{title}/{version}'}<br/>
              {'[{engine}] [{title}] [{version}]'}<br/>
              {'{title-version}'}
            </p>
            <div className="space-y-2">
              <div><input type="checkbox" checked={downloadImages} onChange={(e) => setDownloadImages(e.target.checked)} className="mr-2" /> Download Images</div>
              <div><input type="checkbox" checked={moveGame} onChange={(e) => setMoveGame(e.target.checked)} disabled className="mr-2" /> Move to Atlas game folder</div>
              <div><input type="checkbox" checked={scanSize} onChange={(e) => setScanSize(e.target.checked)} className="mr-2" /> Scan folder size during import</div>
              {isCompressed && <div><input type="checkbox" checked={deleteAfter} onChange={(e) => setDeleteAfter(e.target.checked)} className="mr-2" /> Delete Folder After Extraction</div>}
            </div>
            <div className="flex justify-end space-x-2">
              <button onClick={startScan} className="bg-elementNormal hover:bg-elementSelected text-text p-2 rounded">Next</button>
              <button onClick={() => window.electronAPI.closeWindow()} className="bg-elementNormal hover:bg-elementSelected text-text p-2 rounded">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <h2 className="text-xl">Scan Results</h2>
            <div className="flex items-center">
              <progress value={progress.value} max={progress.total} className="w-96 bg-tertiary" />
              <span className="ml-2 text-text">{progress.value}/{progress.total} Folders Scanned, {progress.potential} Games Found</span>
            </div>
            <div className="overflow-auto max-h-96">
              <table className="w-full border-collapse border border-border">
                <thead>
                  <tr className="bg-secondary">
                    <th className="border border-border p-1 text-text">Atlas ID</th>
                    <th className="border border-border p-1 text-text">F95 ID</th>
                    <th className="border border-border p-1 text-text">Title</th>
                    <th className="border border-border p-1 text-text">Creator</th>
                    <th className="border border-border p-1 text-text">Engine</th>
                    <th className="border border-border p-1 text-text">Version</th>
                    <th className="border border-border p-1 text-text">Executable</th>
                    <th className="border border-border p-1 text-text">Possible Database Matches</th>
                    <th className="border border-border p-1 text-text">Folder</th>
                  </tr>
                </thead>
                <tbody>
                  {gamesList.map((game, index) => (
                    <tr key={index} className="bg-tertiary">
                      <td className="border border-border p-1">{game.atlasId}</td>
                      <td className="border border-border p-1">{game.f95Id}</td>
                      <td className="border border-border p-1">
                        <input value={game.title} onChange={(e) => updateGame(index, 'title', e.target.value)} className="w-full bg-secondary border border-border p-1" />
                      </td>
                      <td className="border border-border p-1">
                        <input value={game.creator} onChange={(e) => updateGame(index, 'creator', e.target.value)} className="w-full bg-secondary border border-border p-1" />
                      </td>
                      <td className="border border-border p-1">
                        <input value={game.engine} onChange={(e) => updateGame(index, 'engine', e.target.value)} className="w-full bg-secondary border border-border p-1" />
                      </td>
                      <td className="border border-border p-1">
                        <input value={game.version} onChange={(e) => updateGame(index, 'version', e.target.value)} className="w-full bg-secondary border border-border p-1" />
                      </td>
                      <td className="border border-border p-1">
                        {game.multipleVisible === 'visible' ? (
                          <select value={game.selectedValue} onChange={(e) => updateGame(index, 'selectedValue', e.target.value)} className="w-full bg-secondary border border-border p-1">
                            {game.executables.map((opt) => (
                              <option key={opt.key} value={opt.key}>{opt.value}</option>
                            ))}
                          </select>
                        ) : (
                          game.singleExecutable
                        )}
                      </td>
                      <td className="border border-border p-1" style={{ visibility: game.resultVisibility }}>
                        {game.results.length > 0 && (
                          <select value={game.resultSelectedValue} onChange={(e) => handleResultChange(index, e.target.value)} className="w-full bg-secondary border border-border p-1">
                            {game.results.map((opt) => (
                              <option key={opt.key} value={opt.key}>{opt.value}</option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="border border-border p-1">{game.folder}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end space-x-2">
              <button onClick={updateMatches} className="bg-elementNormal hover:bg-elementSelected text-text p-2 rounded">Update</button>
              <button onClick={importGamesFunc} className="bg-elementNormal hover:bg-elementSelected text-text p-2 rounded">Import</button>
              <button onClick={() => window.electronAPI.closeWindow()} className="bg-elementNormal hover:bg-elementSelected text-text p-2 rounded">Cancel</button>
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