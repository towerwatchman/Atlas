import { useState, useEffect } from 'react'
import Interface from './Interface.jsx'
import Library from './Library.jsx'
import Appearance from './Appearance.jsx'
import Metadata from './Metadata.jsx'
import EmulatorLauncher from './EmulatorLauncher.jsx'
import { settingsIcons } from './settingsIcons.js'
import WindowBorderFrame from '../ui/WindowBorderFrame.jsx'

const visibleSettingsTabs = settingsIcons.filter((item) => !item.hidden)
const defaultSettingsTab = visibleSettingsTabs[0]?.name || "Interface"

const Settings = () => {
  const [selected, setSelected] = useState(defaultSettingsTab);
  const [isMaximized, setIsMaximized] = useState(false);
  const activeSelected = visibleSettingsTabs.some((item) => item.name === selected)
    ? selected
    : defaultSettingsTab;

  useEffect(() => {
    window.electronAPI.onWindowStateChanged((state) => {
      setIsMaximized(state === "maximized");
    });
  }, []);

  useEffect(() => {
    if (selected !== activeSelected) setSelected(activeSelected);
  }, [activeSelected, selected]);

  const renderContent = () => {
    switch (activeSelected) {
      case "Interface":
        return <Interface />;
      case "Library":
        return <Library />;
      case "Emulators":
        return <EmulatorLauncher />;
      case "Appearance":
        return <Appearance />;
      case "Metadata":
        return <Metadata />;
      default:
        return <Interface />;
    }
  };

  return (
    <div className="flex h-screen font-sans text-[13px] bg-transparent -webkit-app-region-no-drag">
      <WindowBorderFrame />
      {/* Drag Header*/}
      <div className="absolute left-0 top-0 w-full h-[50px] ml-[-90px] z-40 -webkit-app-region-drag" />
      {/* Window Controls — explicit z-50 (matching the Drag Header's
          z-40 above it) so these always paint above Main Content. Main
          Content now carries a transform (see the rounded-corner clip
          fix), which makes it form its own stacking context; without an
          explicit z-index here, that stacking context — being later in
          the DOM — paints over these otherwise-z-index:auto absolutely
          positioned buttons and hides them entirely. */}
      <div className="flex absolute top-1 right-2 h-[70px] z-50">
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
          <i
            className={
              isMaximized
                ? "fas fa-window-restore text-text"
                : "fas fa-window-maximize text-text"
            }
          ></i>
        </button>
        <button
          onClick={() => window.electronAPI.closeWindow()}
          className="w-7 h-7 flex items-center justify-center bg-transparent hover:bg-danger transition-colors duration-200"
        >
          <i className="fas fa-times text-text"></i>
        </button>
      </div>
      {/* Main Content */}
      <div className="flex flex-1 rounded-windowTheme overflow-hidden transform-gpu">
        {/* Settings Sidebar */}
        <div className="w-[180px] bg-primary h-full border-r border-border -webkit-app-region-no-drag">
          <div className="text-center text-accent font-bold text-md mt-4 mb-4 antialiased -webkit-app-region-drag">
            ATLAS SETTINGS
          </div>
          <ul>
            {visibleSettingsTabs.map((item) => (
              <>
                <li
                  key={item.name}
                  className={`pt-2 pb-2 pl-4 pr-4 cursor-pointer hover:bg-highlight flex items-center text-text ${activeSelected === item.name ? "bg-selected" : ""} ${item.disabled ? "opacity-50 cursor-not-allowed" : ""}`}
                  onClick={() => !item.disabled && setSelected(item.name)}
                >
                  <svg
                    className="w-4 h-4 object-contain text-text mr-2"
                    fill="currentColor"
                    viewBox={item.viewBox}
                  >
                    <path d={item.path} />
                  </svg>
                  <span>{item.name}</span>
                </li>
                {item.name === "Emulators" && (
                  <hr className="mx-2 my-2 border-border border-1" />
                )}
              </>
            ))}
          </ul>
        </div>
        {/* Settings Content */}
        <div className="flex-1 bg-secondary flex flex-col min-h-0">
          <h2 className="flex-shrink-0 text-2xl font-bold px-4 pt-4 mb-4 text-text">{activeSelected}</h2>
          <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings
