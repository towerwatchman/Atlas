const { useState, useEffect, useRef, useMemo } = window.React;
const ReactDOM = window.ReactDOM || {};
const { createRoot } = window.ReactDOM;

const Importer = () => {
  const [view, setView] = useState("source");
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
  const [previewLimit, setPreviewLimit] = useState("Unlimited");
  const [downloadVideos, setDownloadVideos] = useState(false);
  const [scanSize, setScanSize] = useState(false);
  const [deleteAfter, setDeleteAfter] = useState(false);
  const [moveGame, setMoveGame] = useState(false);
  const [includeUnmatched, setIncludeUnmatched] = useState(false);
  const [includeArchives, setIncludeArchives] = useState(false);
  const [forceReimport, setForceReimport] = useState(false);
  const [defaultLibraryPath, setDefaultLibraryPath] = useState(null);
  const [autoSelectLatestReplaceVersion, setAutoSelectLatestReplaceVersion] =
    useState(false);
  const autoSelectLatestReplaceVersionRef = useRef(false);
  const [libraryFormat, setLibraryFormat] = useState(
    "{creator}/{title}/{version}",
  );
  const [askingForLibraryFolder, setAskingForLibraryFolder] = useState(false);

  const [progress, setProgress] = useState({
    value: 0,
    total: 0,
    potential: 0,
    pendingMatch: 0,
    archives: 0,
    alreadyImported: 0,
    repairPath: 0,
    missingLaunchable: 0,
    emptyFolder: 0,
    totalFound: 0,
  });
  const [updateProgress, setUpdateProgress] = useState({ value: 0, total: 0 });
  const [progressLabel, setProgressLabel] = useState(null); // null = show scan label, string = override
  const [gamesList, setGamesList] = useState([]);
  const [isMaximized, setIsMaximized] = useState(false);
  const [hideMatches, setHideMatches] = useState(false);
  const [sortConfig, setSortConfig] = useState({
    key: "",
    direction: "asc",
  });
  const [isResolvingMatches, setIsResolvingMatches] = useState(false);
  const deletedScanGameKeysRef = React.useRef(new Set());
  const matchCancelRef = React.useRef(false);

  const getScanGameKey = (game) => {
    // Archive scans share their parent folder, so identify rows by source file first.
    if (game?.sourceFile) return `source:${game.sourceFile}`;
    if (game?.folder && game?.singleExecutable) {
      return `folder-file:${game.folder}/${game.singleExecutable}`;
    }
    if (game?.folder) return `folder:${game.folder}`;

    return [
      game?.sourceFile || "",
      game?.folder || "",
      game?.singleExecutable || "",
      game?.title || "",
      game?.creator || "",
      game?.version || "",
      game?.f95Id || "",
      game?.atlasId || "",
    ].join("|");
  };

  const addScannedGame = (game) => {
    const gameKey = getScanGameKey(game);
    if (deletedScanGameKeysRef.current.has(gameKey)) return;
    setGamesList((prev) => [...prev, game]);
  };

  const isNewScanRow = (game) =>
    ["new", "repairPath"].includes(game.scanStatus || "new");
  const isExistingImportRow = (game) =>
    game.scanStatus === "alreadyImported" &&
    forceReimport;
  const hasDatabaseMatch = (game) =>
    game.results?.length === 1 && game.results[0]?.key === "match";
  const hasSelectedDatabaseMatch = (game) =>
    game.results?.length > 1 && !!game.resultSelectedValue;
  const isUnmatchedGame = (game) => (game.results || []).length === 0;
  const isImportableGame = (
    game,
    { includeUnmatchedGames = false, includeArchiveGames = false } = {},
  ) => {
    if (!isNewScanRow(game) && !isExistingImportRow(game)) return false;
    if (game.isArchive && !includeArchiveGames) return false;
    if (!game.isArchive && !game.selectedValue) {
      return false;
    }
    if (hasDatabaseMatch(game) || hasSelectedDatabaseMatch(game)) return true;
    return includeUnmatchedGames && isUnmatchedGame(game);
  };
  const importOptions = {
    includeUnmatchedGames: includeUnmatched,
    includeArchiveGames: includeArchives,
  };
  const importableGames = gamesList.filter((game) =>
    isImportableGame(game, importOptions),
  );
  const canImport = importableGames.length > 0;
  const getImportDisabledReason = () => {
    if (canImport) return "";

    const newRows = gamesList.filter(
      (game) => isNewScanRow(game) || isExistingImportRow(game),
    );
    if (newRows.length === 0) return "No new importable scan rows found";

    const hasArchives = newRows.some((game) => game.isArchive);
    const hasUnmatched = newRows.some(isUnmatchedGame);
    const hasMatchedArchive = newRows.some(
      (game) =>
        game.isArchive &&
        (hasDatabaseMatch(game) || hasSelectedDatabaseMatch(game)),
    );
    const hasUnmatchedArchive = newRows.some(
      (game) => game.isArchive && isUnmatchedGame(game),
    );

    if (hasUnmatchedArchive && (!includeArchives || !includeUnmatched)) {
      return "Archive rows without database matches require both checkboxes";
    }
    if (hasMatchedArchive && !includeArchives) {
      return "Archive rows require 'Extract and import archives'";
    }
    if (hasUnmatched && !includeUnmatched) {
      return "Unmatched rows require 'Import unmatched games'";
    }
    if (hasArchives && !includeArchives) {
      return "Archive rows require 'Extract and import archives'";
    }
    return "No eligible rows are ready to import";
  };

  const alphaNumericCollator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });

  const normalizeSortValue = (value) => {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  };

  const getSortValue = (game, key) => {
    switch (key) {
      case "atlasId":
        return game.atlasId || "";
      case "f95Id":
        return game.f95Id || "";
      case "title":
        return game.title || "";
      case "creator":
        return game.creator || "";
      case "engine":
        return game.engine || "";
      case "version":
        return game.version || "";
      case "replaceVersion":
        return game.replaceVersion || "";
      case "executable":
        return game.selectedValue || game.singleExecutable || "";
      case "databaseMatch":
        if (game.results?.length === 1 && game.results[0]?.key === "match") {
          return game.results[0].value || "Match Found";
        }
        if (game.results?.length > 1) {
          const selected = game.results.find(
            (result) => result.key === game.resultSelectedValue,
          );
          return selected?.value || game.results[0]?.value || "";
        }
        return "";
      case "source":
        return game.isArchive
          ? game.sourceFile || game.folder || "Archive"
          : game.folder || "Metadata only";
      case "status":
        return (
          game.scanMessage ||
          (["new", "repairPath"].includes(game.scanStatus || "new")
            ? "Ready to import"
            : "Skipped")
        );
      default:
        return "";
    }
  };

  const isEmptyReplaceVersion = (row) =>
    !String(row.game?.replaceVersion || "").trim();

  const compareRows = (a, b, key, direction) => {
    if (key === "replaceVersion") {
      const aIsNone = isEmptyReplaceVersion(a);
      const bIsNone = isEmptyReplaceVersion(b);

      if (aIsNone !== bIsNone) {
        return aIsNone ? 1 : -1;
      }
    }

    const aValue = normalizeSortValue(getSortValue(a.game, key));
    const bValue = normalizeSortValue(getSortValue(b.game, key));
    const result = alphaNumericCollator.compare(aValue, bValue);

    if (result !== 0) {
      return direction === "desc" ? -result : result;
    }

    return a.originalIndex - b.originalIndex;
  };

  const handleSort = (key) => {
    setSortConfig((prev) => {
      if (prev.key !== key) {
        return { key, direction: "asc" };
      }

      if (prev.direction === "asc") {
        return { key, direction: "desc" };
      }

      return { key: "", direction: "asc" };
    });
  };

  const getSortIndicator = (key) => {
    if (sortConfig.key !== key) return "";
    return sortConfig.direction === "asc" ? " ▲" : " ▼";
  };

  const applyReplaceOptions = async (game) => {
    const recordId = game?.existingRecordId || game?.recordId;
    if (!recordId) {
      return {
        ...game,
        replaceVersion: game.replaceVersion || "",
        replaceOptions: [],
      };
    }

    try {
      const versions = await window.electronAPI.getReplaceVersionOptions({
        recordId,
      });
      const normalizedNewVersion = String(game.version || "")
        .trim()
        .toLowerCase();
      const replaceOptions = (versions || [])
        .filter((version) => {
          const candidateVersion = String(version.version || "")
            .trim()
            .toLowerCase();
          return candidateVersion && candidateVersion !== normalizedNewVersion;
        })
        .sort((a, b) => Number(b.date_added || 0) - Number(a.date_added || 0));
      const defaultReplaceVersion =
        autoSelectLatestReplaceVersionRef.current && replaceOptions.length > 0
          ? replaceOptions[0].version || ""
          : "";

      return {
        ...game,
        replaceVersion: game.replaceVersion || defaultReplaceVersion,
        replaceOptions,
      };
    } catch (err) {
      console.error("Failed to load replace version options:", err);
      return {
        ...game,
        replaceVersion: game.replaceVersion || "",
        replaceOptions: [],
      };
    }
  };

  const handleAutoSelectLatestReplaceVersionChange = async (e) => {
    const checked = e.target.checked;
    autoSelectLatestReplaceVersionRef.current = checked;
    setAutoSelectLatestReplaceVersion(checked);

    if (checked) {
      setGamesList((prev) =>
        prev.map((game) => {
          if (game.replaceVersion || !game.replaceOptions?.length) return game;
          return {
            ...game,
            replaceVersion: game.replaceOptions[0].version || "",
          };
        }),
      );
    }

    try {
      const config = await window.electronAPI.getConfig();
      await window.electronAPI.saveSettings({
        ...config,
        Library: {
          ...(config.Library || {}),
          autoSelectLatestReplaceVersion: checked,
        },
      });
    } catch (err) {
      console.error("Failed to save replacement default setting:", err);
    }
  };

  const applyImportStatus = async (game) => {
    if (!game) return game;

    try {
      const status = await window.electronAPI.getImportRecordStatus(game);
      const recordExist = status?.status === "alreadyImported";
      return applyReplaceOptions({
        ...game,
        recordExist,
        existingRecordId: status?.recordId || "",
        scanStatus: recordExist
          ? "alreadyImported"
          : status?.status === "repairPath"
            ? "repairPath"
            : "new",
        scanMessage: recordExist
          ? "Already imported"
          : status?.status === "repairPath"
            ? "Repair path"
            : game.scanMessage || (game.isArchive ? "Archive" : "Ready to import"),
      });
    } catch (err) {
      console.error("Failed to refresh import status:", err);
      return applyReplaceOptions(game);
    }
  };

  const applySelectedMatch = async (game, value) => {
    let updatedGame = { ...game, resultSelectedValue: value };
    const selected = game.results?.find((r) => r.key === value);

    if (selected && value !== "match") {
      const parts = selected.value.split(" | ");
      updatedGame = {
        ...updatedGame,
        atlasId: parts[0],
        f95Id: parts[1] || "",
        title: parts[2],
        creator: parts[3],
      };
      try {
        const atlasData = await window.electronAPI.getAtlasData(
          updatedGame.atlasId,
        );
        updatedGame = {
          ...updatedGame,
          engine: atlasData.engine || "Unknown",
          f95Id: updatedGame.f95Id || atlasData.f95_id || "",
          latestVersion: atlasData.latestVersion || "",
        };
      } catch (err) {
        console.error("Failed to hydrate selected match:", err);
      }
    }

    return applyImportStatus(updatedGame);
  };

  const chooseInstalledMatch = async (game, results) => {
    for (const result of results) {
      const candidate = await applySelectedMatch(
        { ...game, results },
        result.key,
      );
      if (["alreadyImported", "repairPath"].includes(candidate.scanStatus)) {
        return candidate;
      }
    }
    return applySelectedMatch({ ...game, results }, results[0]?.key || "");
  };

  const resolvePendingMatches = async (rows) => {
    const pendingRows = rows.filter((game) => game.scanStatus === "pendingMatch");
    if (pendingRows.length === 0) return;

    matchCancelRef.current = false;
    setIsResolvingMatches(true);
    setProgressLabel("Resolving Matches");
    setProgress((prev) => ({ ...prev, value: 0, total: pendingRows.length }));
    await new Promise((r) => setTimeout(r, 16));

    const chunkSize = 10;
    let resolvedCount = 0;
    for (let i = 0; i < pendingRows.length; i += chunkSize) {
      if (matchCancelRef.current) break;
      const chunk = pendingRows.slice(i, i + chunkSize);
      const resolvedChunk = await Promise.all(
        (await window.electronAPI.resolveImportMatches(chunk)).map((game) =>
          applyImportStatus(game),
        ),
      );
      resolvedCount += resolvedChunk.length;
      const resolvedByKey = new Map(
        resolvedChunk.map((game) => [getScanGameKey(game), game]),
      );

      setGamesList((prev) =>
        prev.map((game) => resolvedByKey.get(getScanGameKey(game)) || game),
      );
      setProgress((prev) => ({ ...prev, value: resolvedCount }));
      window.electronAPI.sendUpdateProgress({
        value: resolvedCount,
        total: pendingRows.length,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    setIsResolvingMatches(false);
    setProgressLabel(null);
  };

  const cancelScanOrMatch = () => {
    matchCancelRef.current = true;
    window.electronAPI.cancelScan?.();
    setIsResolvingMatches(false);
  };

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

    window.electronAPI.onScanComplete(async (game) => {
      console.log(`Received incremental game: ${JSON.stringify(game)}`);
      if (game.scanStatus === "pendingMatch") {
        addScannedGame(game);
        return;
      }
      if (
        game.results?.length > 1 &&
        game.resultSelectedValue &&
        game.resultSelectedValue !== "match"
      ) {
        const updatedGame = await chooseInstalledMatch(game, game.results);
        addScannedGame(updatedGame);
        console.log(`Updated game on scan: ${JSON.stringify(updatedGame)}`);
        window.electronAPI.log(
          `Updated game on scan: ${JSON.stringify(updatedGame)}`,
        );
      } else {
        addScannedGame(await applyImportStatus(game));
      }
    });

    window.electronAPI.onScanCompleteFinal(async (games) => {
      console.log(`Scan complete, received ${games.length} games`);
      const visibleGamesList = await Promise.all(
        games
          .filter(
            (game) => !deletedScanGameKeysRef.current.has(getScanGameKey(game)),
          )
          .map((game) =>
            game.scanStatus === "pendingMatch" ? game : applyImportStatus(game),
          ),
      );
      setGamesList(visibleGamesList);
      setView("scan");
      resolvePendingMatches(visibleGamesList);
      console.log(
        `Updated gamesList on scan complete: ${JSON.stringify(visibleGamesList)}`,
      );
      window.electronAPI.log(
        `Updated gamesList on scan complete: ${JSON.stringify(visibleGamesList)}`,
      );
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
        const metadataSettings = config.Metadata || {};
        const shouldDownloadMedia =
          metadataSettings.mediaStorageMode === "download";
        setGameExt(
          librarySettings.gameExtensions ||
            "exe,swf,flv,f4v,rag,cmd,bat,jar,html",
        );
        setArchiveExt(librarySettings.extractionExtensions || "zip,7z,rar");
        setLibraryFormat(
          librarySettings.libraryFolderStructure ||
            "{creator}/{title}/{version}",
        );
        const shouldAutoSelectLatestReplaceVersion =
          librarySettings.autoSelectLatestReplaceVersion === true ||
          librarySettings.autoSelectLatestReplaceVersion === "true";
        autoSelectLatestReplaceVersionRef.current =
          shouldAutoSelectLatestReplaceVersion;
        setAutoSelectLatestReplaceVersion(shouldAutoSelectLatestReplaceVersion);
        setDownloadBannerImages(shouldDownloadMedia);
        setDownloadPreviewImages(shouldDownloadMedia);

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
    deletedScanGameKeysRef.current.clear();
    setGamesList([]);
    const params = {
      folder,
      mode: "local",
      deferMatching: true,
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
    setGamesList((prev) => {
      const game = prev[index];
      if (game) {
        deletedScanGameKeysRef.current.add(getScanGameKey(game));
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleResultChange = async (index, value) => {
    console.log(`Handling result change for index ${index}, value ${value}`);
    window.electronAPI.log(
      `Handling result change for index ${index}, value ${value}`,
    );
    const updatedGames = gamesList.map((game, i) => {
      if (i === index) {
        return applySelectedMatch(game, value).then((updatedGame) => {
          console.log(
            `Updated game at index ${index}: ${JSON.stringify(updatedGame)}`,
          );
          window.electronAPI.log(
            `Updated game at index ${index}: ${JSON.stringify(updatedGame)}`,
          );
          return updatedGame;
        });
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

    setProgressLabel("Updating Matches");
    setProgress((prev) => ({ ...prev, value: 0, total }));
    await new Promise((r) => setTimeout(r, 16));
    window.electronAPI.sendUpdateProgress({ value: 0, total });

    // Create a fresh immutable copy of the list
    let updatedGames = gamesList.map((game) => ({ ...game }));

    for (let i = 0; i < updatedGames.length; i++) {
      // Fresh copy of this game object
      let game = { ...updatedGames[i] };

      if (!isNewScanRow(game) && game.scanStatus !== "pendingMatch") {
        setProgress((prev) => ({ ...prev, value: i + 1 }));
        window.electronAPI.sendUpdateProgress({ value: i + 1, total });
        await new Promise((r) => setTimeout(r, 0));
        continue;
      }

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
        setProgress((prev) => ({ ...prev, value: i + 1 }));
        window.electronAPI.sendUpdateProgress({ value: i + 1, total });
        await new Promise((r) => setTimeout(r, 0));
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
        game = await applyImportStatus({
          ...game,
          atlasId: String(data[0].atlas_id),
          f95Id: data[0].f95_id || "",
          title: data[0].title,
          creator: data[0].creator,
          engine: data[0].engine || game.engine || "Unknown",
          latestVersion: data[0].latestVersion || "",
          results: [{ key: "match", value: "Match Found" }],
          resultSelectedValue: "match",
          resultVisibility: "visible",
        });
      } else if (data.length > 1) {
        const results = data.map((d) => ({
          key: String(d.atlas_id),
          value: `${d.atlas_id} | ${d.f95_id || ""} | ${d.title} | ${d.creator}`,
        }));

        const current = game.resultSelectedValue;
        const valid = results.find((r) => r.key === current);
        const selectedKey = valid ? current : results[0].key;

        game = await chooseInstalledMatch(
          { ...game, resultSelectedValue: selectedKey },
          results,
        );
      } else {
        game = await applyImportStatus({
          ...game,
          atlasId: "",
          f95Id: "",
          results: [],
          resultSelectedValue: "",
          resultVisibility: "hidden",
        });
      }

      // Put new object back
      updatedGames[i] = game;

      // Progress
      setProgress((prev) => ({ ...prev, value: i + 1 }));
      window.electronAPI.sendUpdateProgress({ value: i + 1, total });

      // Breathing room for UI
      await new Promise((r) => setTimeout(r, 50));
    }

    // One final state update
    setGamesList(updatedGames);
    console.log("All matches processed — final list set");
    window.electronAPI.log("All matches processed — final list set");

    setProgress((prev) => ({ ...prev, value: total }));
    window.electronAPI.sendUpdateProgress({ value: total, total });
    setProgressLabel(null);
  };

  const importGamesFunc = async () => {
    const gamesToImport = gamesList.filter((game) =>
      isImportableGame(game, importOptions),
    );

    if (gamesToImport.length === 0) {
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
      games: gamesToImport,
      deleteAfter,
      scanSize,
      downloadBannerImages,
      downloadPreviewImages,
      previewLimit,
      downloadVideos,
      gameExt: gameExt.split(",").map((e) => e.trim()),
      moveToDefaultFolder: moveGame && !!finalLibraryPath,
      forceReimport,
      libraryFormat,
    };

    try {
      // Start import in background
      window.electronAPI.importGames(importParams);
      console.log("Import request sent successfully");

      // Immediately close the importer window
      window.electronAPI.closeWindow();
    } catch (err) {
      console.error("Import failed:", err);
      window.electronAPI.log(`Import failed: ${err.message}`);
      alert(`Import failed: ${err.message || "Unknown error"}`);
    }
  };

  const handleUpdateClick = (event) => {
    console.log("Update button clicked", event);
    window.electronAPI.log("Update button clicked");
    updateMatches();
  };

  const sortedRows = useMemo(() => {
    const rows = gamesList
      .map((game, originalIndex) => ({ game, originalIndex }))
      .filter(({ game }) => {
        if (
          hideMatches &&
          game.results?.length === 1 &&
          game.results[0]?.value === "Match Found"
        ) {
          return false;
        }

        return true;
      });

    if (!sortConfig.key) return rows;

    return [...rows].sort((a, b) =>
      compareRows(a, b, sortConfig.key, sortConfig.direction),
    );
  }, [gamesList, hideMatches, sortConfig]);

  const renderSortableHeader = (sortKey, label, className = "") => (
    <th
      className={`border border-border p-1 cursor-pointer select-none hover:bg-tertiary ${className}`}
      onClick={() => handleSort(sortKey)}
      title="Click to sort"
    >
      {label}
      {getSortIndicator(sortKey)}
    </th>
  );

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
                onClick={() => {
                  setView("settings");
                }}
                className="bg-secondary hover:bg-selected text-text p-2 rounded"
              >
                Atlas Game Importer
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
                title="When enabled, Atlas infers title and version from folder/archive names. When disabled, Atlas reads the path using the Folder Structure template."
              />
              <label title="When enabled, Atlas infers title and version from folder/archive names. When disabled, Atlas reads the path using the Folder Structure template.">
                Unstructured Format
              </label>
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
              Source folder structure options:{" "}
              <span className="font-semibold">Title</span>,{" "}
              <span className="font-semibold">Creator</span>,{" "}
              <span className="font-semibold">Engine</span>, and{" "}
              <span className="font-semibold">Version</span>.<br />- Enclose
              each option in braces, e.g.,{" "}
              <span className="font-mono">{"{Title}"}</span>. Use{" "}
              <span className="font-mono">/</span> for folder separators.
              This describes the folder being scanned. Atlas Library destination
              structure is configured separately in Settings.
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
              <br />
              Atlas Library Structure also supports{" "}
              <span className="font-mono">{"{f95Id}"}</span>, for example{" "}
              <span className="font-mono">
                {"{f95Id}/{creator}/{title}/{version}"}
              </span>
              .
            </p>

            <div className="space-y-2">
              <div>
                <input
                  type="checkbox"
                  checked={downloadBannerImages}
                  onChange={(e) => setDownloadBannerImages(e.target.checked)}
                />
                <label>Download banner images to local storage</label>
              </div>
              <div>
                <input
                  type="checkbox"
                  checked={downloadPreviewImages}
                  onChange={(e) => setDownloadPreviewImages(e.target.checked)}
                />
                <label>
                  Download preview images to local storage{" "}
                  {previewLimit === "Unlimited"
                    ? "(all available)"
                    : `(limit: ${previewLimit})`}
                </label>
              </div>

              <div className="mt-4">
                <input
                  type="checkbox"
                  checked={moveGame}
                  onChange={(e) => setMoveGame(e.target.checked)}
                  className="mr-2"
                />
                <label className="font-medium">
                  Move imported games to default library folder
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
              <div className="mt-4">
                <input
                  type="checkbox"
                  checked={deleteAfter}
                  onChange={(e) => setDeleteAfter(e.target.checked)}
                  className="mr-2"
                  disabled={!moveGame} // Optional: only enable if move is on
                />
                <label className="font-medium">
                  Delete original folder/archive after successful import
                </label>
                {!moveGame && (
                  <div className="mt-1 ml-6 text-sm text-gray-500">
                    (Enable "Move imported games" first)
                  </div>
                )}
              </div>
              <div className="mt-4">
                <input
                  type="checkbox"
                  checked={autoSelectLatestReplaceVersion}
                  onChange={handleAutoSelectLatestReplaceVersionChange}
                  className="mr-2"
                />
                <label className="font-medium">
                  Auto-select latest installed version for replacement
                </label>
                <div className="mt-1 ml-6 text-sm text-gray-500">
                  Preselects the newest installed version in Replace Version
                  dropdowns. You can still change it to None before importing.
                </div>
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
                  {progressLabel ?? "Folders Scanned"}
                </span>
              </div>
              <div className="mb-4 flex flex-wrap gap-4 text-sm">
                <span>Ready {progress.potential || 0}</span>
                <span>Pending matches {progress.pendingMatch || 0}</span>
                <span>Archives {progress.archives || 0}</span>
                <span>Already imported {progress.alreadyImported || 0}</span>
                <span>Repairs {progress.repairPath || 0}</span>
                <span>Missing launchable {progress.missingLaunchable || 0}</span>
                <span>Empty folders {progress.emptyFolder || 0}</span>
                <span>Total rows {progress.totalFound || gamesList.length}</span>
              </div>
            </div>

            <div className="flex-1 overflow-x-auto">
              <table
                className="border-collapse border border-border"
                style={{ minWidth: "1380px" }}
              >
                <thead>
                  <tr className="bg-secondary sticky top-0">
                    {renderSortableHeader("atlasId", "Atlas ID", "min-w-[80px]")}
                    {renderSortableHeader("f95Id", "F95 ID", "min-w-[80px]")}
                    {renderSortableHeader("title", "Title", "min-w-[200px]")}
                    {renderSortableHeader(
                      "creator",
                      "Creator",
                      "min-w-[150px]",
                    )}
                    {renderSortableHeader("engine", "Engine", "min-w-[100px]")}
                    {renderSortableHeader("version", "Version", "min-w-[200px]")}
                    {renderSortableHeader(
                      "replaceVersion",
                      "Replace Version",
                      "min-w-[180px]",
                    )}
                    {renderSortableHeader(
                      "executable",
                      "Executable",
                      "min-w-[180px]",
                    )}
                    {renderSortableHeader(
                      "databaseMatch",
                      "Possible Database Matches",
                      "min-w-[220px] !max-w-[220px]",
                    )}
                    {renderSortableHeader("source", "Source", "min-w-[250px]")}
                    {renderSortableHeader("status", "Status", "min-w-[150px]")}
                    <th className="border border-border p-1 min-w-[150px]">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map(({ game, originalIndex }) => {
                    const rowIsNew = isNewScanRow(game);
                    const statusText =
                      game.scanMessage ||
                      (rowIsNew ? "Ready to import" : "Skipped");
                    const statusClass =
                      game.scanStatus === "alreadyImported"
                        ? "text-yellow-300"
                        : game.scanStatus === "pendingMatch"
                          ? "text-blue-200"
                        : game.scanStatus === "emptyFolder"
                          ? "text-gray-300"
                        : game.scanStatus === "repairPath"
                          ? "text-cyan-300"
                        : game.isArchive
                          ? "text-blue-300"
                          : game.scanStatus === "missingLaunchable"
                            ? "text-red-300"
                            : "text-green-300";
                    return (
                      <tr
                        key={getScanGameKey(game) || originalIndex}
                        className="bg-primary"
                      >
                        <td className="border border-border p-1 min-w-[100px]">
                          {game.results?.length > 1 && (
                            <i className="fa-solid fa-triangle-exclamation text-yellow-400 mr-1"></i>
                          )}
                          {game.atlasId}
                        </td>
                        <td className="border border-border p-1 min-w-[100px]">
                          <input
                            value={game.f95Id}
                            disabled={!rowIsNew}
                            onChange={(e) =>
                              updateGame(originalIndex, "f95Id", e.target.value)
                            }
                            className="w-full bg-secondary border border-border p-1"
                          />
                        </td>
                        <td className="border border-border p-1">
                          <input
                            value={game.title}
                            disabled={!rowIsNew}
                            onChange={(e) =>
                              updateGame(originalIndex, "title", e.target.value)
                            }
                            className="w-full bg-secondary border border-border p-1"
                          />
                        </td>
                        <td className="border border-border p-1">
                          <input
                            value={game.creator}
                            disabled={!rowIsNew}
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
                            disabled={!rowIsNew}
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
                            disabled={!rowIsNew}
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
                          <select
                            value={game.replaceVersion || ""}
                            disabled={!rowIsNew || !game.replaceOptions?.length}
                            onChange={(e) =>
                              updateGame(
                                originalIndex,
                                "replaceVersion",
                                e.target.value,
                              )
                            }
                            className="w-full bg-secondary border border-border p-1"
                            title={
                              game.replaceOptions?.length
                                ? "Optionally delete this installed version after the new import succeeds"
                                : "No installed versions available to replace"
                            }
                          >
                            <option value="">None</option>
                            {(game.replaceOptions || []).map((version) => (
                              <option
                                key={version.version}
                                value={version.version}
                              >
                                {version.version}
                                {version.date_added
                                  ? ` - ${new Date(
                                      version.date_added * 1000,
                                    ).toLocaleDateString()}`
                                  : ""}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="border border-border p-1">
                          {game.multipleVisible === "visible" ? (
                            <select
                              value={game.selectedValue}
                              disabled={!rowIsNew}
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
                          {game.results?.length === 1 &&
                          game.results[0]?.key === "match" ? (
                            <span className="text-text select-none">
                              {game.results[0].value}
                            </span>
                          ) : (
                            game.results?.length > 1 && (
                              <select
                                value={game.resultSelectedValue}
                                disabled={!rowIsNew}
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
                          {game.isArchive
                            ? game.sourceFile || game.folder || "Archive"
                            : game.folder || "Metadata only"}
                        </td>
                        <td className={`border border-border p-1 ${statusClass}`}>
                          {statusText}
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
                              window.electronAPI.openDirectory(
                                game.folder || game.sourceFile,
                              )
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

            <div className="flex justify-between items-center space-x-4 mt-4">
              {/* Left: Import filters */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="include-unmatched"
                    checked={includeUnmatched}
                    onChange={(e) => setIncludeUnmatched(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <label
                    htmlFor="include-unmatched"
                    className="text-sm text-text"
                  >
                    Import unmatched games
                  </label>
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="include-archives"
                    checked={includeArchives}
                    onChange={(e) => setIncludeArchives(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <label
                    htmlFor="include-archives"
                    className="text-sm text-text"
                  >
                    Extract and import archives
                  </label>
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="force-reimport"
                    checked={forceReimport}
                    onChange={(e) => setForceReimport(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <label
                    htmlFor="force-reimport"
                    className="text-sm text-text"
                    title="Safely repairs existing rows and refreshes selected media without creating duplicate game records."
                  >
                    Force re-import existing games
                  </label>
                </div>
              </div>

              {/* Right: All buttons grouped together */}
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleUpdateClick}
                  disabled={isResolvingMatches}
                  className="bg-accent hover:bg-accent-dark px-4 py-2 rounded text-text"
                  style={{ pointerEvents: "auto", zIndex: 1000 }}
                >
                  {isResolvingMatches ? "Resolving..." : "Update Matches"}
                </button>

                {isResolvingMatches && (
                  <button
                    onClick={cancelScanOrMatch}
                    className="bg-red-700 hover:bg-red-800 px-4 py-2 rounded text-white"
                    style={{ pointerEvents: "auto", zIndex: 1000 }}
                  >
                    Stop Matching
                  </button>
                )}

                <button
                  onClick={() => setHideMatches(!hideMatches)}
                  className="bg-tertiary hover:bg-selected px-4 py-2 rounded text-text"
                  style={{ pointerEvents: "auto", zIndex: 1000 }}
                >
                  {hideMatches ? "Show All" : "Hide Matches"}
                </button>

                <button
                  onClick={importGamesFunc}
                  disabled={!canImport}
                  className={`px-6 py-2 rounded font-medium transition-colors ${
                    canImport
                      ? "bg-green-600 hover:bg-green-700 text-white"
                      : "bg-gray-600 cursor-not-allowed opacity-70 text-gray-300"
                  }`}
                  title={getImportDisabledReason()}
                  style={{
                    pointerEvents: "auto",
                  }}
                >
                  Import
                </button>

                <button
                  onClick={() => window.electronAPI.closeWindow()}
                  className="bg-red-700 hover:bg-red-800 px-6 py-2 rounded text-white"
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
