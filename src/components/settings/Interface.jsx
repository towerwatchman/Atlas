import { useState, useEffect, useRef, useCallback } from 'react'
import { formatPercent, sanitizePercentText } from '../../utils/formatPercent.js'

const PACKAGE_NOT_READY_CODE = 'UPDATE_PACKAGE_NOT_READY'

const Interface = () => {
  const [language, setLanguage] = useState("English");
  const [atlasStartup, setAtlasStartup] = useState("Do Nothing");
  const [gameStartup, setGameStartup] = useState("Do Nothing");
  const [showDebugConsole, setShowDebugConsole] = useState(false);
  const [minimizeToTray, setMinimizeToTray] = useState(false);
  const [checkForAppUpdatesOnStartup, setCheckForAppUpdatesOnStartup] =
    useState(true);
  const [updateStatus, setUpdateStatus] = useState("idle");
  const [updateVersion, setUpdateVersion] = useState("");
  const [updatePercent, setUpdatePercent] = useState(0);
  const [updateError, setUpdateError] = useState("");
  const [appUpdateBranch, setAppUpdateBranch] = useState("stable");
  // NSFW / adult-content ("Browse mode") opt-in — mirrors the same setting
  // surfaced by the first-run prompt in App.jsx. See
  // electron/ipc/settings.js's get-nsfw-status / set-nsfw-enabled.
  const [nsfwEnabled, setNsfwEnabledState] = useState(false);

  const applyUpdateStatus = (status) => {
    if (!status?.status) return;
    setUpdateStatus(
      status.status === "error" && status.code === PACKAGE_NOT_READY_CODE
        ? "package_not_ready"
        : status.status,
    );
    if (status.version) setUpdateVersion(status.version);
    if (typeof status.percent === "number") {
      setUpdatePercent(status.percent);
    }
    if (status.branch === "stable" || status.branch === "nightly") {
      setAppUpdateBranch(status.branch);
    }
    if (status.error) setUpdateError(sanitizePercentText(status.error));
    else if (status.status !== "error") setUpdateError("");
  };

  useEffect(() => {
    window.electronAPI.getConfig().then((config) => {
      const interfaceSettings = config.Interface || {};
      setLanguage(interfaceSettings.language || "English");
      setAtlasStartup(interfaceSettings.atlasStartup || "Do Nothing");
      setGameStartup(interfaceSettings.gameStartup || "Do Nothing");
      setShowDebugConsole(interfaceSettings.showDebugConsole || false);
      setMinimizeToTray(interfaceSettings.minimizeToTray || false);
      setCheckForAppUpdatesOnStartup(
        interfaceSettings.checkForAppUpdatesOnStartup ?? true,
      );
      if (interfaceSettings.appUpdateBranch === "stable" || interfaceSettings.appUpdateBranch === "nightly") {
        setAppUpdateBranch(interfaceSettings.appUpdateBranch);
      }
    });

    const removeUpdateListener = window.electronAPI.onUpdateStatus?.(
      applyUpdateStatus,
    );
    window.electronAPI.getAppUpdateState?.().then(applyUpdateStatus);

    window.electronAPI.getNsfwStatus?.().then((status) => {
      setNsfwEnabledState(status?.enabled === true);
    });
    const removeNsfwListener = window.electronAPI.onNsfwChanged?.((data) => {
      setNsfwEnabledState(data?.enabled === true);
    });

    return () => {
      if (typeof removeUpdateListener === "function") {
        removeUpdateListener();
      } else {
        window.electronAPI.removeUpdateStatusListener?.();
      }
      if (typeof removeNsfwListener === "function") removeNsfwListener();
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

  const handleAppUpdateBranchChange = (e) => {
    const nextBranch = e.target.value === "nightly" ? "nightly" : "stable";
    setAppUpdateBranch(nextBranch);
    setUpdateStatus("idle");
    setUpdateError("");
    setUpdateVersion("");
    setUpdatePercent(0);
    saveSettings({ appUpdateBranch: nextBranch });
  };

  // NSFW lives in its own [NSFW] config section (not [Interface]), so this
  // goes through set-nsfw-enabled rather than the saveSettings() helper
  // above — that also keeps the "configured" bookkeeping in main.js
  // consistent regardless of whether the user answers via this toggle or
  // the first-run prompt in App.jsx.
  const handleNsfwToggle = () => {
    const newVal = !nsfwEnabled;
    setNsfwEnabledState(newVal);
    window.electronAPI.setNsfwEnabled?.(newVal);
  };

  const handleCheckAppUpdate = async () => {
    setUpdateStatus("checking");
    setUpdateError("");
    const result = await window.electronAPI.checkAppUpdate();
    if (result?.success === false) {
      setUpdateStatus(result.code === PACKAGE_NOT_READY_CODE ? "package_not_ready" : "error");
      setUpdateError(sanitizePercentText(result.error || "Unable to check for updates"));
    }
  };

  const handleDownloadAndInstallAppUpdate = async () => {
    if (["downloading", "installing", "checking"].includes(updateStatus)) return;
    setUpdateStatus(updateStatus === "downloaded" ? "installing" : "downloading");
    setUpdateError("");

    const result =
      updateStatus === "downloaded"
        ? await window.electronAPI.installAppUpdate()
        : await window.electronAPI.downloadAndInstallAppUpdate();

    if (result?.success === false) {
      setUpdateStatus(result.code === PACKAGE_NOT_READY_CODE ? "package_not_ready" : "error");
      setUpdateError(sanitizePercentText(result.error || "Unable to update Atlas"));
    }
  };

  const updateStatusText = (() => {
    if (updateStatus === "checking") return "Checking for updates...";
    if (updateStatus === "available") {
      return `Atlas ${updateVersion || "update"} is available.`;
    }
    if (updateStatus === "downloading") {
      return `Downloading update: ${formatPercent(updatePercent)}`;
    }
    if (updateStatus === "downloaded") {
      return `Atlas ${updateVersion || "update"} is ready to install.`;
    }
    if (updateStatus === "installing") return "Installing update...";
    if (updateStatus === "not-available") return "Atlas is up to date.";
    if (updateStatus === "package_not_ready") return updateError;
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
        <label className="flex-1">Enable adult (18+) content in Browse mode</label>
        <input
          type="checkbox"
          className="mr-5"
          checked={nsfwEnabled}
          onChange={handleNsfwToggle}
        />
      </div>
      <p className="text-xs opacity-50 mb-2">
        Allows Browse mode to include adult-oriented games and visual novels.
        Atlas does not host or store any of this content — metadata is sourced
        from third-party sites, and you must be of legal age in your location
        to enable this.
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
        <p className="text-xs opacity-70 mb-3">{updateStatusText}</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm" htmlFor="app-update-branch">Branch</label>
          <select
            id="app-update-branch"
            className="w-32 bg-secondary border border-border text-text rounded p-2"
            value={appUpdateBranch}
            onChange={handleAppUpdateBranchChange}
            disabled={["checking", "downloading", "installing"].includes(updateStatus)}
          >
            <option value="stable">Stable</option>
            <option value="nightly">Nightly</option>
          </select>
          <button
            onClick={handleCheckAppUpdate}
            disabled={["checking", "downloading", "installing"].includes(updateStatus)}
            className="bg-accent px-4 py-2 rounded hover:bg-accentHover disabled:opacity-50"
          >
            Check for updates
          </button>
          <button
            onClick={handleDownloadAndInstallAppUpdate}
            disabled={!["available", "downloaded"].includes(updateStatus)}
            className="bg-accent px-4 py-2 rounded hover:bg-accentHover disabled:opacity-50"
          >
            {updateStatus === "installing"
              ? "Installing update..."
              : updateStatus === "downloading"
                ? "Downloading..."
                : updateStatus === "downloaded"
                  ? "Install and restart"
                  : "Download and install"}
          </button>
        </div>
        <p className="text-xs opacity-50 mt-2">
          Stable checks normal releases from main. Nightly includes prereleases.
          Switching to Stable will not install an older version.
        </p>
      </div>
      <div className="border-t border-text opacity-25 my-2"></div>
    </div>
  );
};

export default Interface
