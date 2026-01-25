const { useState, useEffect } = window.React;
const ReactDOM = window.ReactDOM || {};
const { createRoot } = window.ReactDOM;

const Importer = () => {
  const [view, setView] = useState("settings");
  const [importSource, setImportSource] = useState("local");
  const [folder, setFolder] = useState("");
  const [useUnstructured, setUseUnstructured] = useState(true);
  const [customFormat, setCustomFormat] = useState(
    "{creator}/{title}/{version}",
  );
  const [gameExt, setGameExt] = useState(
    "exe,swf,flv,f4v,rag,cmd,bat,jar,html",
  );
  const [archiveExt, setArchiveExt] = useState("zip,7z,rar");
  const [isCompressed, setIsCompressed] = useState(false);
  const [downloadBannerImages, setDownloadBannerImages] = useState(false);
  const [downloadPreviewImages, setDownloadPreviewImages] = useState(false);
  const [previewLimit, setPreviewLimit] = useState("5");
  const [downloadVideos, setDownloadVideos] = useState(false);
  const [scanSize, setScanSize] = useState(false);
  const [deleteAfter, setDeleteAfter] = useState(false);
  const [moveGame, setMoveGame] = useState(false);

  const [defaultLibraryPath, setDefaultLibraryPath] = useState(null);
  const [askingForLibraryFolder, setAskingForLibraryFolder] = useState(false);

  const [progress, setProgress] = useState({
    value: 0,
    total: 0,
    potential: 0,
  });
  const [updateProgress, setUpdateProgress] = useState({ value: 0, total: 0 });
  const [gamesList, setGamesList] = useState([]);
  const [isMaximized, setIsMaximized] = useState(false);
  const [hideMatches, setHideMatches] = useState(false);

  useEffect(() => {
    console.log("Importer component mounted");
    window.electronAPI.log("Importer component mounted");

    window.electronAPI.onWindowStateChanged((state) => {
      console.log(`Window state changed: ${state}`);
      window.electronAPI.log(`Window state changed: ${state}`);
      setIsMaximized(state === "maximized");
    });

    window.electronAPI.onScanProgress((prog) => {
      console.log(`Scan progress: ${JSON.stringify(prog)}`);
      setProgress(prog);
    });

    window.electronAPI.onScanComplete((game) => {
      console.log(`Received incremental game: ${JSON.stringify(game)}`);
      if (
        game.results.length > 1 &&
        game.resultSelectedValue &&
        game.resultSelectedValue !== "match"
      ) {
        const selected = game.results.find(
          (r) => r.key === game.resultSelectedValue,
        );
        if (selected) {
          const parts = selected.value.split(" | ");
          game.atlasId = parts[0];
          game.f95Id = parts[1] || "";
          game.title = parts[2];
          game.creator = parts[3];
          window.electronAPI.getAtlasData(game.atlasId).then((atlasData) => {
            game.engine = atlasData.engine || "Unknown";
            setGamesList((prev) => [...prev, game]);
            console.log(`Updated game on scan: ${JSON.stringify(game)}`);
            window.electronAPI.log(
              `Updated game on scan: ${JSON.stringify(game)}`,
            );
          });
        } else {
          setGamesList((prev) => [...prev, game]);
        }
      } else {
        setGamesList((prev) => [...prev, game]);
      }
    });

    window.electronAPI.onScanCompleteFinal((games) => {
      console.log(`Scan complete, received ${games.length} games`);
      const updatedGames = games.map((game) => {
        if (
          game.results.length > 1 &&
          game.resultSelectedValue &&
          game.resultSelectedValue !== "match"
        ) {
          const selected = game.results.find(
            (r) => r.key === game.resultSelectedValue,
          );
          if (selected) {
            const parts = selected.value.split(" | ");
            game.atlasId = parts[0];
            game.f95Id = parts[1] || "";
            game.title = parts[2];
            game.creator = parts[3];
            return window.electronAPI
              .getAtlasData(game.atlasId)
              .then((atlasData) => {
                game.engine = atlasData.engine || "Unknown";
                return game;
              });
          }
        }
        return game;
      });
      console.log(
        "Games being processed:",
        updatedGames.map((g, idx) => `#${idx + 1}: ${g.title}`),
      );
      Promise.all(updatedGames).then((newGamesList) => {
        setGamesList(newGamesList);
        setView("scan");
        console.log(
          `Updated gamesList on scan complete: ${JSON.stringify(newGamesList)}`,
        );
        window.electronAPI.log(
          `Updated gamesList on scan complete: ${JSON.stringify(newGamesList)}`,
        );
      });
    });

    window.electronAPI.onUpdateProgress((prog) => {
      console.log(`Update progress: ${JSON.stringify(prog)}`);
      setUpdateProgress(prog);
    });

    window.electronAPI
      .getConfig()
      .then((config) => {
        console.log(`Config loaded: ${JSON.stringify(config)}`);
        window.electronAPI.log(`Config loaded: ${JSON.stringify(config)}`);
        const librarySettings = config.Library || {};
        setGameExt(
          librarySettings.gameExtensions ||
            "exe,swf,flv,f4v,rag,cmd,bat,jar,html",
        );
        setArchiveExt(librarySettings.extractionExtensions || "zip,7z,rar");

        window.electronAPI.getDefaultGameFolder().then((path) => {
          setDefaultLibraryPath(path);
          console.log("Default library folder:", path);
        });
      })
      .catch((err) => {
        console.error("Error loading config:", err);
        window.electronAPI.log(`Error loading config: ${err.message}`);
      });

    return () => {
      window.electronAPI.removeAllListeners("window-state-changed");
      window.electronAPI.removeAllListeners("scan-progress");
      window.electronAPI.removeAllListeners("scan-complete");
      window.electronAPI.removeAllListeners("scan-complete-final");
      window.electronAPI.removeAllListeners("update-progress");
    };
  }, []);

  const selectFolder = async () => {
    console.log("Selecting folder");
    window.electronAPI.log("Selecting folder");
    const path = await window.electronAPI.selectDirectory();
    if (path) {
      console.log(`Folder selected: ${path}`);
      window.electronAPI.log(`Folder selected: ${path}`);
      setFolder(path);
    }
  };

  const startScan = async () => {
    if (!folder) {
      console.log("No folder selected");
      window.electronAPI.log("No folder selected");
      return alert("Select a folder");
    }
    setView("scan");
    console.log("Starting scan");
    window.electronAPI.log("Starting scan");
    setGamesList([]);
    const params = {
      folder,
      format: useUnstructured ? "" : customFormat,
      gameExt: gameExt.split(",").map((e) => e.trim()),
      archiveExt: archiveExt.split(",").map((e) => e.trim()),
      isCompressed,
      deleteAfter,
      scanSize,
      downloadBannerImages,
      downloadPreviewImages,
      previewLimit,
      downloadVideos,
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
    window.electronAPI.log(
      `Updating game at index ${index}, field ${field} to ${value}`,
    );
    const updated = [...gamesList];
    updated[index][field] = value;
    setGamesList(updated);
  };

  const deleteGame = (index) => {
    console.log(`Deleting game at index ${index}`);
    window.electronAPI.log(`Deleting game at index ${index}`);
    setGamesList((prev) => prev.filter((_, i) => i !== index));
  };

  const handleResultChange = async (index, value) => {
    console.log(`Handling result change for index ${index}, value ${value}`);
    window.electronAPI.log(
      `Handling result change for index ${index}, value ${value}`,
    );
    const updatedGames = gamesList.map((game, i) => {
      if (i === index) {
        const updatedGame = { ...game, resultSelectedValue: value };
        const selected = game.results.find((r) => r.key === value);
        if (selected && value !== "match") {
          const parts = selected.value.split(" | ");
          updatedGame.atlasId = parts[0];
          updatedGame.f95Id = parts[1] || "";
          updatedGame.title = parts[2];
          updatedGame.creator = parts[3];
          return window.electronAPI
            .getAtlasData(updatedGame.atlasId)
            .then((atlasData) => {
              updatedGame.engine = atlasData.engine || "Unknown";
              console.log(
                `Updated game at index ${index}: ${JSON.stringify(updatedGame)}`,
              );
              window.electronAPI.log(
                `Updated game at index ${index}: ${JSON.stringify(updatedGame)}`,
              );
              return updatedGame;
            });
        }
        return updatedGame;
      }
      return game;
    });

    Promise.all(updatedGames).then((newGamesList) => {
      setGamesList(newGamesList);
      console.log(`New gamesList set: ${JSON.stringify(newGamesList[index])}`);
      window.electronAPI.log(
        `New gamesList set: ${JSON.stringify(newGamesList[index])}`,
      );
    });
  };

  const updateMatches = async () => {
    console.log("Starting full update of matches");
    window.electronAPI.log("Starting full update of matches");

    const total = gamesList.length;
    if (total === 0) return;

    setUpdateProgress({ value: 0, total });
    window.electronAPI.sendUpdateProgress({ value: 0, total });

    // Create a fresh immutable copy of the list
    let updatedGames = gamesList.map((game) => ({ ...game }));

    for (let i = 0; i < updatedGames.length; i++) {
      // Fresh copy of this game object
      let game = { ...updatedGames[i] };

      // ─── Skip if already has a good match ────────────────────────────────
      if (
        game.atlasId &&
        game.results?.length === 1 &&
        game.results[0]?.key === "match" &&
        game.resultVisibility === "visible"
      ) {
        console.log(
          `Skipping already matched game ${i + 1}/${total}: ${game.title}`,
        );
        window.electronAPI.log(
          `Skipping already matched game ${i + 1}/${total}: ${game.title}`,
        );
        updatedGames[i] = game;
        setUpdateProgress({ value: i + 1, total });
        window.electronAPI.sendUpdateProgress({ value: i + 1, total });
        await new Promise((r) => setTimeout(r, 50));
        continue;
      }

      console.log(
        `Updating game ${i + 1}/${total}: ${game.title} | Creator: ${game.creator} | F95: ${game.f95Id}`,
      );
      window.electronAPI.log(
        `Updating game ${i + 1}/${total}: ${game.title} | Creator: ${game.creator} | F95: ${game.f95Id}`,
      );

      let data;
      try {
        // Safe f95Id handling (prevents "trim is not a function")
        const f95IdStr = String(game.f95Id || "").trim();
        if (f95IdStr) {
          data = await window.electronAPI.searchAtlasByF95Id(f95IdStr);
          console.log("Searching by f95_id");
        } else {
          data = await window.electronAPI.searchAtlas(game.title, game.creator);
        }
      } catch (searchErr) {
        console.error(`Search failed for game ${i + 1}:`, searchErr);
        window.electronAPI.log(
          `Search failed for game ${i + 1}: ${searchErr.message}`,
        );
        data = [];
      }

      console.log(`Search results: ${JSON.stringify(data)}`);
      window.electronAPI.log(`Search results: ${JSON.stringify(data)}`);

      if (data.length === 1) {
        game = {
          ...game,
          atlasId: String(data[0].atlas_id),
          f95Id: data[0].f95_id || "",
          title: data[0].title,
          creator: data[0].creator,
          engine: data[0].engine || game.engine || "Unknown",
          results: [{ key: "match", value: "Match Found" }],
          resultSelectedValue: "match",
          resultVisibility: "visible",
        };
      } else if (data.length > 1) {
        const results = data.map((d) => ({
          key: String(d.atlas_id),
          value: `${d.atlas_id} | ${d.f95_id || ""} | ${d.title} | ${d.creator}`,
        }));

        const current = game.resultSelectedValue;
        const valid = results.find((r) => r.key === current);
        const selectedKey = valid ? current : results[0].key;

        const selected =
          results.find((r) => r.key === selectedKey) || results[0];
        const parts = selected.value.split(" | ");

        game = {
          ...game,
          results,
          resultSelectedValue: selectedKey,
          resultVisibility: "visible",
          atlasId: parts[0],
          f95Id: parts[1] || "",
          title: parts[2],
          creator: parts[3],
        };

        try {
          const atlasData = await window.electronAPI.getAtlasData(parts[0]);
          game = {
            ...game,
            engine: atlasData.engine || game.engine || "Unknown",
          };
        } catch (atlasErr) {
          console.error(
            `Failed to fetch atlas data for game ${i + 1} (atlas ${parts[0]}):`,
            atlasErr,
          );
          window.electronAPI.log(
            `Failed to fetch atlas data for game ${i + 1}: ${atlasErr.message}`,
          );
          // Continue without engine update
        }
      } else {
        game = {
          ...game,
          atlasId: "",
          f95Id: "",
          results: [],
          resultSelectedValue: "",
          resultVisibility: "hidden",
        };
      }

      // Put new object back
      updatedGames[i] = game;

      // Progress
      setUpdateProgress({ value: i + 1, total });
      window.electronAPI.sendUpdateProgress({ value: i + 1, total });

      // Breathing room for UI
      await new Promise((r) => setTimeout(r, 50));
    }

    // One final state update
    setGamesList(updatedGames);
    console.log("All matches processed — final list set");
    window.electronAPI.log("All matches processed — final list set");

    setUpdateProgress({ value: total, total });
    window.electronAPI.sendUpdateProgress({ value: total, total });
  };

  const importGamesFunc = async () => {
    if (gamesList.length === 0) {
      alert("No games to import");
      return;
    }

    let finalLibraryPath = defaultLibraryPath;

    if (moveGame && !finalLibraryPath) {
      setAskingForLibraryFolder(true);
      const selected = await window.electronAPI.selectDirectory();
      setAskingForLibraryFolder(false);

      if (!selected) {
        const proceed = confirm(
          "No library folder selected.\n\nContinue import without moving folders?",
        );
        if (!proceed) return;
      } else {
        try {
          const saveResult =
            await window.electronAPI.setDefaultGameFolder(selected);
          if (saveResult.success) {
            finalLibraryPath = selected;
            setDefaultLibraryPath(selected);
            console.log("Saved new default library folder:", selected);
          } else {
            alert(
              "Failed to save default library folder.\nImport continues without moving.",
            );
          }
        } catch (err) {
          console.error("Error saving library path:", err);
          alert("Error saving library path. Import continues without moving.");
        }
      }
    }

    console.log("Importing games");
    window.electronAPI.log("Importing games");

    const importParams = {
      games: gamesList,
      deleteAfter,
      scanSize,
      downloadBannerImages,
      downloadPreviewImages,
      previewLimit,
      downloadVideos,
      gameExt: gameExt.split(",").map((e) => e.trim()),
      moveToDefaultFolder: moveGame && !!finalLibraryPath,
      format: customFormat,
    };

    // Debug log
    console.log("=== IMPORT PARAMS BEING SENT ===");
    console.log("moveToDefaultFolder:", importParams.moveToDefaultFolder);
    console.log("format:", importParams.format);

    // Trigger import in background...
    window.electronAPI
      .importGames(importParams)
      .then(() => {
        console.log("Import completed successfully (background)");
      })
      .catch((err) => {
        console.error("Background import error:", err);
        window.electronAPI.log(`Background import error: ${err.message}`);
        // Optional: show a toast/notification in main window if needed
      });

    // ...immediately close the importer window
    await window.electronAPI.closeWindow();
  };

  const handleUpdateClick = (event) => {
    console.log("Update button clicked", event);
    window.electronAPI.log("Update button clicked");
    updateMatches();
  };

  console.log("Rendering Importer component, view:", view);

  return (
    <div className="h-screen flex flex-col fixed w-full">
      {/* Window Controls */}
      <div className="bg-primary h-8 flex justify-end items-center pr-2 -webkit-app-region-drag">
        <p className="text-sm absolute left-2 top-1">Import Games Wizard</p>
        <div className="flex absolute top-1 right-2 h-[70px] -webkit-app-region-no-drag">
          <button
            onClick={() => window.electronAPI.minimizeWindow()}
            className="w-6 h-6 flex items-center justify-center bg-transparent hover:bg-tertiary transition-colors duration-200"
            style={{ pointerEvents: "auto", zIndex: 1000 }}
          >
            <i className="fas fa-minus fa-xs text-text"></i>
          </button>
          <button
            onClick={() => window.electronAPI.maximizeWindow()}
            className="w-6 h-6 flex items-center justify-center bg-transparent hover:bg-tertiary transition-colors duration-200"
            style={{ pointerEvents: "auto", zIndex: 1000 }}
          >
            <i
              className={
                isMaximized
                  ? "fas fa-window-restore fa-xs text-text"
                  : "fas fa-window-maximize fa-xs text-text"
              }
            ></i>
          </button>
          <button
            onClick={() => window.electronAPI.closeWindow()}
            className="w-6 h-6 flex items-center justify-center bg-transparent hover:bg-[DarkRed] transition-colors duration-200"
            style={{ pointerEvents: "auto", zIndex: 1000 }}
          >
            <i className="fas fa-times fa-xs text-text"></i>
          </button>
        </div>
      </div>

      <div className="flex-1 p-4 bg-secondary overflow-y-auto">
        {view === "source" && (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col space-y-4 max-w-md w-full">
              <h2 className="text-xl text-center">Select Import Source</h2>
              <button
                onClick={() => setView("settings")}
                className="bg-secondary hover:bg-selected text-text p-2 rounded"
              >
                Atlas Game Importer
              </button>
              <button
                onClick={() => {
                  setView("scan");
                  setGamesList([]);
                  window.electronAPI
                    .startSteamScan({
                      downloadBannerImages: false,
                      downloadPreviewImages: false,
                      previewLimit: "5",
                      downloadVideos: false,
                    })
                    .catch((err) => {
                      console.error("Steam scan error:", err);
                      alert("Error starting Steam scan");
                    });
                }}
                className="bg-secondary hover:bg-selected text-text p-2 rounded"
              >
                Import Steam Games
              </button>
            </div>
          </div>
        )}

        {view === "settings" && (
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
                style={{ pointerEvents: "auto", zIndex: 1000 }}
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
              Valid folder structure options:{" "}
              <span className="font-semibold">Title</span>,{" "}
              <span className="font-semibold">Creator</span>,{" "}
              <span className="font-semibold">Engine</span>, and{" "}
              <span className="font-semibold">Version</span>.<br />- Enclose
              each option in braces, e.g.,{" "}
              <span className="font-mono">{"{Title}"}</span>. Use{" "}
              <span className="font-mono">/</span> for folder separators.
              <br />
              <br />
              Examples:
              <br />
              <span className="font-mono">
                {"{engine}/{creator}/{title}/{version}"}
              </span>
              <br />
              <span className="font-mono">
                {"[{engine}] [{title}] [{version}]"}
              </span>
              <br />
              <span className="font-mono">{"{title-version}"}</span>
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
              <div>
                <input
                  type="checkbox"
                  checked={downloadPreviewImages}
                  onChange={(e) => setDownloadPreviewImages(e.target.checked)}
                />
                <label>Download Preview Images (limit: {previewLimit})</label>
              </div>

              <div className="mt-4">
                <input
                  type="checkbox"
                  checked={moveGame}
                  onChange={(e) => setMoveGame(e.target.checked)}
                  className="mr-2"
                />
                <label className="font-medium">
                  Move imported games to default library folder (using
                  structure: {customFormat || "title-version"})
                </label>

                {moveGame && (
                  <div className="mt-1 ml-6 text-sm">
                    {defaultLibraryPath ? (
                      <span className="text-green-400">
                        Current library: <strong>{defaultLibraryPath}</strong>
                      </span>
                    ) : askingForLibraryFolder ? (
                      <span className="text-yellow-400">
                        Waiting for selection...
                      </span>
                    ) : (
                      <span className="text-yellow-400">
                        No default folder set — you will be asked to choose one
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end space-x-2">
              <button
                onClick={startScan}
                className="bg-accent p-2"
                style={{ pointerEvents: "auto", zIndex: 1000 }}
              >
                Next
              </button>
              <button
                onClick={() => window.electronAPI.closeWindow()}
                className="bg-accent p-2"
                style={{ pointerEvents: "auto", zIndex: 1000 }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {view === "scan" && (
          <div className="h-full flex flex-col">
            <div className="shrink-0">
              <h2 className="text-xl mb-4">Scan Results</h2>
              <div className="flex items-center mb-4">
                <progress
                  value={progress.value}
                  max={progress.total}
                  className="w-96"
                />
                <span className="ml-2">
                  {progress.value}/{progress.total}{" "}
                  {importSource === "steam"
                    ? "Games Scanned"
                    : "Folders Scanned"}
                </span>
              </div>
              <span className="mb-4">Found {progress.potential} Games</span>
            </div>

            <div className="flex-1 overflow-x-auto">
              <table
                className="border-collapse border border-border"
                style={{ minWidth: "1200px" }}
              >
                <thead>
                  <tr className="bg-secondary sticky top-0">
                    <th className="border border-border p-1 min-w-[80px]">
                      Atlas ID
                    </th>
                    <th className="border border-border p-1 min-w-[80px]">
                      F95 ID
                    </th>
                    <th className="border border-border p-1 min-w-[200px]">
                      Title
                    </th>
                    <th className="border border-border p-1 min-w-[150px]">
                      Creator
                    </th>
                    <th className="border border-border p-1 min-w-[100px]">
                      Engine
                    </th>
                    <th className="border border-border p-1 min-w-[200px]">
                      Version
                    </th>
                    <th className="border border-border p-1 min-w-[180px]">
                      Executable
                    </th>
                    <th className="border border-border p-1 min-w-[220px] !max-w-[220px]">
                      Possible Database Matches
                    </th>
                    <th className="border border-border p-1 min-w-[250px]">
                      Folder
                    </th>
                    <th className="border border-border p-1 min-w-[150px]">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {gamesList.map((game, originalIndex) => {
                    if (
                      hideMatches &&
                      game.results.length === 1 &&
                      game.results[0].value === "Match Found"
                    ) {
                      return null;
                    }
                    return (
                      <tr key={originalIndex} className="bg-primary">
                        <td className="border border-border p-1 min-w-[100px]">
                          {game.results.length > 1 && (
                            <i className="fa-solid fa-triangle-exclamation text-yellow-400 mr-1"></i>
                          )}
                          {game.atlasId}
                        </td>
                        <td className="border border-border p-1 min-w-[100px]">
                          <input
                            value={game.f95Id}
                            onChange={(e) =>
                              updateGame(originalIndex, "f95Id", e.target.value)
                            }
                            className="w-full bg-secondary border border-border p-1"
                          />
                        </td>
                        <td className="border border-border p-1">
                          <input
                            value={game.title}
                            onChange={(e) =>
                              updateGame(originalIndex, "title", e.target.value)
                            }
                            className="w-full bg-secondary border border-border p-1"
                          />
                        </td>
                        <td className="border border-border p-1">
                          <input
                            value={game.creator}
                            onChange={(e) =>
                              updateGame(
                                originalIndex,
                                "creator",
                                e.target.value,
                              )
                            }
                            className="w-full bg-secondary border border-border p-1"
                          />
                        </td>
                        <td className="border border-border p-1">
                          <input
                            value={game.engine}
                            onChange={(e) =>
                              updateGame(
                                originalIndex,
                                "engine",
                                e.target.value,
                              )
                            }
                            className="w-full bg-secondary border border-border p-1"
                          />
                        </td>
                        <td className="border border-border p-1">
                          <input
                            value={game.version}
                            onChange={(e) =>
                              updateGame(
                                originalIndex,
                                "version",
                                e.target.value,
                              )
                            }
                            className="w-full bg-secondary border border-border p-1"
                          />
                        </td>
                        <td className="border border-border p-1">
                          {game.multipleVisible === "visible" ? (
                            <select
                              value={game.selectedValue}
                              onChange={(e) =>
                                updateGame(
                                  originalIndex,
                                  "selectedValue",
                                  e.target.value,
                                )
                              }
                              className="w-full bg-secondary border border-border p-1"
                            >
                              {game.executables.map((opt) => (
                                <option key={opt.key} value={opt.key}>
                                  {opt.value}
                                </option>
                              ))}
                            </select>
                          ) : (
                            game.singleExecutable
                          )}
                        </td>
                        <td
                          className="border border-border p-1"
                          style={{ visibility: game.resultVisibility }}
                        >
                          {game.results.length === 1 &&
                          game.results[0].key === "match" ? (
                            <span className="text-text select-none">
                              {game.results[0].value}
                            </span>
                          ) : (
                            game.results.length > 1 && (
                              <select
                                value={game.resultSelectedValue}
                                onChange={(e) =>
                                  handleResultChange(
                                    originalIndex,
                                    e.target.value,
                                  )
                                }
                                className="w-full bg-secondary border border-border p-1"
                              >
                                {game.results.map((opt) => (
                                  <option key={opt.key} value={opt.key}>
                                    {opt.value}
                                  </option>
                                ))}
                              </select>
                            )
                          )}
                        </td>
                        <td className="border border-border p-1">
                          {game.folder}
                        </td>
                        <td className="border border-border p-1 min-w-[150px] flex space-x-2">
                          <button
                            onClick={() => deleteGame(originalIndex)}
                            className="bg-red-600 hover:bg-red-700 text-text text-xs p-1 rounded whitespace-nowrap"
                            style={{ pointerEvents: "auto" }}
                          >
                            Delete
                          </button>
                          <button
                            onClick={() =>
                              window.electronAPI.openDirectory(game.folder)
                            }
                            className="bg-accent hover:bg-selected text-text text-xs p-1 rounded whitespace-nowrap"
                            style={{ pointerEvents: "auto" }}
                          >
                            Open Folder
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between space-x-2 mt-4">
              <button
                onClick={() => setHideMatches(!hideMatches)}
                className="bg-accent p-2"
                style={{ pointerEvents: "auto", zIndex: 1000 }}
              >
                {hideMatches ? "Show All" : "Hide Matches"}
              </button>

              <div className="flex space-x-2">
                <button
                  onClick={handleUpdateClick}
                  className="bg-accent p-2"
                  style={{ pointerEvents: "auto", zIndex: 1000 }}
                >
                  Update
                </button>
                <button
                  onClick={importGamesFunc}
                  className="bg-accent p-2"
                  style={{ pointerEvents: "auto", zIndex: 1000 }}
                >
                  Import
                </button>
                <button
                  onClick={() => window.electronAPI.closeWindow()}
                  className="bg-accent p-2"
                  style={{ pointerEvents: "auto", zIndex: 1000 }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById("root")) || {
  render: (component) =>
    ReactDOM.render(component, document.getElementById("root")),
};
root.render(<Importer />);
