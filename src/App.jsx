const { useState, useEffect } = window.React;
const { createRoot } = window.ReactDOM;

const App = () => {
  const [games, setGames] = useState([]);
  const [selectedGame, setSelectedGame] = useState(null);
  const [filter, setFilter] = useState('');
  const [version] = useState('0.0.0');
  const [importStatus, setImportStatus] = useState({ text: '', progress: 0, total: 0 });

  useEffect(() => {
    window.electronAPI.getGames().then((games) => {
      console.log('Games fetched:', games);
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
  }, []);

  useEffect(() => {
    // Debug filteredGames
    console.log('Filtered games:', filteredGames.map(g => ({
      record_id: g.record_id,
      title: g.title,
      banner_url: g.banner_url
    })));
  }, [games, filter]);

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
      const result = await window.electronAPI.unzipGame(zipPath, extractPath);
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
    game.banner_url && // Only include games with a banner_url
    (game.title.toLowerCase().includes(filter.toLowerCase()) ||
    (game.tags && game.tags.toLowerCase().includes(filter.toLowerCase())))
  );

  return (
    <div className="flex flex-col h-screen" style={{ backgroundColor: '#000000', color: '#d2d2d2' }}>
      <div className="flex bg-[var(--primary)] h-[70px] items-center justify-between px-4 z-50 fixed w-full top-0" style={{ backgroundColor: '#19191c' }}>
        <div className="flex items-center">
          <img src="./assets/images/atlas_logo.svg" alt="Atlas Logo" className="w-10 h-10" />
          <div className="flex ml-10">
            <label className="flex items-center mr-4">
              <input type="radio" name="nav" defaultChecked className="mr-2" />
              Games
            </label>
          </div>
        </div>
        <div className="flex items-center">
          <div className="flex bg-[var(--secondary)] h-10 w-[400px] items-center rounded" style={{ backgroundColor: '#242629' }}>
            <i className="fas fa-search mx-2 text-[var(--text)]" style={{ color: '#d2d2d2' }}></i>
            <input
              type="text"
              placeholder="Search Atlas"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="bg-transparent text-[var(--text)] w-[325px] outline-none"
              style={{ color: '#d2d2d2' }}
            />
            <button
              onClick={() => setFilter('')}
              className="w-10 h-10 flex items-center justify-center"
            >
              <i className="fas fa-times text-[var(--text)]" style={{ color: '#d2d2d2' }}></i>
            </button>
          </div>
        </div>
        <div className="flex items-center">
          <span className="mr-2" style={{ color: '#d2d2d2' }}>Version: {version} α</span>
          <button
            onClick={() => window.electronAPI.minimizeWindow()}
            className="w-8 h-8 flex items-center justify-center bg-transparent"
          >
            <i className="fas fa-minus text-[var(--text)]" style={{ color: '#d2d2d2' }}></i>
          </button>
          <button
            onClick={() => window.electronAPI.maximizeWindow()}
            className="w-8 h-8 flex items-center justify-center bg-transparent"
          >
            <i className="fas fa-window-maximize text-[var(--text)]" style={{ color: '#d2d2d2' }}></i>
          </button>
          <button
            onClick={() => window.electronAPI.closeWindow()}
            className="w-8 h-8 flex items-center justify-center bg-transparent"
          >
            <i className="fas fa-times text-[var(--text)]" style={{ color: '#d2d2d2' }}></i>
          </button>
        </div>
      </div>
      <div className="flex flex-1 bg-[var(--tertiary)]" style={{ backgroundColor: '#313338' }}>
        <window.Sidebar className="fixed w-[60px] mt-[70px] h-[calc(100%-110px)] z-50" />
        <div className="flex flex-1">
          <div className="w-[200px] bg-[var(--secondary)] fixed mt-[70px] h-[calc(100%-110px)] z-40 overflow-y-auto" style={{ backgroundColor: '#242629' }}>
            {filteredGames.length === 0 ? (
              <div className="p-2 text-center text-[var(--text)]" style={{ color: '#d2d2d2' }}>No games found</div>
            ) : (
              filteredGames.map((game) => (
                <div
                  key={game.record_id}
                  className="p-2 cursor-pointer hover:bg-[var(--selected)]"
                  style={{ color: '#d2d2d2' }}
                  onClick={() => setSelectedGame(game)}
                >
                  {game.title}
                </div>
              ))
            )}
          </div>
          <div className="flex-1 bg-[var(--tertiary)] p-4 ml-[200px] mt-[70px] overflow-y-auto h-[calc(100%-110px)]" style={{ backgroundColor: '#313338' }}>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(537px,1fr))] gap-4 mb-4">
              {filteredGames.length === 0 ? (
                <div className="text-center text-[var(--text)] col-span-full" style={{ color: '#d2d2d2' }}>No games available</div>
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
      <div className="bg-[var(--primary)] h-[40px] flex items-center justify-between px-4 fixed bottom-0 w-full border-t border-[var(--border)] z-50" style={{ backgroundColor: '#19191c', borderColor: '#51535A' }}>
        <button
          onClick={addGame}
          className="flex items-center bg-transparent text-[var(--text)] hover:text-[var(--highlight)]"
          style={{ color: '#d2d2d2' }}
        >
          <i className="fas fa-plus mr-2 text-[var(--text)]" style={{ color: '#d2d2d2' }}></i>
          Add Game
        </button>
        <div className="flex items-center">
          <i className="fas fa-gamepad mr-2 text-[var(--text)]" style={{ color: '#d2d2d2' }}></i>
          <span style={{ color: '#d2d2d2' }}>{`${games.length} Games Installed, ${games.length} Total Versions`}</span>
        </div>
        <div className="flex items-center">
          <i className="fas fa-download mr-2 text-[var(--text)]" style={{ color: '#d2d2d2' }}></i>
          <span onClick={unzipGame} style={{ color: '#d2d2d2' }}>Downloads</span>
        </div>
      </div>
      {importStatus.text && (
        <div className="absolute bottom-10 left-1/2 transform -translate-x-1/2 w-[600px] bg-[var(--primary)] flex items-center justify-center p-2 z-50" style={{ backgroundColor: '#19191c' }}>
          <span className="w-[300px] text-[10px]" style={{ color: '#d2d2d2' }}>{importStatus.text}</span>
          <div className="relative w-[300px]">
            <div className="h-[15px] bg-gray-700 rounded overflow-hidden">
              <div
                className="h-full bg-[var(--accent)]"
                style={{ backgroundColor: '#2C8EA9', width: `${(importStatus.progress / importStatus.total) * 100}%` }}
              ></div>
            </div>
            <span className="absolute inset-0 flex items-center justify-center text-[10px]" style={{ color: '#d2d2d2' }}>
              File {importStatus.progress}/{importStatus.total}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

const root = createRoot(document.getElementById('root'));
root.render(<App />);