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
      <div className="flex absolute top-0 right-0 h-[70px] -webkit-app-region-no-drag">
            <button
              onClick={() => window.electronAPI.minimizeWindow()}
              className="w-8 h-8 flex items-center justify-center bg-transparent hover:bg-tertiary transition-colors duration-200"
            >
              <i className="fas fa-minus text-text"></i>
            </button>
            <button
              onClick={() => window.electronAPI.maximizeWindow()}
              className="w-8 h-8 flex items-center justify-center bg-transparent hover:bg-tertiary transition-colors duration-200"
            >
              <i className={isMaximized ? "fas fa-window-restore text-text" : "fas fa-window-maximize text-text"}></i>
            </button>
            <button
              onClick={() => window.electronAPI.closeWindow()}
              className="w-8 h-8 flex items-center justify-center bg-transparent hover:bg-[DarkRed] transition-colors duration-200"
            >
              <i className="fas fa-times text-text"></i>
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