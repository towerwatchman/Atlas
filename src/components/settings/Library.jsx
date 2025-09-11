const Library = () => {
  const [rootPath, setRootPath] = React.useState('');
  const [gameFolder, setGameFolder] = React.useState('');

  React.useEffect(() => {
    window.electronAPI.getConfig().then((config) => {
      const librarySettings = config.Library || {};
      setRootPath(librarySettings.rootPath || './data');
      setGameFolder(librarySettings.gameFolder || '');
    });
  }, []);

  const saveSettings = (updatedSettings) => {
    window.electronAPI.getConfig().then((config) => {
      const newConfig = { ...config, Library: { ...config.Library, ...updatedSettings } };
      window.electronAPI.saveSettings(newConfig);
    });
  };

  const handleSetGameFolder = async () => {
    const path = await window.electronAPI.selectDirectory();
    if (path) {
      setGameFolder(path);
      saveSettings({ gameFolder: path });
    }
  };

  const handleGameFolderChange = (e) => {
    setGameFolder(e.target.value);
    saveSettings({ gameFolder: e.target.value });
  };

  return (
    <div className="p-5 text-text">
      <div className="flex items-center mb-2 h-8">
        <label className="w-24 text-left mr-2">Root Path:</label>
        <input
          type="text"
          className="flex-1 bg-secondary border border-border text-text rounded p-1 opacity-75"
          value={rootPath}
          readOnly
        />
      </div>
      <p className="text-xs opacity-50 mb-2">Atlas local path. This is dynamic and will change if you move the program.</p>
      <div className="border-t border-text opacity-25 my-2"></div>
      <div className="flex items-center mb-2 h-8">
        <label className="w-24 text-left mr-2">Game Folder:</label>
        <input
          type="text"
          className="flex-1 bg-secondary border border-border text-text rounded p-1"
          value={gameFolder}
          onChange={handleGameFolderChange}
        />
        <button
          className="ml-5 bg-accent text-text px-4 py-1 rounded hover:bg-hover"
          onClick={handleSetGameFolder}
        >
          Set Folder
        </button>
      </div>
      <p className="text-xs opacity-50 mb-2">All extracted or moved games will go here</p>
      <div className="border-t border-text opacity-25 my-2"></div>
    </div>
  );
};

window.Library = Library;