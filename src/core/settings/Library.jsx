// Library.jsx  (updated)
const Library = () => {
  const [rootPath, setRootPath] = React.useState("");
  const [gameFolder, setGameFolder] = React.useState("");
  const [gameExtensions, setGameExtensions] = React.useState(
    "exe,swf,flv,f4v,rag,cmd,bat,jar,html",
  );
  const [extractionExtensions, setExtractionExtensions] =
    React.useState("zip,7z,rar");
  const [sevenZipPath, setSevenZipPath] = React.useState(""); // ← added

  React.useEffect(() => {
    window.electronAPI.getConfig().then((config) => {
      const lib = config.Library || {};
      setRootPath(lib.rootPath || "./data");
      setGameFolder(lib.gameFolder || "");
      setGameExtensions(
        lib.gameExtensions || "exe,swf,flv,f4v,rag,cmd,bat,jar,html",
      );
      setExtractionExtensions(lib.extractionExtensions || "zip,7z,rar");
      setSevenZipPath(lib.sevenZipPath || ""); // ← added
    });
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

  const handleExtractionChange = (e) => {
    const val = e.target.value;
    setExtractionExtensions(val);
    saveLibrarySetting("extractionExtensions", val);
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
      <div>
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
            className="bg-accent px-5 py-2 rounded hover:bg-opacity-90"
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
            className="bg-accent px-5 py-2 rounded hover:bg-opacity-90"
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

window.Library = Library;
