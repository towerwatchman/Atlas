const { useState, useEffect, useRef } = window.React;
const { createRoot } = window.ReactDOM;
const { VariableSizeGrid } = window.ReactWindow;

const App = () => {
  const [games, setGames] = useState([]);
  const [selectedGame, setSelectedGame] = useState(null);
  const [filter, setFilter] = useState('');
  const [version, setVersion] = useState('0.0.0');
  const [importStatus, setImportStatus] = useState({ text: '', progress: 0, total: 0 });
  const [dbUpdateStatus, setDbUpdateStatus] = useState({ text: '', progress: 0, total: 0 });
  const [importProgress, setImportProgress] = useState({ text: '', progress: 0, total: 0 });
  const [isMaximized, setIsMaximized] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [columnCount, setColumnCount] = useState(1); // Dynamic column count
  const gridRef = useRef(null);

  useEffect(() => {
    // Fetch all games
    window.electronAPI.getGames().then((allGames) => {
      setGames(Array.isArray(allGames) ? allGames : []);
    }).catch((error) => {
      console.error('Failed to fetch games:', error);
      setGames([]);
    });

    // Existing listeners
    window.electronAPI.checkUpdates().then(({ latestVersion, currentVersion }) => {
      if (latestVersion !== currentVersion) {
        alert(`New version ${latestVersion} available!`);
      }
    }).catch((error) => {
      console.error('Failed to check updates:', error);
    });

    window.electronAPI.getVersion().then((v) => setVersion(v));

    window.electronAPI.checkDbUpdates().then((result) => {
      if (!result.success) {
        setDbUpdateStatus({ text: `Error: ${result.error}`, progress: 0, total: 100 });
        setTimeout(() => setDbUpdateStatus({ text: '', progress: 0, total: 0 }), 2000);
      } else if (result.total === 0) {
        setDbUpdateStatus({ text: result.message, progress: 0, total: 0 });
        setTimeout(() => setDbUpdateStatus({ text: '', progress: 0, total: 0 }), 2000);
      }
    }).catch((error) => {
      console.error('Failed to check database updates:', error);
      setDbUpdateStatus({ text: `Error: ${error.message}`, progress: 0, total: 100 });
      setTimeout(() => setDbUpdateStatus({ text: '', progress: 0, total: 0 }), 2000);
    });

    window.electronAPI.onWindowStateChanged((state) => {
      setIsMaximized(state === 'maximized');
    });

    window.electronAPI.onDbUpdateProgress((progress) => {
      setDbUpdateStatus(progress);
      if (progress.progress >= progress.total && progress.total > 0) {
        setTimeout(() => setDbUpdateStatus({ text: '', progress: 0, total: 0 }), 2000);
      }
    });

    window.electronAPI.onImportProgress((progress) => {
      setImportProgress(progress);
      if (progress.progress >= progress.total && progress.total > 0 && progress.text.includes('Import complete')) {
        setTimeout(() => setImportProgress({ text: '', progress: 0, total: 0 }), 2000);
      }
    });

    window.electronAPI.onGameImported(() => {
      window.electronAPI.getGames().then((games) => {
        setGames(Array.isArray(games) ? games : []);
      }).catch((error) => {
        console.error('Failed to refresh games:', error);
      });
    });

    window.electronAPI.onUpdateStatus((status) => {
      console.log('Update status:', status);
      if (status.status === 'available') {
        alert(`New app version ${status.version} is available and will be downloaded.`);
      } else if (status.status === 'downloading') {
        setDbUpdateStatus({ text: `Downloading update: ${status.percent.toFixed(0)}%`, progress: status.percent, total: 100 });
      } else if (status.status === 'downloaded') {
        alert(`Update ${status.version} downloaded. Restarting app to install.`);
      } else if (status.status === 'error') {
        alert(`Update error: ${status.error}`);
      }
    });

    // Handle window resize to update column count
    const handleResize = () => {
      setColumnCount(getColumnCount());
      if (gridRef.current) {
        gridRef.current.resetAfterColumnIndex(0); // Recompute layout
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize(); // Initial calculation

    return () => {
      window.electronAPI.removeUpdateStatusListener?.();
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const addGame = async () => {
    window.electronAPI.openImporter();
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
        progress: result.success ? 100 : 50,
        total: 100
      });
      setTimeout(() => setImportStatus({ text: '', progress: 0, total: 0 }), 2000);
    } catch (error) {
      console.error('Failed to unzip game:', error);
      setImportStatus({ text: `Error: ${error.message}`, progress: 50, total: 100 });
      setTimeout(() => setImportStatus({ text: '', progress: 0, total: 0 }), 2000);
    }
  };

  const filteredGames = games.filter((game) =>
    game.title.toLowerCase().includes(filter.toLowerCase()) ||
    game.creator.toLowerCase().includes(filter.toLowerCase())
  );

  // Calculate column count dynamically based on container width
const getColumnCount = () => {
    const minBannerWidth = 537; // From grid-cols-[repeat(auto-fill,minmax(537px,1fr))]
    const gap = 16; // Gap between banners
    const gameGrid = document.getElementById('gameGrid');
    const containerWidth = gameGrid ? gameGrid.clientWidth : window.innerWidth - 300; // Fallback to previous calculation
    return Math.max(1, Math.floor(containerWidth / (minBannerWidth + gap)));
  };

  // Assume fixed height for GameBanner
  const getRowHeight = () => 251 + 16; // Banner height (251px) + gap (16px)

return (
    <div className="flex flex-col h-screen font-sans text-[13px]">
      <div className="flex h-[70px] items-center z-50 fixed w-full top-0 select-none -webkit-app-region-drag">
        <div className="w-[60px] bg-accent flex items-center justify-center h-[70px] z-50">
          <svg
            className="w-[50px] h-[50px] text-atlasLogo"
            viewBox="0 0 24 24"
            style={{ shapeRendering: 'geometricPrecision' }}
            fill="currentColor"
            dangerouslySetInnerHTML={{ __html: window.atlasLogo.path }}
          />
        </div>
        <div className="flex-1 h-[70px] bg-primary relative -webkit-app-region-drag shadow-[0_4px_8px_rgba(0,0,0,0.5)]">
          <div className="absolute top-0 left-[50px] right-[110px] h-[10px] bg-accentBar"></div>
          <div className="absolute top-0 left-[40px] w-[10px] h-[10px] bg-accentBar" style={{ clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%)' }}></div>
          <div className="absolute top-0 right-[100px] w-[10px] h-[10px] bg-accentBar" style={{ clipPath: 'polygon(0% 0%, 100% 0%, 0% 100%)' }}></div>
          <div className="w-full flex h-[70px]">
            <div className="flex items-center ml-5 mt-3">
              <div className="text-accent font-semibold cursor-pointer -webkit-app-region-no-drag">Games</div>
            </div>
            <div className="flex justify-center w-full">
              <div className="flex bg-secondary h-10 w-[400px] items-center rounded mt-[20px] -webkit-app-region-no-drag border border-border hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent relative">
                <i className="fas fa-search w-6 h-6 text-text pl-2 flex items-center justify-center"></i>
                <input
                  type="text"
                  placeholder="Search Atlas"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="bg-transparent outline-none text-text flex-1 px-2 focus:outline-none"
                />
                <button
                  onClick={() => setIsMenuOpen(!isMenuOpen)}
                  className="w-10 h-10 flex items-center justify-center text-text hover:text-highlight focus:outline-none"
                >
                  <i className="fas fa-sliders"></i>
                </button>
                {isMenuOpen && (
                  <div className="absolute top-full left-0 mt-2 w-[400px] bg-secondary border border-border rounded shadow-lg z-50">
                    <div className="p-2 grid grid-cols-2 gap-2">
                      <div>
                        <div className="mb-2">
                          <h3 className="text-xs text-text font-bold">PLAYERS</h3>
                          <div className="flex flex-col gap-1 text-[11px] text-text">
                            <label className="flex items-center space-x-2">
                              <input type="checkbox" className="form-checkbox h-4 w-4 bg-tertiary hover:outline hover:outline-1 hover:outline-accent checked:bg-tertiary checked:border-accent" style={{ outlineColor: '#2C8EA9', accentColor: '#2C8EA9' }} /> <span>Single player</span>
                            </label>
                            <label className="flex items-center space-x-2">
                              <input type="checkbox" className="form-checkbox h-4 w-4 bg-tertiary hover:outline hover:outline-1 hover:outline-accent checked:bg-tertiary checked:border-accent" style={{ outlineColor: '#2C8EA9', accentColor: '#2C8EA9' }} /> <span>Multiplayer</span>
                            </label>
                            <label className="flex items-center space-x-2">
                              <input type="checkbox" className="form-checkbox h-4 w-4 bg-tertiary hover:outline hover:outline-1 hover:outline-accent checked:bg-tertiary checked:border-accent" style={{ outlineColor: '#2C8EA9', accentColor: '#2C8EA9' }} /> <span>Cooperative</span>
                            </label>
                          </div>
                        </div>
                      </div>
                      <div>
                        <div className="mb-2">
                          <h3 className="text-xs text-text font-bold">PLAY STATE</h3>
                          <div className="flex flex-col gap-1 text-[11px] text-text">
                            <label className="flex items-center space-x-2">
                              <input type="checkbox" className="form-checkbox h-4 w-4 bg-tertiary hover:outline hover:outline-1 hover:outline-accent checked:bg-tertiary checked:border-accent" style={{ outlineColor: '#2C8EA9', accentColor: '#2C8EA9' }} /> <span>Ready to play</span>
                            </label>
                            <label className="flex items-center space-x-2">
                              <input type="checkbox" className="form-checkbox h-4 w-4 bg-tertiary hover:outline hover:outline-1 hover:outline-accent checked:bg-tertiary checked:border-accent" style={{ outlineColor: '#2C8EA9', accentColor: '#2C8EA9' }} /> <span>Installed locally</span>
                            </label>
                            <label className="flex items-center space-x-2">
                              <input type="checkbox" className="form-checkbox h-4 w-4 bg-tertiary hover:outline hover:outline-1 hover:outline-accent checked:bg-tertiary checked:border-accent" style={{ outlineColor: '#2C8EA9', accentColor: '#2C8EA9' }} /> <span>Played</span>
                            </label>
                            <label className="flex items-center space-x-2">
                              <input type="checkbox" className="form-checkbox h-4 w-4 bg-tertiary hover:outline hover:outline-1 hover:outline-accent checked:bg-tertiary checked:border-accent" style={{ outlineColor: '#2C8EA9', accentColor: '#2C8EA9' }} /> <span>Unplayed</span>
                            </label>
                            <label className="flex items-center space-x-2">
                              <input type="checkbox" className="form-checkbox h-4 w-4 bg-tertiary hover:outline hover:outline-1 hover:outline-accent checked:bg-tertiary checked:border-accent" style={{ outlineColor: '#2C8EA9', accentColor: '#2C8EA9' }} /> <span>Private</span>
                            </label>
                          </div>
                        </div>
                      </div>
                      <div>
                        <div className="mb-2">
                          <h3 className="text-xs text-text font-bold">GENRE</h3>
                          <div className="flex flex-col gap-1 text-[11px] text-text">
                            <label className="flex items-center space-x-2">
                              <input type="checkbox" className="form-checkbox h-4 w-4 bg-tertiary hover:outline hover:outline-1 hover:outline-accent checked:bg-tertiary checked:border-accent" style={{ outlineColor: '#2C8EA9', accentColor: '#2C8EA9' }} /> <span>Action</span>
                            </label>
                            <label className="flex items-center space-x-2">
                              <input type="checkbox" className="form-checkbox h-4 w-4 bg-tertiary hover:outline hover:outline-1 hover:outline-accent checked:bg-tertiary checked:border-accent" style={{ outlineColor: '#2C8EA9', accentColor: '#2C8EA9' }} /> <span>Adventure</span>
                            </label>
                            <label className="flex items-center space-x-2">
                              <input type="checkbox" className="form-checkbox h-4 w-4 bg-tertiary hover:outline hover:outline-1 hover:outline-accent checked:bg-tertiary checked:border-accent" style={{ outlineColor: '#2C8EA9', accentColor: '#2C8EA9' }} /> <span>Casual</span>
                            </label>
                            <label className="flex items-center space-x-2">
                              <input type="checkbox" className="form-checkbox h-4 w-4 bg-tertiary hover:outline hover:outline-1 hover:outline-accent checked:bg-tertiary checked:border-accent" style={{ outlineColor: '#2C8EA9', accentColor: '#2C8EA9' }} /> <span>Indie</span>
                            </label>
                            <label className="flex items-center space-x-2">
                              <input type="checkbox" className="form-checkbox h-4 w-4 bg-tertiary hover:outline hover:outline-1 hover:outline-accent checked:bg-tertiary checked:border-accent" style={{ outlineColor: '#2C8EA9', accentColor: '#2C8EA9' }} /> <span>Massively Multiplayer</span>
                            </label>
                            <label className="flex items-center space-x-2">
                              <input type="checkbox" className="form-checkbox h-4 w-4 bg-tertiary hover:outline hover:outline-1 hover:outline-accent checked:bg-tertiary checked:border-accent" style={{ outlineColor: '#2C8EA9', accentColor: '#2C8EA9' }} /> <span>Racing</span>
                            </label>
                            <label className="flex items-center space-x-2">
                              <input type="checkbox" className="form-checkbox h-4 w-4 bg-tertiary hover:outline hover:outline-1 hover:outline-accent checked:bg-tertiary checked:border-accent" style={{ outlineColor: '#2C8EA9', accentColor: '#2C8EA9' }} /> <span>RPG</span>
                            </label>
                            <label className="flex items-center space-x-2">
                              <input type="checkbox" className="form-checkbox h-4 w-4 bg-tertiary hover:outline hover:outline-1 hover:outline-accent checked:bg-tertiary checked:border-accent" style={{ outlineColor: '#2C8EA9', accentColor: '#2C8EA9' }} /> <span>Simulation</span>
                            </label>
                            <label className="flex items-center space-x-2">
                              <input type="checkbox" className="form-checkbox h-4 w-4 bg-tertiary hover:outline hover:outline-1 hover:outline-accent checked:bg-tertiary checked:border-accent" style={{ outlineColor: '#2C8EA9', accentColor: '#2C8EA9' }} /> <span>Sports</span>
                            </label>
                            <label className="flex items-center space-x-2">
                              <input type="checkbox" className="form-checkbox h-4 w-4 bg-tertiary hover:outline hover:outline-1 hover:outline-accent checked:bg-tertiary checked:border-accent" style={{ outlineColor: '#2C8EA9', accentColor: '#2C8EA9' }} /> <span>Strategy</span>
                            </label>
                          </div>
                        </div>
                      </div>
                      <div>
                        <div className="mb-2">
                          <h3 className="text-xs text-text font-bold">HARDWARE SUPPORT</h3>
                          <div className="flex flex-col gap-1 text-[11px] text-text">
                            <label className="flex items-center space-x-2">
                              <input type="checkbox" className="form-checkbox h-4 w-4 bg-tertiary hover:outline hover:outline-1 hover:outline-accent checked:bg-tertiary checked:border-accent" style={{ outlineColor: '#2C8EA9', accentColor: '#2C8EA9' }} /> <span>Controller Preferred</span>
                            </label>
                            <label className="flex items-center space-x-2">
                              <input type="checkbox" className="form-checkbox h-4 w-4 bg-tertiary hover:outline hover:outline-1 hover:outline-accent checked:bg-tertiary checked:border-accent" style={{ outlineColor: '#2C8EA9', accentColor: '#2C8EA9' }} /> <span>Full Controller Support</span>
                            </label>
                            <label className="flex items-center space-x-2">
                              <input type="checkbox" className="form-checkbox h-4 w-4 bg-tertiary hover:outline hover:outline-1 hover:outline-accent checked:bg-tertiary checked:border-accent" style={{ outlineColor: '#2C8EA9', accentColor: '#2C8EA9' }} /> <span>VR</span>
                            </label>
                            <label className="flex items-center space-x-2">
                              <input type="checkbox" className="form-checkbox h-4 w-4 bg-tertiary hover:outline hover:outline-1 hover:outline-accent checked:bg-tertiary checked:border-accent" style={{ outlineColor: '#2C8EA9', accentColor: '#2C8EA9' }} /> <span>Gamepads</span>
                            </label>
                            <label className="flex items-center space-x-2">
                              <input type="checkbox" className="form-checkbox h-4 w-4 bg-tertiary hover:outline hover:outline-1 hover:outline-accent checked:bg-tertiary checked:border-accent" style={{ outlineColor: '#2C8EA9', accentColor: '#2C8EA9' }} /> <span>Steam Deck</span>
                            </label>
                          </div>
                        </div>
                      </div>
                      <div>
                        <div className="mb-2">
                          <h3 className="text-xs text-text font-bold">FEATURES</h3>
                          <div className="flex flex-col gap-1 text-[11px] text-text">
                            <label className="flex items-center space-x-2">
                              <input type="checkbox" className="form-checkbox h-4 w-4 bg-tertiary hover:outline hover:outline-1 hover:outline-accent checked:bg-tertiary checked:border-accent" style={{ outlineColor: '#2C8EA9', accentColor: '#2C8EA9' }} /> <span>Trading cards</span>
                            </label>
                            <label className="flex items-center space-x-2">
                              <input type="checkbox" className="form-checkbox h-4 w-4 bg-tertiary hover:outline hover:outline-1 hover:outline-accent checked:bg-tertiary checked:border-accent" style={{ outlineColor: '#2C8EA9', accentColor: '#2C8EA9' }} /> <span>Workshop</span>
                            </label>
                            <label className="flex items-center space-x-2">
                              <input type="checkbox" className="form-checkbox h-4 w-4 bg-tertiary hover:outline hover:outline-1 hover:outline-accent checked:bg-tertiary checked:border-accent" style={{ outlineColor: '#2C8EA9', accentColor: '#2C8EA9' }} /> <span>Achievements</span>
                            </label>
                            <label className="flex items-center space-x-2">
                              <input type="checkbox" className="form-checkbox h-4 w-4 bg-tertiary hover:outline hover:outline-1 hover:outline-accent checked:bg-tertiary checked:border-accent" style={{ outlineColor: '#2C8EA9', accentColor: '#2C8EA9' }} /> <span>Remote Play Together</span>
                            </label>
                            <label className="flex items-center space-x-2">
                              <input type="checkbox" className="form-checkbox h-4 w-4 bg-tertiary hover:outline hover:outline-1 hover:outline-accent checked:bg-tertiary checked:border-accent" style={{ outlineColor: '#2C8EA9', accentColor: '#2C8EA9' }} /> <span>Family Sharing</span>
                            </label>
                          </div>
                        </div>
                      </div>
                      <div className="col-span-2">
                        <div className="mb-2">
                          <h3 className="text-xs text-text font-bold">STORE TAGS</h3>
                          <div className="flex flex-col text-[11px] text-text">
                            <input
                              type="text"
                              placeholder="enter a tag"
                              className="w-full p-1 bg-transparent border border-border rounded text-[11px] text-text mb-2"
                            />
                          </div>
                        </div>
                        <div>
                          <h3 className="text-xs text-text font-bold">FRIENDS</h3>
                          <div className="flex flex-col text-[11px] text-text">
                            <input
                              type="text"
                              placeholder="enter a friend's name"
                              className="w-full p-1 bg-transparent border border-border rounded text-[11px] text-text"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="flex absolute top-1 right-2 h-[70px] -webkit-app-region-no-drag">
            <button
              onClick={() => window.electronAPI.minimizeWindow()}
              className="w-7 h-7 flex items-center justify-center bg-transparent hover:bg-tertiary transition-colors duration-200"
            >
              <i className="fas fa-minus text-text fa-sm"></i>
            </button>
            <button
              onClick={() => window.electronAPI.maximizeWindow()}
              className="w-7 h-7 flex items-center justify-center bg-transparent hover:bg-tertiary transition-colors duration-200"
            >
              <i className={isMaximized ? "fas fa-window-restore text-text fa-sm" : "fas fa-window-maximize text-text fa-sm"}></i>
            </button>
            <button
              onClick={() => window.electronAPI.closeWindow()}
              className="w-7 h-7 flex items-center justify-center bg-transparent hover:bg-[DarkRed] transition-colors duration-200"
            >
              <i className="fas fa-times text-text fa-sm"></i>
            </button>
          </div>
          <div className="absolute mt-10 top-0 right-0 flex h-[10px]">
            <span className="text-text text-xs mr-4">Version: {version} <span style={{ color: 'Goldenrod' }}>α</span></span>
          </div>
        </div>
      </div>
      <div className="flex flex-1 bg-tertiary fixed w-full top-[70px] bottom-[40px]">
        <window.Sidebar className="fixed w-[60px] h-full z-50" />
        <div className="flex flex-1 bg-tertiary">
          <div className="w-[200px] bg-secondary fixed h-full z-40 overflow-y-auto">
            {filteredGames.length === 0 ? (
              <div className="p-2 text-center text-text">No games found</div>
            ) : (
              filteredGames.map((game) => (
                <div
                  key={game.record_id}
                  className={`p-2 cursor-pointer hover:bg-selected ${selectedGame?.record_id === game.record_id ? 'bg-selected' : ''}`}
                  onClick={() => setSelectedGame(game)}
                >
                  {game.title}
                </div>
              ))
            )}
          </div>
          <div id="gameGrid" className="flex-1 bg-tertiary ml-[200px] overflow-y-auto">
            {filteredGames.length === 0 ? (
              <div className="text-center text-text">No games available</div>
            ) : (
              <div className="flex justify-center">
                <VariableSizeGrid
                  ref={gridRef}
                  columnCount={columnCount}
                  columnWidth={(index) => {
                    const gameGrid = document.getElementById('gameGrid');
                    const containerWidth = gameGrid ? gameGrid.clientWidth : window.innerWidth - 260;
                    const columnWidth = 537 + 16; // Banner width + gap
                    const totalColumnsWidth = columnCount * columnWidth;
                    if (totalColumnsWidth < containerWidth) {
                      // Distribute extra space evenly across columns
                      const extraWidth = (containerWidth - totalColumnsWidth) / columnCount;
                      return 537 + 16 + extraWidth;
                    }
                    return columnWidth;
                  }}
                  rowCount={Math.ceil(filteredGames.length / columnCount)}
                  rowHeight={getRowHeight}
                  height={window.innerHeight - 70 - 40} // Screen height - header (70px) - footer (40px)
                  width={gameGrid ? gameGrid.clientWidth : window.innerWidth - 260} // Match #gameGrid width
                  onScroll={() => {}}
                >
                  {({ columnIndex, rowIndex, style }) => {
                    const index = rowIndex * columnCount + columnIndex;
                    if (index >= filteredGames.length) return null;
                    const game = filteredGames[index];
                    return (
                      <div style={{ ...style, display: 'flex', justifyContent: 'center', padding: '8px' }}>
                        <window.GameBanner key={game.record_id} game={game} onSelect={() => setSelectedGame(game)} />
                      </div>
                    );
                  }}
                </VariableSizeGrid>
              </div>
            )}
            {selectedGame && (
              <window.GameDetails game={selectedGame} onRemove={() => removeGame(selectedGame.record_id)} />
            )}
          </div>
        </div>
      </div>
      {dbUpdateStatus.text && (
        <div className="absolute bottom-[44px] left-1/2 transform -translate-x-1/2 w-[600px] bg-primary flex items-center justify-center p-2 z-[1500] border border-border opacity-95">
          <div className="flex items-center w-[540px]">
            <span className="w-[300px] text-[10px] text-text">{dbUpdateStatus.text}</span>
            <div className="relative w-[300px]">
              <div className="h-[15px] bg-gray-700 rounded overflow-hidden">
                <div
                  className="h-full bg-accent"
                  style={{ width: `${(dbUpdateStatus.progress / (dbUpdateStatus.total || 1)) * 100}%` }}
                ></div>
              </div>
              <span className="absolute inset-0 flex items-center justify-center text-[10px] text-text">
                Update {dbUpdateStatus.progress}/{dbUpdateStatus.total}
              </span>
            </div>
          </div>
        </div>
      )}
      {importStatus.text && (
        <div className="absolute bottom-[60px] left-1/2 transform -translate-x-1/2 w-[600px] bg-primary flex items-center justify-center p-2 z-[1500]">
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
          <div className="absolute left-[200px] bottom-0 w-[20px] h-[20px] bg-accent" style={{ clipPath: 'polygon(0% 100%, 100% 0%, 100% 100%)' }}></div>
          <div className="absolute right-[200px] bottom-0 w-[20px] h-[20px] bg-accent" style={{ clipPath: 'polygon(0% 0%, 100% 100%, 0% 100%)' }}></div>
        </div>
      )}
      {importProgress.text && (
        <div className="absolute bottom-[60px] left-1/2 transform -translate-x-1/2 w-[800px] bg-primary flex items-center justify-center p-2 z-[1500] border border-border opacity-95">
          <div className="flex items-center w-[800px]">
            <span className="w-[450px] text-[10px] text-text">{importProgress.text}</span>
            <div className="relative w-[300px]">
              <div className="h-[15px] bg-gray-700 rounded overflow-hidden">
                <div
                  className="h-full bg-accent"
                  style={{ width: `${(importProgress.progress / (importProgress.total || 1)) * 100}%` }}
                ></div>
              </div>
              <span className="absolute inset-0 flex items-center justify-center text-[10px] text-text">
                Game {importProgress.progress}/{importProgress.total}
              </span>
            </div>
          </div>
        </div>
      )}
      <div className="bg-primary h-[40px] flex items-center justify-between px-4 fixed bottom-0 w-full border-t border-accent z-50">
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
      <div className="hidden bg-canvas h-full w-full" id="updater">
        <div className="h-[200px] bg-tertiary"></div>
        <div className="flex-1 bg-primary border-t border-accent"></div>
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById('root'));
root.render(<App />);