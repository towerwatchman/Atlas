import { useState, useEffect, useRef, useCallback } from 'react'
import { saveLibrarySetting, saveLibrarySettings, pickGameFolder } from '../../utils/librarySettings.js'

// Library.jsx  (updated)
//
// The read-modify-write for config.Library and the game-folder picker both moved
// to utils/librarySettings.js. This page is no longer the only thing that writes
// these keys — the install flow raises its own prompts for gameFolder and
// libraryFolderStructure (see src/components/downloads/LibraryFolderModal.jsx and
// LibraryStructureModal.jsx) — and a second picker written alongside this one
// would drift from it the first time either grew a rule.
const Library = () => {
  const [rootPath, setRootPath] = useState("");
  const [gameFolder, setGameFolder] = useState("");
  const [downloadsFolder, setDownloadsFolder] = useState("");
  const [gameExtensions, setGameExtensions] = useState(
    "exe,swf,flv,f4v,rag,cmd,bat,jar,html",
  );
  const [libraryFolderStructure, setLibraryFolderStructure] = useState(
    "{creator}/{title}/{version}",
  );
  const [extractionExtensions, setExtractionExtensions] =
    useState("zip,7z,rar");
  const [sevenZipPath, setSevenZipPath] = useState(""); // ← added
  const [sevenZipStatus, setSevenZipStatus] = useState("");
  const [detectingSevenZip, setDetectingSevenZip] = useState(false);
  const [autoInstallPrompt, setAutoInstallPrompt] = useState(false);
  const [autoSelectLatestReplaceVersion, setAutoSelectLatestReplaceVersion] =
    useState(false);
  const [validatePathsOnStartup, setValidatePathsOnStartup] = useState(false);
  const [validationMessage, setValidationMessage] = useState("");

  useEffect(() => {
    window.electronAPI.getConfig().then((config) => {
      const lib = config.Library || {};
      setRootPath(lib.rootPath || "./data");
      setGameFolder(lib.gameFolder || "");
      setDownloadsFolder(lib.downloadsFolder || "");
      setGameExtensions(
        lib.gameExtensions || "exe,swf,flv,f4v,rag,cmd,bat,jar,html",
      );
      setLibraryFolderStructure(
        lib.libraryFolderStructure || "{creator}/{title}/{version}",
      );
      setExtractionExtensions(lib.extractionExtensions || "zip,7z,rar");
      setSevenZipPath(lib.sevenZipPath || ""); // ← added
      setAutoInstallPrompt(
        lib.autoInstallPrompt === true || lib.autoInstallPrompt === "true",
      );
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

  const handleSetGameFolder = async () => {
    // pickGameFolder persists the choice itself, so there is no saveLibrarySetting
    // call here — that is the point of sharing it. An empty return is a cancelled
    // dialog and must not clear a folder that is already set.
    const path = await pickGameFolder();
    if (path) setGameFolder(path);
  };

  const handleSetDownloadsFolder = async () => {
    const path = await window.electronAPI.selectDirectory();
    if (path) {
      setDownloadsFolder(path);
      saveLibrarySetting("downloadsFolder", path);
    }
  };

  // Clearing falls back to the OS downloads directory rather than to a folder
  // inside the library, which must never hold in-progress archives.
  const handleClearDownloadsFolder = () => {
    setDownloadsFolder("");
    saveLibrarySetting("downloadsFolder", "");
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

  // The same lookup runs automatically on first launch (see
  // electron/utils/sevenZipDetect.js), so this button matters when 7-Zip was
  // installed after Atlas, or when the saved path pointed at a binary that has
  // since been removed. It writes config.ini itself, so no saveLibrarySetting.
  const handleDetectSevenZip = async () => {
    if (detectingSevenZip) return;
    setDetectingSevenZip(true);
    setSevenZipStatus("Looking for 7-Zip...");
    try {
      const result = await window.electronAPI.detectSevenZip?.();
      if (result?.success && result.path) {
        setSevenZipPath(result.path);
        setSevenZipStatus(`Found 7-Zip at ${result.path}`);
      } else {
        setSevenZipStatus(
          "No 7-Zip install found. Atlas will use its bundled extractor, which cannot open .rar archives.",
        );
      }
    } catch (err) {
      setSevenZipStatus(`Detection failed: ${err?.message || err}`);
    } finally {
      setDetectingSevenZip(false);
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
    // structurePrompted goes along with it. Someone editing this field has plainly
    // found the setting on their own, and raising the first-install prompt at them
    // afterwards would be asking a question they have already answered — with
    // presets that are narrower than whatever they just typed.
    saveLibrarySettings({
      libraryFolderStructure: val,
      structurePrompted: true,
    });
  };

  const handleExtractionChange = (e) => {
    const val = e.target.value;
    setExtractionExtensions(val);
    saveLibrarySetting("extractionExtensions", val);
  };

  const handleAutoInstallPromptChange = (e) => {
    const checked = e.target.checked;
    setAutoInstallPrompt(checked);
    saveLibrarySetting("autoInstallPrompt", checked);
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

      {/* Downloads Folder */}
      <div>
        <label className="block mb-1">Downloads Folder</label>
        <div className="flex gap-3">
          <input
            type="text"
            className="flex-1 bg-secondary border border-border p-2 rounded"
            value={downloadsFolder}
            placeholder="Default: your system Downloads folder"
            readOnly
          />
          <button
            onClick={handleSetDownloadsFolder}
            className="bg-accent px-5 py-2 rounded hover:bg-accentHover"
          >
            Set Folder
          </button>
          {downloadsFolder && (
            <button
              onClick={handleClearDownloadsFolder}
              className="bg-button px-4 py-2 rounded hover:bg-buttonHover"
            >
              Reset
            </button>
          )}
        </div>
        <p className="text-xs opacity-60 mt-1">
          Where downloaded archives are saved before they are installed. Keep
          this separate from the game folder &mdash; that one is scanned for
          installed games, and in-progress downloads sitting there get picked up
          as titles.
        </p>
      </div>

      {/* Sits with the downloads folder rather than with the other install
          options below, because it is about what happens when a DOWNLOAD ends —
          someone looking for it will be looking here. */}
      <div className="border border-border bg-primary/40 p-3 rounded">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={autoInstallPrompt}
            onChange={handleAutoInstallPromptChange}
          />
          <span>Ask to install when a download finishes</span>
        </label>
        <p className="text-xs opacity-60 mt-1">
          Opens the install dialog on its own instead of waiting for you to press
          Install on the Downloads page. It still asks &mdash; the version and
          which build to replace are yours to confirm, nothing installs
          unattended. If another dialog is already open, this waits its turn.
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
          Checks every installed game path shortly after launch, and repairs
          version executables that have been renamed. Leave this off if your
          games live on a mechanical drive or a network share — the check is
          thousands of individual disk lookups on a large library, and they are
          slowest right after a reboot. With it off, Atlas only checks versions
          that have no executable recorded at all.
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
        {/* Stacks on narrow windows so neither button is clipped. */}
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            className="flex-1 min-w-0 bg-secondary border border-border p-2 rounded"
            value={
              sevenZipPath ||
              "(not set — no 7-Zip install detected)"
            }
            readOnly
          />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleDetectSevenZip}
              disabled={detectingSevenZip}
              className="flex-1 sm:flex-none bg-secondary border border-border px-5 py-2 rounded hover:bg-primary disabled:opacity-50"
            >
              {detectingSevenZip ? "Detecting..." : "Detect"}
            </button>
            <button
              type="button"
              onClick={handleSetSevenZip}
              className="flex-1 sm:flex-none bg-accent px-5 py-2 rounded hover:bg-accentHover"
            >
              Select 7z
            </button>
          </div>
        </div>
        {sevenZipStatus && (
          <p className="text-xs opacity-70 mt-1 break-all">{sevenZipStatus}</p>
        )}
        <p className="text-xs opacity-60 mt-1">
          Required for fast .7z extraction and for .rar archives, which the
          bundled extractor cannot open. Atlas fills this in automatically on
          first launch if 7-Zip is already installed — use Detect after
          installing it, or Select 7z to point at a copy Atlas missed.
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
