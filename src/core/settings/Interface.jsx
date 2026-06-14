const Interface = () => {
  const [language, setLanguage] = React.useState("English");
  const [atlasStartup, setAtlasStartup] = React.useState("Do Nothing");
  const [gameStartup, setGameStartup] = React.useState("Do Nothing");
  const [showDebugConsole, setShowDebugConsole] = React.useState(false);
  const [minimizeToTray, setMinimizeToTray] = React.useState(false);
  const [showSidebar, setShowSidebar] = React.useState(true);
  const [checkForAppUpdatesOnStartup, setCheckForAppUpdatesOnStartup] =
    React.useState(true);
  const [appUpdateChannel, setAppUpdateChannel] = React.useState("stable");
  const [updateStatus, setUpdateStatus] = React.useState("idle");
  const [updateVersion, setUpdateVersion] = React.useState("");
  const [updatePercent, setUpdatePercent] = React.useState(0);
  const [updateError, setUpdateError] = React.useState("");

  const applyUpdateStatus = (status) => {
    if (!status?.status) return;
    setUpdateStatus(status.status);
    if (status.version) setUpdateVersion(status.version);
    if (typeof status.percent === "number") {
      setUpdatePercent(status.percent);
    }
    if (status.channel) {
      setAppUpdateChannel(status.channel === "nightly" ? "nightly" : "stable");
    }
    if (status.error) setUpdateError(status.error);
    else if (status.status !== "error") setUpdateError("");
  };

  React.useEffect(() => {
    window.electronAPI.getConfig().then((config) => {
      const interfaceSettings = config.Interface || {};
      setLanguage(interfaceSettings.language || "English");
      setAtlasStartup(interfaceSettings.atlasStartup || "Do Nothing");
      setGameStartup(interfaceSettings.gameStartup || "Do Nothing");
      setShowDebugConsole(interfaceSettings.showDebugConsole || false);
      setMinimizeToTray(interfaceSettings.minimizeToTray || false);
      setShowSidebar(interfaceSettings.showSidebar ?? true);
      setCheckForAppUpdatesOnStartup(
        interfaceSettings.checkForAppUpdatesOnStartup ?? true,
      );
      setAppUpdateChannel(
        interfaceSettings.appUpdateChannel === "nightly"
          ? "nightly"
          : "stable",
      );
    });

    const removeUpdateListener = window.electronAPI.onUpdateStatus?.(
      applyUpdateStatus,
    );
    window.electronAPI.getAppUpdateState?.().then(applyUpdateStatus);

    return () => {
      if (typeof removeUpdateListener === "function") {
        removeUpdateListener();
      } else {
        window.electronAPI.removeUpdateStatusListener?.();
      }
    };
  }, []);

  const saveSettings = (updatedSettings) => {
    window.electronAPI.getConfig().then((config) => {
      const newConfig = {
        ...config,
        Interface: { ...config.Interface, ...updatedSettings },
      };
      window.electronAPI.saveSettings(newConfig);
    });
  };
  const handleShowSidebarChange = () => {
    const newVal = !showSidebar;
    setShowSidebar(newVal);
    saveSettings({ showSidebar: newVal });
    alert("Sidebar visibility change requires app restart.");
  };

  const handleLanguageChange = (e) => {
    setLanguage(e.target.value);
    saveSettings({ language: e.target.value });
    alert("Changing the system language will require a restart.");
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
    alert("Changing the debug console setting requires a restart.");
  };

  const handleMinimizeToTrayChange = () => {
    setMinimizeToTray(!minimizeToTray);
    saveSettings({ minimizeToTray: !minimizeToTray });
  };

  const handleStartupUpdateCheckChange = () => {
    const newVal = !checkForAppUpdatesOnStartup;
    setCheckForAppUpdatesOnStartup(newVal);
    saveSettings({ checkForAppUpdatesOnStartup: newVal });
  };

  const handleAppUpdateChannelChange = async (e) => {
    const channel = e.target.value === "nightly" ? "nightly" : "stable";

    setAppUpdateChannel(channel);
    setUpdateStatus("idle");
    setUpdateVersion("");
    setUpdatePercent(0);
    setUpdateError("");

    try {
      const result = await window.electronAPI.setAppUpdateChannel?.(channel);

      if (result?.success === false) {
        throw new Error(result.error || "Unable to change update channel");
      }
    } catch (error) {
      setUpdateStatus("error");
      setUpdateError(error.message || "Unable to change update channel");
    }
  };

  const handleCheckAppUpdate = async () => {
    setUpdateStatus("checking");
    setUpdateError("");
    const result = await window.electronAPI.checkAppUpdate();
    if (result?.success === false) {
      setUpdateStatus("error");
      setUpdateError(result.error || "Unable to check for updates");
    }
  };

  const handleDownloadAndInstallAppUpdate = async () => {
    setUpdateStatus("downloading");
    setUpdateError("");

    const result = await window.electronAPI.downloadAndInstallAppUpdate();

    if (result?.success === false) {
      setUpdateStatus("error");
      setUpdateError(result.error || "Unable to update Atlas");
    }
  };

  const appUpdateChannelLabel =
    appUpdateChannel === "nightly" ? "Nightly" : "Stable";

  const updateStatusText = (() => {
    if (updateStatus === "checking") {
      return `Checking ${appUpdateChannelLabel} updates...`;
    }
    if (updateStatus === "available") {
      return `Atlas ${updateVersion || "update"} is available on ${appUpdateChannelLabel}.`;
    }
    if (updateStatus === "downloading") {
      return `Downloading update: ${updatePercent.toFixed(0)}%`;
    }
    if (updateStatus === "downloaded") {
      return `Atlas ${updateVersion || "update"} is ready to install.`;
    }
    if (updateStatus === "not-available") {
      return `Atlas is up to date on ${appUpdateChannelLabel}.`;
    }
    if (updateStatus === "error") return updateError || "Update check failed.";
    return "No update check has run in this window.";
  })();

  return (
    <div className="p-5 text-text">
      <div className="flex items-center mb-2">
        <label className="flex-1">Language:</label>
        <select
          className="w-40 bg-secondary border border-border text-text rounded p-1"
          value={language}
          onChange={handleLanguageChange}
        >
          <option>English</option>
        </select>
      </div>
      <p className="text-xs opacity-50 mb-2">
        Changing the system language will require a restart
      </p>
      <div className="border-t border-text opacity-25 my-2"></div>
      <div className="flex items-center mb-2">
        <label className="flex-1">When Atlas Starts:</label>
        <select
          className="w-40 bg-secondary border border-border text-text rounded p-1"
          value={atlasStartup}
          onChange={handleAtlasStartupChange}
        >
          <option>Do Nothing</option>
        </select>
      </div>
      <p className="text-xs opacity-50 mb-2">Select default Atlas behavior</p>
      <div className="border-t border-text opacity-25 my-2"></div>
      <div className="flex items-center mb-2">
        <label className="flex-1">When Game Starts:</label>
        <select
          className="w-40 bg-secondary border border-border text-text rounded p-1 right-0"
          value={gameStartup}
          onChange={handleGameStartupChange}
        >
          <option>Do Nothing</option>
        </select>
      </div>
      <p className="text-xs opacity-50 mb-2">
        This will only take effect once game has fully launched
      </p>
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
      <p className="text-xs opacity-50 mb-2">
        Enabling or Disabling the debug console will require a restart
      </p>
      <div className="border-t border-text opacity-25 my-2"></div>
      <div className="opacity-50">
        <div className="flex items-center mb-2">
          <label className="flex-1">
            Minimize Atlas to system tray when the application window is closed
          </label>
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
      <div className="flex items-center mb-2">
        <label className="flex-1">Show Sidebar</label>
        <input
          type="checkbox"
          className="mr-5"
          checked={showSidebar}
          onChange={handleShowSidebarChange}
        />
      </div>
      <p className="text-xs opacity-50 mb-2">
        Hide/show the left sidebar. Requires restart.
      </p>
      <div className="border-t border-text opacity-25 my-2"></div>

      <div className="flex items-center mb-2">
        <label className="flex-1">Check for Atlas updates on startup</label>
        <input
          type="checkbox"
          className="mr-5"
          checked={checkForAppUpdatesOnStartup}
          onChange={handleStartupUpdateCheckChange}
        />
      </div>
      <p className="text-xs opacity-50 mb-2">
        Atlas will notify you about new versions, but updates are downloaded
        only when you choose.
      </p>
      <div className="border-t border-text opacity-25 my-2"></div>

      <div className="mb-2">
        <div className="font-semibold mb-2">App Updates</div>
        <div className="flex items-center mb-2">
          <label className="flex-1">Update Channel:</label>
          <select
            className="w-40 bg-secondary border border-border text-text rounded p-1"
            value={appUpdateChannel}
            onChange={handleAppUpdateChannelChange}
          >
            <option value="stable">Stable</option>
            <option value="nightly">Nightly</option>
          </select>
        </div>
        <p className="text-xs opacity-50 mb-2">
          Stable checks normal releases. Nightly checks pre-release/nightly
          builds and may be less stable.
        </p>
        <div className="border-t border-text opacity-25 my-2"></div>
        <p className="text-xs opacity-70 mb-3">{updateStatusText}</p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleCheckAppUpdate}
            disabled={updateStatus === "checking"}
            className="bg-accent px-4 py-2 rounded hover:bg-opacity-90 disabled:opacity-50"
          >
            Check for updates
          </button>
          <button
            onClick={handleDownloadAndInstallAppUpdate}
            disabled={!["available", "downloaded"].includes(updateStatus)}
            className="bg-accent px-4 py-2 rounded hover:bg-opacity-90 disabled:opacity-50"
          >
            {updateStatus === "downloaded"
              ? "Install and restart"
              : "Update and restart"}
          </button>
        </div>
      </div>
      <div className="border-t border-text opacity-25 my-2"></div>
    </div>
  );
};

window.Interface = Interface;
