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
  const [downloadVideos, setDownloadVideos] = useState(true);
  const [scanSize, setScanSize] = useState(false);
  const [deleteAfter, setDeleteAfter] = useState(false);
  const [moveGame, setMoveGame] = useState(false);
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
    setGamesList([]); // Clear gamesList to start fresh
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

    // Wait for all promises to resolve
    Promise.all(updatedGames).then((newGamesList) => {
      setGamesList(newGamesList);
      console.log(`New gamesList set: ${JSON.stringify(newGamesList[index])}`);
      window.electronAPI.log(
        `New gamesList set: ${JSON.stringify(newGamesList[index])}`,
      );
    });
  };

  const updateMatches = async () => {
    console.log("Updating games");
    window.electronAPI.log("Updating games");
    const total = gamesList.length;
    setUpdateProgress({ value: 0, total });
    window.electronAPI.sendUpdateProgress({ value: 0, total });
    let updated = [...gamesList];
    for (let i = 0; i < updated.length; i++) {
      const game = updated[i];
      console.log(
        `Searching for game: ${game.title}, Creator: ${game.creator}`,
      );
      window.electronAPI.log(
        `Searching for game: ${game.title}, Creator: ${game.creator}`,
      );
      const data = await window.electronAPI.searchAtlas(
        game.title,
        game.creator,
      );
      window.electronAPI.log(data);
      console.log(`Search results for ${game.title}: ${JSON.stringify(data)}`);
      window.electronAPI.log(
        `Search results for ${game.title}: ${JSON.stringify(data)}`,
      );
      if (data.length === 1) {
        game.atlasId = data[0].atlas_id;
        game.f95Id = data[0].f95_id || "";
        game.title = data[0].title;
        game.creator = data[0].creator;
        game.engine = data[0].engine || game.engine || "Unknown";
        game.results = [{ key: "match", value: "Match Found" }];
        game.resultSelectedValue = "match";
        game.resultVisibility = "visible";
      } else if (data.length > 1) {
        game.results = data.map((d) => ({
          key: String(d.atlas_id),
          value: `${d.atlas_id} | ${d.f95_id || ""} | ${d.title} | ${d.creator}`,
        }));
        const currentSelection = game.resultSelectedValue;
        const validSelection = game.results.find(
          (r) => r.key === currentSelection,
        );
        game.resultSelectedValue = validSelection
          ? currentSelection
          : game.results[0].key;
        game.resultVisibility = "visible";
        const selectedResult =
          game.results.find((r) => r.key === game.resultSelectedValue) ||
          game.results[0];
        const parts = selectedResult.value.split(" | ");
        game.atlasId = parts[0];
        game.f95Id = parts[1] || "";
        game.title = parts[2];
        game.creator = parts[3];
        const atlasData = await window.electronAPI.getAtlasData(parts[0]);
        game.engine = atlasData.engine || game.engine || "Unknown";
      } else {
        game.atlasId = "";
        game.f95Id = "";
        game.results = [];
        game.resultSelectedValue = "";
        game.resultVisibility = "hidden";
      }
      // Update the table incrementally with a slight delay to ensure rendering
      await new Promise((resolve) => setTimeout(resolve, 0));
      setGamesList([...updated]);
      setUpdateProgress({ value: i + 1, total });
      window.electronAPI.sendUpdateProgress({ value: i + 1, total });
    }
    console.log("Finished updating games");
    window.electronAPI.log("Finished updating games");
    setUpdateProgress({ value: total, total });
    window.electronAPI.sendUpdateProgress({ value: total, total });
  };

  const importGamesFunc = async () => {
    console.log("Importing games");
    window.electronAPI.log("Importing games");
    const total = gamesList.length;
    setUpdateProgress({ value: 0, total });
    window.electronAPI.sendUpdateProgress({ value: 0, total });
    const updatedGames = [...gamesList];

    for (let index = 0; index < total; index++) {
      const game = updatedGames[index];
      if (game.steamId) {
        const result = await window.electronAPI.getSteamGameData(game.steamId); // Assume you expose getSteamGameData as a tool or IPC
        if (result) {
          const { game: data, screenshots } = result;
          updatedGames[index].creator = data.developer;
          updatedGames[index].engine = data.engine || "Unknown";
          // Update other fields as needed
          const searchResults = await window.electronAPI.searchAtlas(
            data.title,
            data.developer,
          );
          if (searchResults.length > 0) {
            // Update results
            updatedGames[index].results = searchResults.map((r) => ({
              key: String(r.atlas_id),
              value: `${r.atlas_id} | ${r.f95_id || ""} | ${r.title} | ${r.creator}`,
            }));
            if (searchResults.length === 1) {
              updatedGames[index].atlasId = searchResults[0].atlas_id;
              updatedGames[index].f95Id = searchResults[0].f95_id || "";
              updatedGames[index].resultSelectedValue =
                updatedGames[index].results[0].key;
              updatedGames[index].resultVisibility = "hidden";
            } else {
              updatedGames[index].results.unshift({
                key: "match",
                value: "Multiple matches found",
              });
              updatedGames[index].resultSelectedValue = "match";
            }
          }
          setGamesList(updatedGames);
        }
      }
      setUpdateProgress({ value: index + 1, total });
      window.electronAPI.sendUpdateProgress({ value: index + 1, total });
    }

    const result = await window.electronAPI.importGames({
      games: updatedGames,
      downloadBannerImages,
      downloadPreviewImages,
      previewLimit,
      downloadVideos,
    });
    await window.electronAPI.closeWindow();
  };

  const handleUpdateClick = (event) => {
    console.log("Update button clicked", event);
    window.electronAPI.log("Update button clicked");
    updateMatches();
  };

  console.log("Rendering Importer component, view:", view);
  // Default game
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
                      downloadVideos: true,
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
              - For unsorted games, check "Unstructured Format" to let the
              program parse the title and version automatically.
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
            <div className="flex justify-between space-x-2">
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
