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
  const [appUpdateNotice, setAppUpdateNotice] = useState({
    visible: false,
    status: "",
    version: "",
    text: "",
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
  const dbUpdateRunningRef = useRef(false);

  const [showSearchSidebar, setShowSearchSidebar] = useState(false); // or false

  const defaultFilters = {
    text: "",
    type: "all",
    category: [],
    engine: [],
    status: [],
    censored: [],
    language: [],
    tags: [],
    sort: "name",
    dateLimit: 0,
    tagLogic: "AND",
    updateAvailable: false,
    includeUninstalled: false,
  };

  const [activeFilters, setActiveFilters] = useState(defaultFilters);

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

  const handleSearchChange = useCallback((text) => {
    setActiveFilters((prev) => ({ ...prev, text }));
  }, []);

  const includeUninstalledRef = useRef(false);

  const updateGamesState = useCallback((gamesArray) => {
    setGames(gamesArray);
    setTotalVersions(
      gamesArray.reduce((sum, game) => sum + (game.versionCount || 0), 0),
    );
  }, []);

  const fetchGames = useCallback(
    (includeUninstalled = includeUninstalledRef.current) =>
      window.electronAPI
        .getGames({ includeUninstalled })
        .then((allGames) => {
          const gamesArray = Array.isArray(allGames) ? allGames : [];
          console.log(
            `Fetched ${gamesArray.length} games; includeUninstalled=${includeUninstalled}`,
          );
          updateGamesState(gamesArray);
          return gamesArray;
        })
        .catch((error) => {
          console.error("Failed to fetch games:", error);
          updateGamesState([]);
          return [];
        }),
    [updateGamesState],
  );

  const clearDbUpdateStatusSoon = useCallback(() => {
    setTimeout(
      () => setDbUpdateStatus({ text: "", progress: 0, total: 0 }),
      2000,
    );
  }, []);

  const runDbUpdateCheck = useCallback(async () => {
    if (dbUpdateRunningRef.current) {
      setDbUpdateStatus({
        text: "Database update check already running...",
        progress: 0,
        total: 0,
      });
      return;
    }

    dbUpdateRunningRef.current = true;
    setDbUpdateStatus({
      text: "Checking database updates...",
      progress: 0,
      total: 0,
    });

    try {
      const result = await window.electronAPI.checkDbUpdates();
      if (!result.success) {
        setDbUpdateStatus({
          text: `Error: ${result.error}`,
          progress: 0,
          total: 100,
        });
        clearDbUpdateStatusSoon();
      } else if (result.total === 0) {
        setDbUpdateStatus({ text: result.message, progress: 0, total: 0 });
        clearDbUpdateStatusSoon();
      } else {
        setDbUpdateStatus({
          text: result.message || "Database updates complete",
          progress: result.processed || result.total,
          total: result.total,
        });
        clearDbUpdateStatusSoon();
      }
    } catch (error) {
      console.error("Failed to check database updates:", error);
      setDbUpdateStatus({
        text: `Error: ${error.message}`,
        progress: 0,
        total: 100,
      });
      clearDbUpdateStatusSoon();
    } finally {
      dbUpdateRunningRef.current = false;
    }
  }, [clearDbUpdateStatusSoon]);

  const handleFilterChange = (filters) => {
    setActiveFilters((prev) => ({ ...prev, ...filters, text: prev.text }));
    const nextIncludeUninstalled = filters.includeUninstalled === true;
    if (includeUninstalledRef.current !== nextIncludeUninstalled) {
      includeUninstalledRef.current = nextIncludeUninstalled;
      fetchGames(nextIncludeUninstalled).then(() => {
        if (!nextIncludeUninstalled) {
          setSelectedGame((current) =>
            current?.hasInstalledVersion === false ? null : current,
          );
        }
      });
    }
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
              const shouldHideMissing =
                !includeUninstalledRef.current &&
                updatedGame.hasInstalledVersion === false;
              const newGames = shouldHideMissing
                ? prev.filter((g) => g.record_id !== updatedGame.record_id)
                : prev.map((g) =>
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
            setSelectedGame((current) =>
              current?.record_id === updatedGame.record_id &&
              (includeUninstalledRef.current ||
                updatedGame.hasInstalledVersion !== false)
                ? updatedGame
              : current?.record_id === updatedGame.record_id
                  ? null
                  : current,
            );
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

    // Fetch games quickly, then validate large-library paths in the background.
    fetchGames(false).then(() => {
      window.electronAPI.validateLibraryPaths?.();
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

    window.electronAPI.getVersion().then((v) => setVersion(v));

    runDbUpdateCheck();

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
              const shouldHideMissing =
                !includeUninstalledRef.current &&
                game.hasInstalledVersion === false;
              const withoutDuplicate = prev.filter(
                (existing) => existing.record_id !== game.record_id,
              );
              const newGames = shouldHideMissing
                ? withoutDuplicate
                : [...withoutDuplicate, game].sort((a, b) =>
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
            setSelectedGame((current) =>
              current?.record_id === game.record_id &&
              (includeUninstalledRef.current ||
                game.hasInstalledVersion !== false)
                ? game
                : current?.record_id === game.record_id
                  ? null
                  : current,
            );
          }
        })
        .catch((error) =>
          console.error(`Failed to get game for recordId ${recordId}:`, error),
        );
    };
    const replaceGameInState = (game) => {
      if (!game?.record_id) return;
      setGames((prev) => {
        const shouldHideMissing =
          !includeUninstalledRef.current && game.hasInstalledVersion === false;
        const exists = prev.some((existing) => existing.record_id === game.record_id);
        const newGames = shouldHideMissing
          ? prev.filter((existing) => existing.record_id !== game.record_id)
          : exists
            ? prev.map((existing) =>
                existing.record_id === game.record_id ? game : existing,
              )
            : [...prev, game].sort((a, b) =>
                (a.title || "").localeCompare(b.title || ""),
              );
        setTotalVersions(
          newGames.reduce((sum, game) => sum + (game.versionCount || 0), 0),
        );
        return newGames;
      });
      setSelectedGame((current) =>
        current?.record_id === game.record_id
          ? game.hasInstalledVersion === false && !includeUninstalledRef.current
            ? null
            : game
          : current,
      );
    };

    const handleGameUpdated = (event, payload) => {
      if (payload && typeof payload === "object") {
        replaceGameInState(payload);
        return;
      }
      console.log(`Game updated event received for recordId: ${payload}`);
      refreshGame(payload);
    };
    const handleLibraryValidationProgress = (progress) => {
      if (progress?.error) {
        console.error("Library validation error:", progress.error);
        return;
      }
      if (progress?.total) {
        setDbUpdateStatus({
          text: "Validating installed paths...",
          progress: progress.processed,
          total: progress.total,
        });
        if (progress.processed >= progress.total) {
          setTimeout(
            () => setDbUpdateStatus({ text: "", progress: 0, total: 0 }),
            1200,
          );
        }
      }
    };
    const handleImportComplete = () => {
      console.log("Import complete: fetching all games");
      fetchGames();
      setTimeout(
        () => setImportProgress({ text: "", progress: 0, total: 0 }),
        2000,
      );
    };
    const handleUpdateStatus = (status) => {
      console.log("Update status:", status);
      if (status.status === "available") {
        setAppUpdateNotice({
          visible: true,
          status: "available",
          version: status.version || "",
          text: `Atlas ${status.version} is available.`,
        });
      } else if (status.status === "downloading") {
        setDbUpdateStatus({
          text: `Downloading update: ${status.percent.toFixed(0)}%`,
          progress: status.percent,
          total: 100,
        });
      } else if (status.status === "downloaded") {
        setAppUpdateNotice({
          visible: true,
          status: "downloaded",
          version: status.version || "",
          text: `Atlas ${status.version} is ready to install.`,
        });
      } else if (status.status === "error") {
        console.error("Update error:", status.error);
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
    window.electronAPI.onLibraryValidationProgress?.(
      handleLibraryValidationProgress,
    );
    window.electronAPI.onImportComplete(handleImportComplete);
    window.electronAPI.onUpdateStatus(handleUpdateStatus);
    window.electronAPI
      .getAppUpdateState?.()
      .then((status) => {
        if (status?.status && status.status !== "idle") {
          handleUpdateStatus(status);
        }
      })
      .catch((error) =>
        console.error("Failed to load app update state:", error),
      );

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
      [
        "window-state-changed",
        "db-update-progress",
        "import-progress",
        "game-imported",
        "game-updated",
        "library-validation-progress",
        "import-complete",
        "context-menu-command",
        "game-deleted",
      ].forEach((channel) => window.electronAPI.removeAllListeners(channel));
    };
  }, []);

  const addGame = async () => {
    window.electronAPI.openImporter();
  };

  const cancelImport = async () => {
    try {
      setImportProgress((prev) => ({
        ...prev,
        text: "Cancel requested. Cleaning up current import...",
        canCancel: false,
        canceling: true,
      }));
      await window.electronAPI.cancelImport();
    } catch (error) {
      console.error("Failed to cancel import:", error);
    }
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

  const unzipGame = async () => {
    const zipPath = await window.electronAPI.selectFile();
    if (!zipPath) return;

    const extractPath = await window.electronAPI.selectDirectory();
    if (!extractPath) return;
    setImportStatus({ text: "Unzipping game", progress: 50, total: 100 });
    try {
      const result = await window.electronAPI.unzipGame({
        zipPath,
        extractPath,
      });
      setImportStatus({
        text: result.success ? "Unzip complete" : `Error: ${result.error}`,
        progress: result.success ? 100 : 50,
        total: 100,
      });
      setTimeout(
        () => setImportStatus({ text: "", progress: 0, total: 0 }),
        2000,
      );
    } catch (error) {
      console.error("Failed to unzip game:", error);
      setImportStatus({
        text: `Error: ${error.message}`,
        progress: 50,
        total: 100,
      });
      setTimeout(
        () => setImportStatus({ text: "", progress: 0, total: 0 }),
        2000,
      );
    }
  };

  const filteredGames = useMemo(() => {
    let result = [...games];

    // Text search
    if (activeFilters.text) {
      const lower = activeFilters.text.toLowerCase();
      result = result.filter((game) => {
        const title = (game.title || "").toLowerCase();
        const creator = (game.creator || "").toLowerCase();

        if (activeFilters.type === "title") return title.includes(lower);
        if (activeFilters.type === "creator") return creator.includes(lower);
        return title.includes(lower) || creator.includes(lower);
      });
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

    const parseMetric = (value) => {
      if (typeof value === "number") return value;
      const normalized = String(value || "")
        .trim()
        .toLowerCase()
        .replace(/,/g, "");
      const match = normalized.match(/([0-9]+(?:\.[0-9]+)?)\s*([km])?/);
      if (!match) return 0;
      const amount = Number(match[1]);
      const multiplier = match[2] === "m" ? 1000000 : match[2] === "k" ? 1000 : 1;
      return amount * multiplier;
    };

    // Sorting
    result.sort((a, b) => {
      if (activeFilters.sort === "date") {
        return (b.release_date || 0) - (a.release_date || 0);
      }
      if (["likes", "views", "rating"].includes(activeFilters.sort)) {
        return parseMetric(b[activeFilters.sort]) - parseMetric(a[activeFilters.sort]);
      }
      return (a.title || "").localeCompare(b.title || "");
    });

    return result;
  }, [games, activeFilters]);

  const installedGameCount = useMemo(
    () => games.filter((game) => game.hasInstalledVersion !== false).length,
    [games],
  );
  const uninstalledGameCount = Math.max(0, games.length - installedGameCount);

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

  const selectGame = useCallback((game) => {
    setSelectedGame(game);
    if (!game?.record_id) return;
    window.electronAPI
      .getGame(game.record_id)
      .then((updatedGame) => {
        if (updatedGame) setSelectedGame(updatedGame);
      })
      .catch((error) =>
        console.error(`Failed to refresh selected game ${game.record_id}:`, error),
      );
  }, []);

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
        <window.GameBanner game={game} onSelect={() => selectGame(game)} />
      </div>
    );
  };

return (
  <div className="flex flex-col h-screen font-sans text-[13px]">
    {/* Header */}
    <div className="flex h-[70px] items-center z-50 fixed w-full top-0 select-none -webkit-app-region-drag">
      <div
        className="w-[60px] bg-accent flex items-center justify-center h-[70px] z-50 cursor-pointer -webkit-app-region-no-drag"
        onClick={() => setSelectedGame(null)}
        title="Back to Library"
      >
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
            <div
              className="text-accent font-semibold cursor-pointer -webkit-app-region-no-drag"
              onClick={() => setSelectedGame(null)}
              title="Back to Library"
            >
              Games
            </div>
          </div>
          <div className="flex justify-center w-full">
            <window.SearchBox
              value={activeFilters.text}
              onSearchChange={handleSearchChange}
              onToggleSidebar={toggleSearchSidebar}
            />
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
      <window.Sidebar
        onToggleGameList={toggleGameList}
        onCheckDbUpdates={runDbUpdateCheck}
        onGoHome={() => setSelectedGame(null)}
      />

      {/* Left Game List (titles) - toggled */}
      {showGameList && (
        <div className="w-[200px] bg-secondary fixed top-[70px] bottom-[40px] z-40 overflow-y-auto ml-[60px]">
          {filteredGames.length === 0 ? (
            <div className="p-2 text-center text-text">No games found</div>
          ) : (
            filteredGames.map((game) => (
              <div
                key={game.record_id}
                className={`p-2 cursor-pointer hover:bg-selected ${selectedGame?.record_id === game.record_id ? "bg-selected" : ""} ${game.hasInstalledVersion === false ? "text-gray-500 italic" : ""}`}
                onClick={() => selectGame(game)}
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
        {selectedGame ? (
          <window.GameDetailPage
            game={selectedGame}
            onBack={() => setSelectedGame(null)}
            onRefresh={refreshGame}
          />
        ) : filteredGames.length === 0 ? (
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
          searchText={activeFilters.text}
          activeFilters={activeFilters}
          onSearchChange={handleSearchChange}
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
      <div className="absolute bottom-[60px] left-1/2 transform -translate-x-1/2 w-[900px] bg-primary flex items-center justify-center p-2 z-[1500] border border-border opacity-95">
        <div className="flex items-center w-[880px] gap-2">
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
          {importProgress.canCancel && (
            <button
              onClick={cancelImport}
              className="bg-red-700 hover:bg-red-800 px-3 py-1 text-[10px] text-white"
            >
              Cancel Import
            </button>
          )}
        </div>
      </div>
    )}

    {appUpdateNotice.visible && (
      <div className="fixed bottom-[40px] left-0 right-0 z-50 bg-primary border-t border-accent px-4 py-2 text-text flex items-center justify-between gap-3">
        <div className="flex items-center min-w-0">
          <i className="fas fa-arrow-circle-up mr-2 text-highlight"></i>
          <span className="truncate">
            {appUpdateNotice.text} Manage app updates in Settings.
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => window.electronAPI.openSettings()}
            className="bg-accent px-3 py-1 hover:bg-opacity-90"
          >
            Settings
          </button>
          <button
            onClick={() =>
              setAppUpdateNotice((notice) => ({ ...notice, visible: false }))
            }
            className="bg-transparent px-2 py-1 hover:text-highlight"
            aria-label="Dismiss update notice"
          >
            <i className="fas fa-times"></i>
          </button>
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
        <span>
          {activeFilters.includeUninstalled
            ? `${installedGameCount} Games Installed, ${uninstalledGameCount} Uninstalled, ${totalVersions} Total Versions`
            : `${installedGameCount} Games Installed, ${totalVersions} Total Versions`}
        </span>
      </div>
      <div className="flex items-center">
        <i className="fas fa-download mr-2 text-text"></i>
        <span className="cursor-pointer" onClick={unzipGame}>
          Downloads
        </span>
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