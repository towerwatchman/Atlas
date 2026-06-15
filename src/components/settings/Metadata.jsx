import { useState, useEffect } from 'react'
const Metadata = () => {
  const [mediaStorageMode, setMediaStorageMode] = useState("stream");
  const [refreshingMappings, setRefreshingMappings] = useState(false);
  const [mappingRefreshResult, setMappingRefreshResult] = useState(null);
  const [mappingRefreshError, setMappingRefreshError] = useState("");

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

  const handleRefreshMetadataMappings = async () => {
    setRefreshingMappings(true);
    setMappingRefreshResult(null);
    setMappingRefreshError("");

    try {
      const result = await window.electronAPI.refreshMetadataMappings();
      if (!result?.success) {
        throw new Error(result?.error || "Unable to refresh metadata mappings");
      }
      setMappingRefreshResult(result);
    } catch (err) {
      setMappingRefreshError(err.message || "Unable to refresh metadata mappings");
    } finally {
      setRefreshingMappings(false);
    }
  };

  const dbUpdateMessage =
    mappingRefreshResult?.dbUpdate?.message ||
    (mappingRefreshResult?.dbUpdate ? "Database update completed" : "");
  const remap = mappingRefreshResult?.remap;

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

      <div className="mb-2">
        <div className="flex items-center mb-2">
          <label className="flex-1">Metadata Mappings</label>
          <button
            type="button"
            onClick={handleRefreshMetadataMappings}
            disabled={refreshingMappings}
            className="bg-accent px-4 py-2 rounded hover:bg-opacity-90 disabled:opacity-50"
          >
            {refreshingMappings
              ? "Refreshing..."
              : "Refresh Metadata Mappings"}
          </button>
        </div>
        <p className="text-xs opacity-50 mb-2">
          Refreshes AtlasID mappings using stable source IDs such as F95ID and
          SteamID after metadata database updates.
        </p>
        {dbUpdateMessage && (
          <div className="text-xs opacity-80 mb-2">
            Database update: {dbUpdateMessage}
          </div>
        )}
        {remap && (
          <div className="text-xs opacity-80 mb-2">
            Mappings updated: {remap.updated} | Unchanged: {remap.unchanged} |
            Skipped: {remap.skipped} | Missing source: {remap.missingSource} |
            Missing metadata: {remap.missingAtlas}
          </div>
        )}
        {remap?.errors?.length > 0 && (
          <div className="text-xs text-red-400 mb-2">
            {remap.errors.length} row error(s) occurred while refreshing.
          </div>
        )}
        {mappingRefreshError && (
          <div className="text-xs text-red-400 mb-2">
            {mappingRefreshError}
          </div>
        )}
      </div>
      <div className="border-t border-text opacity-25 my-2"></div>
    </div>
  );
};

export default Metadata
