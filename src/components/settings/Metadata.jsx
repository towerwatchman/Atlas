import { useState, useEffect, useRef, useCallback } from 'react'
const Metadata = () => {
  const [mediaStorageMode, setMediaStorageMode] = useState("stream");

  useEffect(() => {
    window.electronAPI.getConfig().then((config) => {
      const metadataSettings = config.Metadata || {};
      setMediaStorageMode(metadataSettings.mediaStorageMode || "stream");
    });
  }, []);

  const saveSettings = (updatedSettings) => {
    window.electronAPI.getConfig().then((config) => {
      const newConfig = {
        ...config,
        Metadata: { ...config.Metadata, ...updatedSettings },
      };
      window.electronAPI.saveSettings(newConfig);
    });
  };

  const handleMediaStorageModeChange = (e) => {
    setMediaStorageMode(e.target.value);
    saveSettings({ mediaStorageMode: e.target.value });
  };

  return (
    <div className="p-5 text-text">
      <div className="flex items-center mb-2">
        <label className="flex-1">Media Storage</label>
        <select
          className="w-64 bg-secondary border border-border text-text rounded p-1"
          value={mediaStorageMode}
          onChange={handleMediaStorageModeChange}
        >
          <option value="stream">Stream media from the web</option>
          <option value="download">Download media and store locally</option>
        </select>
      </div>
      <p className="text-xs opacity-50 mb-2">
        Streaming uses less disk space. Downloading saves durable banner and
        preview files in Atlas data storage.
      </p>
      <div className="border-t border-text opacity-25 my-2"></div>
    </div>
  );
};

export default Metadata
