const { useState, useEffect } = window.React;

const Settings = () => {
  const [selected, setSelected] = useState('Interface');
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    window.electronAPI.onWindowStateChanged((state) => {
      setIsMaximized(state === 'maximized');
    });
  }, []);

  const renderContent = () => {
    switch (selected) {
      case 'Interface':
        return <window.Interface />;
      case 'Library':
        return <window.Library />;
      case 'Platforms':
        return <window.Platforms />;
      case 'Emulators':
        return <window.Emulators />;
      case 'Appearance':
        return <window.Appearance />;
      case 'Metadata':
        return <window.Metadata />;
      default:
        return <div className="p-4 text-text">Select a settings category</div>;
    }
  };

  return (
    <div className="flex h-screen font-sans text-[13px] bg-transparent">
      {/* Window Controls */}
      <div className="absolute top-0 right-0 flex items-center h-[30px] z-50 -webkit-app-region-no-drag">
        <button
          onClick={() => window.electronAPI.minimizeWindow()}
          className="w-8 h-8 flex items-center justify-center bg-transparent hover:bg-hover"
          title="Minimize"
        >
          <svg className="w-3 h-3 text-text" viewBox="0 0 45 45" fill="currentColor">
            <rect x="5.887" y="12.208" width="35.992" height="2.015" />
          </svg>
        </button>
        <button
          onClick={() => window.electronAPI.maximizeWindow()}
          className="w-8 h-8 flex items-center justify-center bg-transparent hover:bg-hover"
          title="Maximize/Restore"
        >
          <svg className="w-3 h-3 text-text" viewBox="0 0 45 45" fill="currentColor">
            {isMaximized ? (
              <path d="M7,16H3v-5h4v-4h5v4h-4v5zm6,0v4h4v4h-5v-4h4v-5h-4v-4h5v4h-4zm11,5v-4h-4v-5h4v4h5v-4h4v5h-4v4h-5zm-6,0v5h-4v4h-5v-4h4v-5h5v4h4v-4h-4z" />
            ) : (
              <rect x="5" y="5" width="35" height="35" />
            )}
          </svg>
        </button>
        <button
          onClick={() => window.electronAPI.closeWindow()}
          className="w-8 h-8 flex items-center justify-center bg-transparent hover:bg-redExit"
          title="Close"
        >
          <svg className="w-3 h-3 text-text" viewBox="0 0 45 45" fill="currentColor">
            <path d="M6.34375,6.34375 L38.65625,38.65625 M38.65625,6.34375 L6.34375,38.65625" />
          </svg>
        </button>
      </div>
      {/* Main Content */}
      <div className="flex flex-1">
        {/* Settings Sidebar */}
        <div className="w-[180px] bg-primary h-full border-r border-border">
          <div className="text-center text-text font-bold text-lg mt-4 mb-2">ATLAS SETTINGS</div>
          <ul>
            {window.settingsIcons.map((item) => (
              <li
                key={item.name}
                className={`p-4 cursor-pointer hover:bg-selected flex items-center ${selected === item.name ? 'bg-selected' : ''} ${item.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                onClick={() => !item.disabled && setSelected(item.name)}
              >
                <svg className="w-5 h-5 text-text mr-2" viewBox="0 0 24 24" fill="currentColor">
                  <path d={item.path} />
                </svg>
                <span>{item.name}</span>
              </li>
            ))}
          </ul>
        </div>
        {/* Settings Content */}
        <div className="flex-1 bg-secondary p-4">
          <h2 className="text-2xl font-bold mb-4 text-aliceblue">SETTINGS</h2>
          {renderContent()}
        </div>
      </div>
    </div>
  );
};

const root = window.ReactDOM.createRoot(document.getElementById('root'));
root.render(<Settings />);