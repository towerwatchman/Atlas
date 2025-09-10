const { useState, useEffect } = window.React;
const { createRoot } = window.ReactDOM;

const App = () => {
  const [games, setGames] = useState([]);
  const [selectedGame, setSelectedGame] = useState(null);
  const [filter, setFilter] = useState('');
  const [version, setVersion] = useState('0.0.0');
  const [importStatus, setImportStatus] = useState({ text: '', progress: 0, total: 0 });
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    window.electronAPI.getGames().then((games) => {
      //console.log('Games fetched:', games);
      setGames(Array.isArray(games) ? games : []);
    }).catch((error) => {
      console.error('Failed to fetch games:', error);
      setGames([]);
    });
    window.electronAPI.checkUpdates().then(({ latestVersion, currentVersion }) => {
      if (latestVersion !== currentVersion) {
        alert(`New version ${latestVersion} available!`);
      }
    }).catch((error) => {
      console.error('Failed to check updates:', error);
    });
    window.electronAPI.getVersion().then((v) => setVersion(v));

    // Listen for window state changes
    window.electronAPI.onWindowStateChanged((state) => {
      setIsMaximized(state === 'maximized');
    });
  }, []);

  const addGame = async () => {
    const path = await window.electronAPI.selectDirectory();
    if (!path) return;
    const game = {
      title: 'Sample Game',
      creator: 'Unknown',
      engine: null,
      description: 'A sample game',
      game_path: path,
      exec_path: path,
      version: '1.0',
      in_place: 0,
      last_played: null,
      version_playtime: 0,
      folder_size: 0,
      date_added: Date.now()
    };
    setImportStatus({ text: `Importing ${game.title}`, progress: 50, total: 100 });
    try {
      await window.electronAPI.addGame(game);
      const updatedGames = await window.electronAPI.getGames();
      setGames(Array.isArray(updatedGames) ? updatedGames : []);
      setImportStatus({ text: 'Import complete', progress: 100, total: 100 });
      setTimeout(() => setImportStatus({ text: '', progress: 0, total: 0 }), 2000);
    } catch (error) {
      console.error('Failed to add game:', error);
      setImportStatus({ text: `Error: ${error.message}`, progress: 0, total: 100 });
    }
  };

  const removeGame = async (id) => {
    try {
      await window.electronAPI.removeGame(id);
      const updatedGames = await window.electronAPI.getGames();
      setGames(Array.isArray(updatedGames) ? updatedGames : []);
      if (selectedGame?.record_id === id) setSelectedGame(null);
    } catch (error) {
      console.error('Failed to remove game:', error);
    }
  };

  const unzipGame = async () => {
    const zipPath = await window.electronAPI.selectFile();
    const extractPath = await window.electronAPI.selectDirectory();
    if (!zipPath || !extractPath) return;
    setImportStatus({ text: 'Unzipping game', progress: 50, total: 100 });
    try {
      const result = await window.electronAPI.unzipGame({ zipPath, extractPath });
      setImportStatus({
        text: result.success ? 'Unzip complete' : `Error: ${result.error}`,
        progress: result.success ? 100 : 0,
        total: 100
      });
      setTimeout(() => setImportStatus({ text: '', progress: 0, total: 0 }), 2000);
    } catch (error) {
      console.error('Failed to unzip game:', error);
      setImportStatus({ text: `Error: ${error.message}`, progress: 0, total: 100 });
    }
  };

  const filteredGames = games.filter((game) =>
    game &&
    game.title &&
    (game.title.toLowerCase().includes(filter.toLowerCase()) ||
    (game.tags && game.tags.toLowerCase().includes(filter.toLowerCase())))
  );

  return (
    <div className="flex flex-col h-screen font-sans text-[13px]">
      {/* Top Navigation */}
      <div className="flex h-[70px] items-center z-50 fixed w-full top-0 select-none -webkit-app-region-drag">
       
<div className="w-[60px] bg-accent flex items-center justify-center h-[70px] z-50" >

  <svg
    className="w-[50px] h-[50px] text-atlasLogo"
    viewBox="0 0 24 24"
    style={{ shapeRendering: 'geometricPrecision'}}
    fill="currentColor"   
    dangerouslySetInnerHTML= {{ __html: window.atlasLogo.path}}
  />
</div>
        <div className="flex-1 h-[70px] bg-primary relative -webkit-app-region-drag shadow-[0_4px_8px_rgba(0,0,0,0.5)]">
          {/* Accent Bar */}
          <div className="absolute top-0 left-[50px] right-[110px] h-[10px] bg-accentBar"></div>
          {/* Left Corner Polygon */}
          <div className="absolute top-0 left-[40px] w-[10px] h-[10px] bg-accentBar" style={{ clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%)' }}></div>
          {/* Right Corner Polygon */}
          <div className="absolute top-0 right-[100px] w-[10px] h-[10px] bg-accentBar" style={{ clipPath: 'polygon(0% 0%, 100% 0%, 0% 100%)' }}></div>
          {/* Window Controls */}  
          <div className="w-full flex h-[70px]">
            {/* Nav Controls */}  
            <div className="flex items-center ml-5 mt-3">
              <div className="text-accent font-semibold cursor-pointer -webkit-app-region-no-drag">Games</div>
            </div>
            <div className="flex justify-center w-full">
              <div className="flex bg-secondary h-10 w-[400px] items-center rounded mt-[20px] -webkit-app-region-no-drag">
                <i className="fas fa-search w-6 h-6 text-text pl-2"></i>
                <input
                  type="text"
                  placeholder="Search"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="bg-transparent outline-none text-text flex-1 px-2"
                />
              </div>
            </div>
          </div>
          <div className="absolute top-0 right-0 flex h-[32px] -webkit-app-region-no-drag">
            <button
              onClick={() => window.electronAPI.minimizeWindow()}
              className="w-8 h-8 flex items-center justify-center bg-transparent hover:bg-grayHover"
            >
              <i className="fas fa-minus text-text"></i>
            </button>
            <button
              onClick={() => window.electronAPI.maximizeWindow()}
              className="w-8 h-8 flex items-center justify-center bg-transparent hover:bg-grayHover"
            >
              <i className={`fas ${isMaximized ? 'fa-window-restore' : 'fa-window-maximize'} text-text`}></i>
            </button>
            <button
              onClick={() => window.electronAPI.closeWindow()}
              className="w-8 h-8 flex items-center justify-center bg-transparent hover:bg-redExit"
            >
              <i className="fas fa-times text-text"></i>
            </button>
          </div>
          <div className="absolute mt-10 top-0 right-0 flex h-[10px]">
            <span className="text-text text-xs mr-4">Version: {version} α</span>
          </div>
        </div>
      </div>
      {/* Main Content */}
      <div className="flex flex-1 bg-tertiary fixed w-full top-[70px] bottom-[40px]">
        <window.Sidebar className="fixed w-[60px] h-full z-50" />
        <div className="flex flex-1 bg-tertiary">
          {/* Game List Sidebar */}
          <div className="w-[200px] bg-secondary fixed h-full z-40 overflow-y-auto">
            {filteredGames.length === 0 ? (
              <div className="p-2 text-center text-text">No games found</div>
            ) : (
              filteredGames.map((game) => (
                <div
                  key={game.record_id}
                  className={`p-2 cursor-pointer hover:bg-selected ${
                    selectedGame?.record_id === game.record_id ? 'bg-selected' : ''
                  }`}
                  onClick={() => setSelectedGame(game)}
                >
                  {game.title}
                </div>
              ))
            )}
          </div>
          {/* Main Game Display */}
          <div className="flex-1 bg-tertiary p-4 ml-[200px] overflow-y-auto">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(537px,1fr))] gap-2 mb-2">
              {filteredGames.length === 0 ? (
                <div className="text-center text-text col-span-full">No games available</div>
              ) : (
                filteredGames.map((game) => (
                  <window.GameBanner key={game.record_id} game={game} onSelect={() => setSelectedGame(game)} />
                ))
              )}
            </div>
            {selectedGame && (
              <window.GameDetails game={selectedGame} onRemove={() => removeGame(selectedGame.record_id)} />
            )}
          </div>
        </div>
      </div>
      {/* Footer */}
      <div className="bg-primary h-[40px] flex items-center justify-between px-4 fixed bottom-0 w-full border-t border-border z-50">
        <button
          onClick={addGame}
          className="flex items-center bg-transparent text-text hover:text-highlight"
        >
          <i className="fas fa-plus mr-2 text-text"></i>
          Add Game
        </button>
        <div className="flex items-center">
          <i className="fas fa-gamepad mr-2 text-text"></i>
          <span>{`${games.length} Games Installed, ${games.length} Total Versions`}</span>
        </div>
        <div className="flex items-center">
          <i className="fas fa-download mr-2 text-text"></i>
          <span className="cursor-pointer" onClick={unzipGame}>Downloads</span>
        </div>
      </div>
      {/* Import Status */}
      {importStatus.text && (
        <div className="absolute bottom-[61px] left-1/2 transform -translate-x-1/2 w-[600px] bg-primary flex items-center justify-center p-2 z-[1500]">
          <div className="flex items-center w-[540px]">
            <span className="w-[300px] text-[10px] text-text">{importStatus.text}</span>
            <div className="relative w-[300px]">
              <div className="h-[15px] bg-gray-700 rounded overflow-hidden">
                <div
                  className="h-full bg-accent"
                  style={{ width: `${(importStatus.progress / importStatus.total) * 100}%` }}
                ></div>
              </div>
              <span className="absolute inset-0 flex items-center justify-center text-[10px] text-text">
                File {importStatus.progress}/{importStatus.total}
              </span>
            </div>
          </div>
          {/* Left Corner Polygon */}
          <div className="absolute left-[200px] bottom-0 w-[20px] h-[20px] bg-accent" style={{ clipPath: 'polygon(0% 100%, 100% 0%, 100% 100%)' }}></div>
          {/* Right Corner Polygon */}
          <div className="absolute right-[200px] bottom-0 w-[20px] h-[20px] bg-accent" style={{ clipPath: 'polygon(0% 0%, 100% 100%, 0% 100%)' }}></div>
        </div>
      )}
      {/* Updater Section (Hidden by Default) */}
      <div className="hidden bg-canvas h-full w-full" id="updater">
        <div className="h-[200px] bg-tertiary"></div>
        <div className="flex-1 bg-primary border-t border-accent"></div>
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById('root'));
root.render(<App />);