const Metadata = () => {
  const [downloadPreviews, setDownloadPreviews] = React.useState(false);

  React.useEffect(() => {
    window.electronAPI.getConfig().then((config) => {
      const metadataSettings = config.Metadata || {};
      setDownloadPreviews(metadataSettings.downloadPreviews || false);
    });
  }, []);

  const saveSettings = (updatedSettings) => {
    window.electronAPI.getConfig().then((config) => {
      const newConfig = { ...config, Metadata: { ...config.Metadata, ...updatedSettings } };
      window.electronAPI.saveSettings(newConfig);
    });
  };

  const handleDownloadPreviewsChange = () => {
    setDownloadPreviews(!downloadPreviews);
    saveSettings({ downloadPreviews: !downloadPreviews });
  };

  return (
    <div className="p-5 text-text">
      <div className="flex items-center mb-2">
        <label className="flex-1">Download Image Previews</label>
        <input
          type="checkbox"
          className="mr-5"
          checked={downloadPreviews}
          onChange={handleDownloadPreviewsChange}
        />
      </div>
      <p className="text-xs opacity-50 mb-2">This will grab all preview images when adding or updating existing games.</p>
      <div className="border-t border-text opacity-25 my-2"></div>
    </div>
  );
};

window.Metadata = Metadata;