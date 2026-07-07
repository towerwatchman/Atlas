import { useState, useEffect, useRef, useCallback } from 'react'
// Library.jsx  (updated)
const Library = () => {
  const [rootPath, setRootPath] = useState("");
  const [gameFolder, setGameFolder] = useState("");
  const [gameExtensions, setGameExtensions] = useState(
    "exe,swf,flv,f4v,rag,cmd,bat,jar,html",
  );
  const [libraryFolderStructure, setLibraryFolderStructure] = useState(
    "{creator}/{title}/{version}",
  );
  const [extractionExtensions, setExtractionExtensions] =
    useState("zip,7z,rar");
  const [sevenZipPath, setSevenZipPath] = useState(""); // ← added
  const [autoSelectLatestReplaceVersion, setAutoSelectLatestReplaceVersion] =
    useState(false);
  const [validatePathsOnStartup, setValidatePathsOnStartup] = useState(false);
  const [validationMessage, setValidationMessage] = useState("");

  useEffect(() => {
    window.electronAPI.getConfig().then((config) => {
      const lib = config.Library || {};
      setRootPath(lib.rootPath || "./data");
      setGameFolder(lib.gameFolder || "");
      setGameExtensions(
        lib.gameExtensions || "exe,swf,flv,f4v,rag,cmd,bat,jar,html",
      );
      setLibraryFolderStructure(
        lib.libraryFolderStructure || "{creator}/{title}/{version}",
      );
      setExtractionExtensions(lib.extractionExtensions || "zip,7z,rar");
      setSevenZipPath(lib.sevenZipPath || ""); // ← added
      setAutoSelectLatestReplaceVersion(
        lib.autoSelectLatestReplaceVersion === true ||
          lib.autoSelectLatestReplaceVersion === "true",
      );
      setValidatePathsOnStartup(
        lib.validatePathsOnStartup === true ||
          lib.validatePathsOnStartup === "true",
      );
    });

    window.electronAPI.onLibraryValidationProgress?.((progress) => {
      if (progress?.error) {
        setValidationMessage(`Library path validation failed: ${progress.error}`);
        return;
      }
      if (!progress?.total) return;
      if (progress.processed >= progress.total) {
        setValidationMessage("Library path validation complete");
      } else {
        setValidationMessage(`Validating installed paths... ${progress.processed} / ${progress.total}`);
      }
    });
    return () => window.electronAPI.removeAllListeners?.("library-validation-progress");
  }, []);

  const saveLibrarySetting = (key, value) => {
    window.electronAPI.getConfig().then((config) => {
      const newConfig = {
        ...config,
        Library: {
          ...config.Library,
          [key]: value,
        },
      };
      window.electronAPI.saveSettings(newConfig);
    });
  };

  const handleSetGameFolder = async () => {
    const path = await window.electronAPI.selectDirectory();
    if (path) {
      setGameFolder(path);
      saveLibrarySetting("gameFolder", path);
    }
  };

  const handleSetSevenZip = async () => {
    const filters = [
      { name: "7z executable", extensions: ["exe"] }, // Windows
      { name: "All files", extensions: ["*"] }, // Linux/macOS fallback
    ];

    // On Linux we usually want no extension filter
    const isWindows = await window.electronAPI.isWindows?.(); // you'll add this helper
    const result = await window.electronAPI.selectFile(
      isWindows ? filters : [],
    );

    if (result) {
      setSevenZipPath(result);
      saveLibrarySetting("sevenZipPath", result);
    }
  };

  // ── Handlers for other fields ──
  const handleGameExtensionsChange = (e) => {
    const val = e.target.value;
    setGameExtensions(val);
    saveLibrarySetting("gameExtensions", val);
  };

  const handleLibraryFolderStructureChange = (e) => {
    const val = e.target.value;
    setLibraryFolderStructure(val);
    saveLibrarySetting("libraryFolderStructure", val);
  };

  const handleExtractionChange = (e) => {
    const val = e.target.value;
    setExtractionExtensions(val);
    saveLibrarySetting("extractionExtensions", val);
  };

  const handleAutoSelectLatestReplaceVersionChange = (e) => {
    const checked = e.target.checked;
    setAutoSelectLatestReplaceVersion(checked);
    saveLibrarySetting("autoSelectLatestReplaceVersion", checked);
  };

  const handleValidatePathsOnStartupChange = (e) => {
    const checked = e.target.checked;
    setValidatePathsOnStartup(checked);
    saveLibrarySetting("validatePathsOnStartup", checked);
  };

  const handleValidateLibraryPaths = async () => {
    setValidationMessage("Validating installed paths...");
    try {
      const result = await window.electronAPI.validateLibraryPaths?.();
      if (result?.alreadyRunning) {
        setValidationMessage("Library path validation is already running");
      } else if (result?.success) {
        setValidationMessage("Library path validation started");
      } else {
        setValidationMessage(`Library path validation failed: ${result?.error || "Unknown error"}`);
      }
    } catch (err) {
      setValidationMessage(`Library path validation failed: ${err.message || "Unknown error"}`);
    }
  };

  return (
    <div className="p-5 text-text space-y-6">
      {/* Root Path */}
      <div>
        <label className="block mb-1">Root Path</label>
        <input
          type="text"
          className="w-full bg-secondary border border-border p-2 rounded opacity-75"
          value={rootPath}
          readOnly
        />
        <p className="text-xs opacity-60 mt-1">
          Atlas internal data path (changes if app is moved).
        </p>
      </div>

      {/* Default Game Folder */}
      <div data-tour="LibraryFolder">
        <label className="block mb-1">Default Game Folder</label>
        <div className="flex gap-3">
          <input
            type="text"
            className="flex-1 bg-secondary border border-border p-2 rounded"
            value={gameFolder}
            readOnly
          />
          <button
            onClick={handleSetGameFolder}
            className="bg-accent px-5 py-2 rounded hover:bg-accentHover"
          >
            Set Folder
          </button>
        </div>
        <p className="text-xs opacity-60 mt-1">
          Newly imported / extracted games will be placed here.
        </p>
      </div>

      {/* 7-Zip Path – NEW */}
      <div>
        <label className="block mb-1">Atlas Library Structure</label>
        <input
          type="text"
          className="w-full bg-secondary border border-border p-2 rounded"
          value={libraryFolderStructure}
          onChange={handleLibraryFolderStructureChange}
        />
        <p className="text-xs opacity-60 mt-1">
          Used when imports are moved or archives are extracted into the default
          library folder. Options: {"{creator}"}, {"{title}"}, {"{version}"},{" "}
          {"{engine}"}, {"{f95Id}"}.
          <br />
          Example: {"{f95Id}/{creator}/{title}/{version}"}
        </p>
      </div>

      <div className="border border-border bg-primary/40 p-3 rounded">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={autoSelectLatestReplaceVersion}
            onChange={handleAutoSelectLatestReplaceVersionChange}
          />
          <span>Auto-select latest installed version for replacement</span>
        </label>
        <p className="text-xs opacity-60 mt-1">
          When importing a new version of an existing title, automatically
          preselect the newest installed version in the Replace Version
          dropdown. You can still change it to None before importing.
        </p>
      </div>

      <div className="border border-border bg-primary/40 p-3 rounded space-y-3">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={validatePathsOnStartup}
            onChange={handleValidatePathsOnStartupChange}
          />
          <span>Validate installed paths on startup</span>
        </label>
        <p className="text-xs opacity-60">
          Checks every installed game path on launch. Disable for faster startup
          on large libraries.
        </p>
        <button
          type="button"
          onClick={handleValidateLibraryPaths}
          className="bg-accent px-5 py-2 rounded hover:bg-accentHover"
        >
          Validate Library Paths
        </button>
        {validationMessage && (
          <p className="text-xs opacity-70">{validationMessage}</p>
        )}
      </div>

      <div>
        <label className="block mb-1">7-Zip Executable Path</label>
        <div className="flex gap-3">
          <input
            type="text"
            className="flex-1 bg-secondary border border-border p-2 rounded"
            value={
              sevenZipPath ||
              "(not set — will be asked during first extraction)"
            }
            readOnly
          />
          <button
            onClick={handleSetSevenZip}
            className="bg-accent px-5 py-2 rounded hover:bg-accentHover"
          >
            Select 7z
          </button>
        </div>
        <p className="text-xs opacity-60 mt-1">
          Required for fast .7z / .rar extraction. Common locations:
          <br />
          Windows: C:\Program Files\7-Zip\7z.exe
          <br />
          Linux: /usr/bin/7z or /usr/bin/7zz
        </p>
      </div>

      {/* Game & Archive Extensions */}
      <div>
        <label className="block mb-1">Game Extensions (comma separated)</label>
        <input
          type="text"
          className="w-full bg-secondary border border-border p-2 rounded"
          value={gameExtensions}
          onChange={handleGameExtensionsChange}
        />
      </div>

      <div>
        <label className="block mb-1">
          Archive Extensions (comma separated)
        </label>
        <input
          type="text"
          className="w-full bg-secondary border border-border p-2 rounded"
          value={extractionExtensions}
          onChange={handleExtractionChange}
        />
      </div>
    </div>
  );
};

export default Library
