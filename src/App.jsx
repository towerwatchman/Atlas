const { useState, useEffect, useRef, useCallback, useMemo } = window.React;
const { createRoot } = window.ReactDOM;
const { AutoSizer, Grid } = window.ReactVirtualized;

const App = () => {
  const [games, setGames] = useState([]);
  const [selectedGame, setSelectedGame] = useState(null);
  const [version, setVersion] = useState("0.0.0");
  const [importStatus, setImportStatus] = useState({
    text: "",
    progress: 0,
    total: 0,
  });
  const [dbUpdateStatus, setDbUpdateStatus] = useState({
    text: "",
    progress: 0,
    total: 0,
  });
  const [importProgress, setImportProgress] = useState({
    text: "",
    progress: 0,
    total: 0,
  });
  const [isMaximized, setIsMaximized] = useState(false);
  const [bannerSize, setBannerSize] = useState({
    bannerWidth: 537,
    bannerHeight: 251,
  });
  const [columnCount, setColumnCount] = useState(1);
  const [totalVersions, setTotalVersions] = useState(0);
  const [showGameList, setShowGameList] = useState(true);
  const gridRef = useRef(null);
  const gameGridRef = useRef(null);

  const [showSearchSidebar, setShowSearchSidebar] = useState(false); // or false

  const [activeFilters, setActiveFilters] = useState({
    text: "",
    type: "title",
    category: [],
    engine: [],
    status: [],
    censored: [],
    language: [],
    tags: [],
    sort: "name", // ← Changed from "date" to "name"
    dateLimit: 0,
    tagLogic: "AND",
    updateAvailable: false, // if you added this
  });

  // Debounce function for game refresh
  const debounce = (func, delay) => {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), delay);
    };
  };

  const toggleSearchSidebar = () => {
    setShowSearchSidebar((prev) => !prev);
  };

  const handleFilterChange = (filters) => {
    setActiveFilters(filters);
  };

  const toggleGameList = () => {
    const newVisible = !showGameList;
    setShowGameList(newVisible);

    window.electronAPI
      .getConfig()
      .then((config) => {
        const newConfig = {
          ...config,
          Interface: {
            ...config.Interface,
            showGameList: newVisible,
          },
        };
        window.electronAPI.saveSettings(newConfig);
      })
      .catch((err) =>
        console.error("Failed to save game list visibility:", err),
      );
  };
  // Debounced refresh for game updates
  const refreshGame = useCallback(
    debounce((recordId) => {
      console.log(`refreshGame called for recordId: ${recordId}`);
      window.electronAPI
        .getGame(recordId)
        .then((updatedGame) => {
          if (updatedGame) {
            console.log(`Updated game data for recordId ${recordId}:`, {
              record_id: updatedGame.record_id,
              title: updatedGame.title,
              banner_url: updatedGame.banner_url,
            });
            setGames((prev) => {
              const newGames = prev.map((g) =>
                g.record_id === updatedGame.record_id ? updatedGame : g,
              );
              setTotalVersions(
                newGames.reduce(
                  (sum, game) => sum + (game.versionCount || 0),
                  0,
                ),
              );
              return newGames;
            });
            // Force grid re-render for the updated game
            if (gridRef.current) {
              console.log(`Forcing grid update for recordId: ${recordId}`);
              gridRef.current.forceUpdate();
            }
          } else {
            console.warn(`No game data returned for recordId: ${recordId}`);
          }
        })
        .catch((error) =>
          console.error(
            `Failed to update game for recordId ${recordId}:`,
            error,
          ),
        );
    }, 100),
    [],
  );

  // Handle resize with debounce for smoother updates
  const debounceResize = debounce(() => {
    const containerWidth =
      gameGridRef.current?.clientWidth || window.innerWidth - 260;
    const scrollbarWidth = getScrollbarWidth();
    const adjustedWidth = Math.max(0, containerWidth - scrollbarWidth);
    const newColumnCount = getColumnCount(adjustedWidth);
    setColumnCount(newColumnCount);
    if (gridRef.current) {
      gridRef.current.recomputeGridSize();
      gridRef.current.forceUpdate();
    }
  }, 16); // ~60fps for smoother resize

  useEffect(() => {
    // Get Config
    window.electronAPI
      .getConfig()
      .then((config) => {
        const interfaceSettings = config.Interface || {};
        setShowGameList(interfaceSettings.showGameList ?? true);
        // If you still have showSidebar from earlier attempts, you can keep it or remove
      })
      .catch((error) => {
        console.error("Failed to load config:", error);
        setShowGameList(true);
      });

    // Fetch games only once on mount
    window.electronAPI
      .getGames()
      .then((allGames) => {
        const gamesArray = Array.isArray(allGames) ? allGames : [];
        console.log(`Initial fetch: ${gamesArray.length} games loaded`);
        setGames(gamesArray);
        setTotalVersions(
          gamesArray.reduce((sum, game) => sum + (game.versionCount || 0), 0),
        );
      })
      .catch((error) => {
        console.error("Failed to fetch games:", error);
        setGames([]);
        setTotalVersions(0);
      });

    // Load banner size from template
    window.electronAPI
      .getTemplate?.()
      .then((template) => {
        if (template && template.bannerWidth && template.bannerHeight) {
          setBannerSize({
            bannerWidth: template.bannerWidth,
            bannerHeight: template.bannerHeight,
          });
        }
      })
      .catch((error) => {
        console.error("Failed to load template:", error);
      });

    // Check for updates
    window.electronAPI
      .checkUpdates()
      .then(({ latestVersion, currentVersion }) => {
        if (latestVersion !== currentVersion) {
          alert(`New version ${latestVersion} available!`);
        }
      })
      .catch((error) => {
        console.error("Failed to check updates:", error);
      });

    window.electronAPI.getVersion().then((v) => setVersion(v));

    window.electronAPI
      .checkDbUpdates()
      .then((result) => {
        if (!result.success) {
          setDbUpdateStatus({
            text: `Error: ${result.error}`,
            progress: 0,
            total: 100,
          });
          setTimeout(
            () => setDbUpdateStatus({ text: "", progress: 0, total: 0 }),
            2000,
          );
        } else if (result.total === 0) {
          setDbUpdateStatus({ text: result.message, progress: 0, total: 0 });
          setTimeout(
            () => setDbUpdateStatus({ text: "", progress: 0, total: 0 }),
            2000,
          );
        }
      })
      .catch((error) => {
        console.error("Failed to check database updates:", error);
        setDbUpdateStatus({
          text: `Error: ${error.message}`,
          progress: 0,
          total: 100,
        });
        setTimeout(
          () => setDbUpdateStatus({ text: "", progress: 0, total: 0 }),
          2000,
        );
      });

    // Set up IPC listeners
    const handleWindowStateChanged = (state) =>
      setIsMaximized(state === "maximized");
    const handleDbUpdateProgress = (progress) => {
      setDbUpdateStatus(progress);
      if (progress.progress >= progress.total && progress.total > 0) {
        setTimeout(
          () => setDbUpdateStatus({ text: "", progress: 0, total: 0 }),
          2000,
        );
      }
    };
    const handleImportProgress = (progress) => {
      setImportProgress(progress);
      if (
        progress.progress >= progress.total &&
        progress.total > 0 &&
        progress.text.includes("Import complete")
      ) {
        setTimeout(
          () => setImportProgress({ text: "", progress: 0, total: 0 }),
          2000,
        );
      }
    };
    const handleGameImported = (event, recordId) => {
      console.log(`Game imported: recordId ${recordId}`);
      window.electronAPI
        .getGame(recordId)
        .then((game) => {
          if (game) {
            setGames((prev) => {
              const newGames = [...prev, game].sort((a, b) =>
                a.title.localeCompare(b.title),
              );
              setTotalVersions(
                newGames.reduce(
                  (sum, game) => sum + (game.versionCount || 0),
                  0,
                ),
              );
              return newGames;
            });
          }
        })
        .catch((error) =>
          console.error(`Failed to get game for recordId ${recordId}:`, error),
        );
    };
    const handleGameUpdated = (event, recordId) => {
      console.log(`Game updated event received for recordId: ${recordId}`);
      refreshGame(recordId);
    };
    const handleImportComplete = () => {
      console.log("Import complete: fetching all games");
      window.electronAPI
        .getGames()
        .then((allGames) => {
          const gamesArray = Array.isArray(allGames) ? allGames : [];
          console.log(`Import complete: ${gamesArray.length} games loaded`);
          setGames(gamesArray);
          setTotalVersions(
            gamesArray.reduce((sum, game) => sum + (game.versionCount || 0), 0),
          );
        })
        .catch((error) => {
          console.error("Failed to fetch games on import complete:", error);
          setGames([]);
          setTotalVersions(0);
        });
      setTimeout(
        () => setImportProgress({ text: "", progress: 0, total: 0 }),
        2000,
      );
    };
    const handleUpdateStatus = (status) => {
      console.log("Update status:", status);
      if (status.status === "available") {
        alert(
          `New app version ${status.version} is available and will be downloaded.`,
        );
      } else if (status.status === "downloading") {
        setDbUpdateStatus({
          text: `Downloading update: ${status.percent.toFixed(0)}%`,
          progress: status.percent,
          total: 100,
        });
      } else if (status.status === "downloaded") {
        alert(
          `Update ${status.version} downloaded. Restarting app to install.`,
        );
      } else if (status.status === "error") {
        alert(`Update error: ${status.error}`);
      }
    };

    const handleGameDeleted = (recordId) => {
      console.log(`Game deleted event received for recordId: ${recordId}`);
      setGames((prev) => {
        const newGames = prev.filter((g) => g.record_id !== recordId);
        setTotalVersions(
          newGames.reduce((sum, game) => sum + (game.versionCount || 0), 0),
        );
        return newGames;
      });

      // Optional: if this was the selected game, clear it
      if (selectedGame?.record_id === recordId) {
        setSelectedGame(null);
      }

      // Force grid refresh
      if (gridRef.current) {
        gridRef.current.recomputeGridSize();
        gridRef.current.forceUpdate();
      }
    };

    window.electronAPI.onGameDeleted(handleGameDeleted);
    window.electronAPI.onWindowStateChanged(handleWindowStateChanged);
    window.electronAPI.onDbUpdateProgress(handleDbUpdateProgress);
    window.electronAPI.onImportProgress(handleImportProgress);
    window.electronAPI.onGameImported(handleGameImported);
    window.electronAPI.onGameUpdated(handleGameUpdated);
    window.electronAPI.onImportComplete(handleImportComplete);
    window.electronAPI.onUpdateStatus(handleUpdateStatus);

    //banner context menu
    window.electronAPI.onContextMenuCommand((event, data) => {
      if (data.action === "properties") {
        window.electronAPI
          .getGame(data.recordId)
          .then((updatedGame) => {
            setSelectedGame(updatedGame);
          })
          .catch((error) =>
            console.error("Failed to get game for properties:", error),
          );
      }
    });

    // Set up resize listener
    window.addEventListener("resize", debounceResize);
    debounceResize(); // Initial resize calculation

    // Cleanup
    return () => {
      window.electronAPI.removeUpdateStatusListener?.();
      window.removeEventListener("resize", debounceResize);
      window.electronAPI.onWindowStateChanged(() => {});
      window.electronAPI.onDbUpdateProgress(() => {});
      window.electronAPI.onImportProgress(() => {});
      window.electronAPI.onGameImported(() => {});
      window.electronAPI.onGameUpdated(() => {});
      window.electronAPI.onImportComplete(() => {});
      window.electronAPI.onUpdateStatus(() => {});
    };
  }, []);

  const addGame = async () => {
    window.electronAPI.openImporter();
  };

  const removeGame = async (id) => {
    try {
      await window.electronAPI.removeGame(id);
      setGames((prev) => {
        const newGames = prev.filter((g) => g.record_id !== id);
        setTotalVersions(
          newGames.reduce((sum, game) => sum + (game.versionCount || 0), 0),
        );
        return newGames;
      });
      if (selectedGame?.record_id === id) setSelectedGame(null);
    } catch (error) {
      console.error("Failed to remove game:", error);
    }
  };

  const filteredGames = useMemo(() => {
    let result = [...games];

    // Text search
    if (activeFilters.text) {
      const lower = activeFilters.text.toLowerCase();
      result = result.filter((game) =>
        activeFilters.type === "title"
          ? game.title.toLowerCase().includes(lower)
          : game.creator.toLowerCase().includes(lower),
      );
    }

    // Update Available
    if (activeFilters.updateAvailable) {
      result = result.filter((game) => game.isUpdateAvailable === true);
    }

    // Category (AND)
    if (activeFilters.category.length > 0) {
      result = result.filter((game) =>
        activeFilters.category.includes(game.category),
      );
    }

    // Engine
    if (activeFilters.engine.length > 0) {
      result = result.filter((game) =>
        activeFilters.engine.includes(game.engine),
      );
    }

    // Status
    if (activeFilters.status.length > 0) {
      result = result.filter((game) =>
        activeFilters.status.includes(game.status),
      );
    }

    // Censored
    if (activeFilters.censored.length > 0) {
      result = result.filter((game) =>
        activeFilters.censored.includes(game.censored),
      );
    }

    // Language (partial match)
    if (activeFilters.language.length > 0) {
      result = result.filter((game) => {
        const langs = (game.language || "").split(",").map((l) => l.trim());
        return activeFilters.language.some((l) => langs.includes(l));
      });
    }

    // Tags
    if (activeFilters.tags.length > 0) {
      result = result.filter((game) => {
        const gameTags = (game.f95_tags || "").split(",").map((t) => t.trim());
        if (activeFilters.tagLogic === "AND") {
          return activeFilters.tags.every((tag) => gameTags.includes(tag));
        } else {
          return activeFilters.tags.some((tag) => gameTags.includes(tag));
        }
      });
    }

    // Date limit (assuming release_date is epoch seconds)
    if (activeFilters.dateLimit > 0) {
      const cutoff = Date.now() / 1000 - activeFilters.dateLimit * 86400;
      result = result.filter((game) => (game.release_date || 0) >= cutoff);
    }

    // Sorting
    result.sort((a, b) => {
      if (activeFilters.sort === "date") {
        return (b.release_date || 0) - (a.release_date || 0);
      }
      // Default / explicit name sort
      return a.title.localeCompare(b.title);
    });

    return result;
  }, [games, activeFilters]);

  const getColumnCount = (width) => {
    const containerWidth =
      width || gameGridRef.current?.clientWidth || window.innerWidth - 260;
    const scrollbarWidth = getScrollbarWidth();
    const adjustedWidth = containerWidth - scrollbarWidth;
    return Math.max(
      1,
      Math.floor(adjustedWidth / (bannerSize.bannerWidth + 8)),
    );
  };

  const getScrollbarWidth = () => {
    if (gameGridRef.current) {
      return gameGridRef.current.offsetWidth - gameGridRef.current.clientWidth;
    }
    return 16;
  };

  const cellRenderer = ({ columnIndex, rowIndex, style }) => {
    const index = rowIndex * columnCount + columnIndex;
    if (index >= filteredGames.length) return null;
    const game = filteredGames[index];
    return (
      <div
        key={game.record_id}
        style={{
          ...style,
          display: "flex",
          justifyContent: "center",
          padding: "8px 4px",
          maxWidth: "100%",
        }}
      >
        <window.GameBanner game={game} onSelect={() => setSelectedGame(game)} />
      </div>
    );
  };

  return (
    <div className="flex flex-col h-screen font-sans text-[13px]">
      {/* Header */}
      <div className="flex h-[70px] items-center z-50 fixed w-full top-0 select-none -webkit-app-region-drag">
        <div className="w-[60px] bg-accent flex items-center justify-center h-[70px] z-50">
          <svg
            className="w-[50px] h-[50px] text-atlasLogo"
            viewBox="0 0 24 24"
            style={{ shapeRendering: "geometricPrecision" }}
            fill="currentColor"
            dangerouslySetInnerHTML={{ __html: window.atlasLogo.path }}
          />
        </div>
        <div className="flex-1 h-[70px] bg-primary relative -webkit-app-region-drag shadow-[0_4px_8px_rgba(0,0,0,0.5)]">
          <div className="absolute top-0 left-[50px] right-[110px] h-[10px] bg-accentBar"></div>
          <div
            className="absolute top-0 left-[40px] w-[10px] h-[10px] bg-accentBar"
            style={{ clipPath: "polygon(0% 0%, 100% 0%, 100% 100%)" }}
          ></div>
          <div
            className="absolute top-0 right-[100px] w-[10px] h-[10px] bg-accentBar"
            style={{ clipPath: "polygon(0% 0%, 100% 0%, 0% 100%)" }}
          ></div>
          <div className="w-full flex h-[70px]">
            <div className="flex items-center ml-5 mt-3">
              <div className="text-accent font-semibold cursor-pointer -webkit-app-region-no-drag">
                Games
              </div>
            </div>
            <div className="flex justify-center w-full">
              <window.SearchBox onToggleSidebar={toggleSearchSidebar} />
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
              <i
                className={
                  isMaximized
                    ? "fas fa-window-restore text-text fa-sm"
                    : "fas fa-window-maximize text-text fa-sm"
                }
              ></i>
            </button>
            <button
              onClick={() => window.electronAPI.closeWindow()}
              className="w-7 h-7 flex items-center justify-center bg-transparent hover:bg-[DarkRed] transition-colors duration-200"
            >
              <i className="fas fa-times text-text fa-sm"></i>
            </button>
          </div>
          <div className="absolute mt-10 top-0 right-0 flex h-[10px]">
            <span className="text-text text-xs mr-4">
              Version: {version} <span style={{ color: "Goldenrod" }}>α</span>
            </span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 bg-tertiary fixed w-full top-[70px] bottom-[40px]">
        {/* Left Sidebar (icons) - always visible */}
        <window.Sidebar onToggleGameList={toggleGameList} />

        {/* Left Game List (titles) - toggled */}
        {showGameList && (
          <div className="w-[200px] bg-secondary fixed h-full z-40 overflow-y-auto ml-[60px]">
            {filteredGames.length === 0 ? (
              <div className="p-2 text-center text-text">No games found</div>
            ) : (
              filteredGames.map((game) => (
                <div
                  key={game.record_id}
                  className={`p-2 cursor-pointer hover:bg-selected ${selectedGame?.record_id === game.record_id ? "bg-selected" : ""}`}
                  onClick={() => setSelectedGame(game)}
                >
                  {game.title}
                </div>
              ))
            )}
          </div>
        )}

        {/* Game Grid - NO right margin adjustment anymore */}
        <div
          id="gameGrid"
          className={`flex-1 bg-tertiary overflow-y-auto ${showGameList ? "ml-[260px]" : "ml-[60px]"}`}
          ref={gameGridRef}
          style={{ overflowX: "hidden" }}
        >
          {filteredGames.length === 0 ? (
            <div className="text-center text-text">No games available</div>
          ) : (
            <AutoSizer>
              {({ height, width }) => {
                const adjustedWidth = Math.max(0, width - getScrollbarWidth());
                return (
                  <Grid
                    ref={gridRef}
                    columnCount={columnCount}
                    columnWidth={() => {
                      if (columnCount > 1) {
                        return adjustedWidth / columnCount - 8;
                      } else {
                        return adjustedWidth / columnCount - 14;
                      }
                    }}
                    rowCount={Math.ceil(filteredGames.length / columnCount)}
                    rowHeight={bannerSize.bannerHeight + 16}
                    height={height}
                    width={adjustedWidth}
                    cellRenderer={cellRenderer}
                    style={{ overflowX: "hidden" }}
                  />
                );
              }}
            </AutoSizer>
          )}
        </div>

        {/* Right Search Sidebar - overlays on top, toggled */}
        {showSearchSidebar && (
          <window.SearchSidebar
            isVisible={showSearchSidebar}
            onFilterChange={handleFilterChange}
            onClose={() => setShowSearchSidebar(false)}
          />
        )}
      </div>

      {/* Status / Progress Bars */}
      {dbUpdateStatus.text && (
        <div className="absolute bottom-[44px] left-1/2 transform -translate-x-1/2 w-[600px] bg-primary flex items-center justify-center p-2 z-[1500] border border-border opacity-95">
          <div className="flex items-center w-[540px]">
            <span className="w-[300px] text-[10px] text-text">
              {dbUpdateStatus.text}
            </span>
            <div className="relative w-[300px]">
              <div className="h-[15px] bg-gray-700 rounded overflow-hidden">
                <div
                  className="h-full bg-accent"
                  style={{
                    width: `${(dbUpdateStatus.progress / (dbUpdateStatus.total || 1)) * 100}%`,
                  }}
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
            <span className="w-[300px] text-[10px] text-text">
              {importStatus.text}
            </span>
            <div className="relative w-[300px]">
              <div className="h-[15px] bg-gray-700 rounded overflow-hidden">
                <div
                  className="h-full bg-accent"
                  style={{
                    width: `${(importStatus.progress / importStatus.total) * 100}%`,
                  }}
                ></div>
              </div>
              <span className="absolute inset-0 flex items-center justify-center text-[10px] text-text">
                File {importStatus.progress}/{importStatus.total}
              </span>
            </div>
          </div>
          <div
            className="absolute left-[200px] bottom-0 w-[20px] h-[20px] bg-accent"
            style={{ clipPath: "polygon(0% 100%, 100% 0%, 100% 100%)" }}
          ></div>
          <div
            className="absolute right-[200px] bottom-0 w-[20px] h-[20px] bg-accent"
            style={{ clipPath: "polygon(0% 0%, 100% 0%, 0% 100%)" }}
          ></div>
        </div>
      )}

      {importProgress.text && (
        <div className="absolute bottom-[60px] left-1/2 transform -translate-x-1/2 w-[800px] bg-primary flex items-center justify-center p-2 z-[1500] border border-border opacity-95">
          <div className="flex items-center w-[800px]">
            <span className="w-[450px] text-[10px] text-text">
              {importProgress.text}
            </span>
            <div className="relative w-[300px]">
              <div className="h-[15px] bg-gray-700 rounded overflow-hidden">
                <div
                  className="h-full bg-accent"
                  style={{
                    width: `${(importProgress.progress / (importProgress.total || 1)) * 100}%`,
                  }}
                ></div>
              </div>
              <span className="absolute inset-0 flex items-center justify-center text-[10px] text-text">
                Game {importProgress.progress}/{importProgress.total}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
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
          <span>{`${games.length} Games Installed, ${totalVersions} Total Versions`}</span>
        </div>
        <div className="flex items-center">
          <i className="fas fa-download mr-2 text-text"></i>
          <span className="cursor-pointer">Downloads</span>
        </div>
      </div>

      {/* Updater placeholder */}
      <div className="hidden bg-canvas h-full w-full" id="updater">
        <div className="h-[200px] bg-tertiary"></div>
        <div className="flex-1 bg-primary border-t border-accent"></div>
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById("root"));
root.render(<App />);
