const Interface = () => {
  const [language, setLanguage] = React.useState('English');
  const [atlasStartup, setAtlasStartup] = React.useState('Do Nothing');
  const [gameStartup, setGameStartup] = React.useState('Do Nothing');
  const [showDebugConsole, setShowDebugConsole] = React.useState(false);
  const [minimizeToTray, setMinimizeToTray] = React.useState(false);

  React.useEffect(() => {
    window.electronAPI.getConfig().then((config) => {
      const interfaceSettings = config.Interface || {};
      setLanguage(interfaceSettings.language || 'English');
      setAtlasStartup(interfaceSettings.atlasStartup || 'Do Nothing');
      setGameStartup(interfaceSettings.gameStartup || 'Do Nothing');
      setShowDebugConsole(interfaceSettings.showDebugConsole || false);
      setMinimizeToTray(interfaceSettings.minimizeToTray || false);
    });
  }, []);

  const saveSettings = (updatedSettings) => {
    window.electronAPI.getConfig().then((config) => {
      const newConfig = { ...config, Interface: { ...config.Interface, ...updatedSettings } };
      window.electronAPI.saveSettings(newConfig);
    });
  };

  const handleLanguageChange = (e) => {
    setLanguage(e.target.value);
    saveSettings({ language: e.target.value });
    alert('Changing the system language will require a restart.');
  };

  const handleAtlasStartupChange = (e) => {
    setAtlasStartup(e.target.value);
    saveSettings({ atlasStartup: e.target.value });
  };

  const handleGameStartupChange = (e) => {
    setGameStartup(e.target.value);
    saveSettings({ gameStartup: e.target.value });
  };

  const handleDebugConsoleChange = () => {
    setShowDebugConsole(!showDebugConsole);
    saveSettings({ showDebugConsole: !showDebugConsole });
    alert('Changing the debug console setting requires a restart.');
  };

  const handleMinimizeToTrayChange = () => {
    setMinimizeToTray(!minimizeToTray);
    saveSettings({ minimizeToTray: !minimizeToTray });
  };

  return (
    <div className="p-5 text-text">
      <div className="flex items-center mb-2">
        <label className="w-32 text-right mr-2">Language:</label>
        <select
          className="w-24 bg-secondary border border-border text-text rounded p-1"
          value={language}
          onChange={handleLanguageChange}
        >
          <option>English</option>
        </select>
      </div>
      <p className="text-xs opacity-50 mb-2">Changing the system language will require a restart</p>
      <div className="border-t border-text opacity-25 my-2"></div>
      <div className="flex items-center mb-2">
        <label className="w-32 text-right mr-2">When Atlas Starts:</label>
        <select
          className="w-48 bg-secondary border border-border text-text rounded p-1"
          value={atlasStartup}
          onChange={handleAtlasStartupChange}
        >
          <option>Do Nothing</option>
        </select>
      </div>
      <p className="text-xs opacity-50 mb-2">Select default Atlas behavior</p>
      <div className="border-t border-text opacity-25 my-2"></div>
      <div className="flex items-center mb-2">
        <label className="w-32 text-right mr-2">When Game Starts:</label>
        <select
          className="w-24 bg-secondary border border-border text-text rounded p-1"
          value={gameStartup}
          onChange={handleGameStartupChange}
        >
          <option>Do Nothing</option>
        </select>
      </div>
      <p className="text-xs opacity-50 mb-2">This will only take effect once game has fully launched</p>
      <div className="border-t border-text opacity-25 my-2"></div>
      <div className="flex items-center mb-2">
        <label className="flex-1">Show debug console window</label>
        <input
          type="checkbox"
          className="mr-5"
          checked={showDebugConsole}
          onChange={handleDebugConsoleChange}
        />
      </div>
      <p className="text-xs opacity-50 mb-2">Enabling or Disabling the debug console will require a restart</p>
      <div className="border-t border-text opacity-25 my-2"></div>
      <div className="opacity-50">
        <div className="flex items-center mb-2">
          <label className="flex-1">Minimize Atlas to system tray when the application window is closed</label>
          <input
            type="checkbox"
            className="mr-5"
            checked={minimizeToTray}
            onChange={handleMinimizeToTrayChange}
            disabled
          />
        </div>
        <div className="border-t border-text opacity-25 my-2"></div>
      </div>
    </div>
  );
};

window.Interface = Interface;