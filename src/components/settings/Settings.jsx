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
    <div className="flex h-screen font-sans text-[13px] bg-transparent -webkit-app-region-no-drag">
      {/* Drag Header*/}
      <div className="absolute left-0 top-0 w-full h-[50px] ml-[-90px] z-40 -webkit-app-region-drag" />
      {/* Window Controls */}
      <div className="flex absolute top-1 right-2 h-[70px]">
            <button
              onClick={() => window.electronAPI.minimizeWindow()}
              className="w-7 h-7 flex items-center justify-center bg-transparent hover:bg-tertiary transition-colors duration-200 -webkit-app-region-no-drag"
            >
              <i className="fas fa-minus text-text"></i>
            </button>
            <button
              onClick={() => window.electronAPI.maximizeWindow()}
              className="w-7 h-7 flex items-center justify-center bg-transparent hover:bg-tertiary transition-colors duration-200"
            >
              <i className={isMaximized ? "fas fa-window-restore text-text" : "fas fa-window-maximize text-text"}></i>
            </button>
            <button
              onClick={() => window.electronAPI.closeWindow()}
              className="w-7 h-7 flex items-center justify-center bg-transparent hover:bg-[DarkRed] transition-colors duration-200"
            >
              <i className="fas fa-times text-text"></i>
            </button>
          </div>
      {/* Main Content */}
      <div className="flex flex-1">
        {/* Settings Sidebar */}
        <div className="w-[180px] bg-primary h-full border-r border-border -webkit-app-region-no-drag">
          <div className="text-center text-accent font-bold text-md mt-4 mb-4 antialiased -webkit-app-region-drag">ATLAS SETTINGS</div>
          <ul>
            {window.settingsIcons.map((item) => (
              <li
                key={item.name}
                className={`pt-2 pb-2 pl-4 pr-4 cursor-pointer hover:bg-highlight flex items-center text-text ${selected === item.name ? 'bg-selected' : ''} ${item.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                onClick={() => !item.disabled && setSelected(item.name)}
              >
                <svg className="w-4 h-4 object-contain text-text mr-2" fill="currentColor">
                  <path d={item.path} />
                </svg>
                <span>{item.name}</span>
              </li>
            ))}
          </ul>
        </div>
        {/* Settings Content */}
        <div className="flex-1 bg-secondary p-4 overflow-y-auto">
          <h2 className="text-2xl font-bold mb-4 text-text">{selected}</h2>
          {renderContent()}
        </div>
      </div>
    </div>
  );
};

const root = window.ReactDOM.createRoot(document.getElementById('root'));
root.render(<Settings />);