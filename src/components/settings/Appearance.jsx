const Appearance = () => {
  const [theme, setTheme] = React.useState('');
  const [banner, setBanner] = React.useState('');

  const handleLoadTheme = () => {
    alert('Theme loaded. Changes saved.');
  };

  const handleLoadBanner = () => {
    alert('Banner layout loaded.');
  };

  const handleOpenXamlEditor = () => {
    alert('XAML Editor is not implemented in this version.');
  };

  return (
    <div className="p-5 text-text -webkit-app-region-no-drag">
      <div className="flex items-center mb-2">
        <label className="flex-1">Select a Theme:</label>
        <div className="flex items-center">
          <select
            className="w-80 bg-secondary border border-border text-text rounded p-1"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
          >
            <option>Default</option>
          </select>
          <button
            className="ml-5 bg-accent text-text px-4 py-1 rounded hover:bg-hover"
            onClick={handleLoadTheme}
          >
            Load
          </button>
        </div>
      </div>
      <p className="text-xs opacity-50 mb-2">Default Atlas Theme. Changes are saved as soon as theme file is loaded</p>
      <div className="border-t border-text opacity-25 my-2"></div>
      <div className="flex items-center mb-2">
        <label className="flex-1">Select a Banner UI Resource:</label>
        <div className="flex items-center">
          <select
            className="w-80 bg-secondary border border-border text-text rounded p-1"
            value={banner}
            onChange={(e) => setBanner(e.target.value)}
          >
            <option>Default</option>
          </select>
          <button
            className="ml-5 bg-accent text-text px-4 py-1 rounded hover:bg-hover"
            onClick={handleLoadBanner}
          >
            Load
          </button>
        </div>
      </div>
      <p className="text-xs opacity-50 mb-2">This will override the default banner layout. Please check for errors prior to loading</p>
      <div className="border-t border-text opacity-25 my-2"></div>
      <div className="flex items-center mb-2">
        <label className="flex-1">Open Xaml Editor</label>
        <button
          className="ml-5 bg-accent text-text px-4 py-1 rounded hover:bg-hover"
          onClick={handleOpenXamlEditor}
        >
          Launch
        </button>
      </div>
      <p className="text-xs opacity-50 mb-2">Create and modify existing banner themes</p>
      <div className="border-t border-text opacity-25 my-2"></div>
    </div>
  );
};

window.Appearance = Appearance;