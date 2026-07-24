import { useState, useEffect } from 'react'
import Interface from './Interface.jsx'
import Library from './Library.jsx'
import Appearance from './Appearance.jsx'
import Metadata from './Metadata.jsx'
import Accounts from './Accounts.jsx'
import Database from './Database.jsx'
import EmulatorLauncher from './EmulatorLauncher.jsx'
import { settingsIcons } from './settingsIcons.js'
import WelcomeTour from '../ui/WelcomeTour.jsx'

const visibleSettingsTabs = settingsIcons.filter((item) => !item.hidden)
const defaultSettingsTab = visibleSettingsTabs[0]?.name || "Interface"

// Ordered settings-tour steps. Each optionally names a `tab` that must be the
// active settings section for its target to exist in the DOM; the tour host
// switches to that tab before the step is shown. Targets resolve via the
// data-tour attributes on the sidebar items and the Default Game Folder block.
const SETTINGS_TOUR_STEPS = [
  { target: 'settings-Interface', title: 'Settings Sections', body: 'Each section here controls a part of Atlas. Let\u2019s hit the important ones.' },
  { target: 'LibraryFolder', tab: 'Library', title: 'Set your games folder', body: 'This is the most important setting: choose where your games live. Imports and extractions go here. You can skip it, but Atlas won\u2019t work as expected until it\u2019s set.' },
  { target: 'settings-Emulators', tab: 'Emulators', title: 'Emulators', body: 'Add emulators here and map file types to them, so games that need an emulator launch with the right one automatically.' },
  { target: 'settings-Appearance', tab: 'Appearance', title: 'Make it yours', body: 'Themes, banner layouts, and the look of your library live here.' },
  { target: 'MetadataSources', tab: 'Metadata', title: 'Supported sites', body: 'Atlas currently pulls metadata and art from F95Zone, LewdCorner, and Steam. Drag the sources to set which one wins when a game is found on more than one.' },
  { target: 'MediaStorage', tab: 'Metadata', title: 'Download vs. stream', body: 'Streaming pulls banners and previews from the web on demand and caches them \u2014 lighter on disk, but the cache isn\u2019t portable, so moving your library to another machine means re-fetching. Downloading saves durable local copies that travel with your library.' },
  { target: 'settings-Accounts', tab: 'Accounts', title: 'Accounts & login', body: 'Sign in to supported sites here. Logging in lets Atlas fetch data that requires an account and improves matching for those sources.' },
  { target: 'settings-Database', tab: 'Database', title: 'Database & updates', body: 'The catalog updates frequently \u2014 typically every 1\u20133 hours. Run a Database Audit here to find games whose mapping was removed upstream and needs remapping.' },
]

const Settings = () => {
  const [selected, setSelected] = useState(defaultSettingsTab);
  const [isMaximized, setIsMaximized] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const activeSelected = visibleSettingsTabs.some((item) => item.name === selected)
    ? selected
    : defaultSettingsTab;

  useEffect(() => {
    window.electronAPI.onWindowStateChanged((state) => {
      setIsMaximized(state === "maximized");
    });
  }, []);

  // Auto-start the settings tour when the window was opened as part of the
  // first-run flow (the main window signals this via ?tour=1 on the URL, set
  // by open-settings). Also listen for a runtime signal in case the window is
  // reused. Guarded so it only auto-runs once per launch.
  useEffect(() => {
    let shouldAutoTour = false;
    try {
      const params = new URLSearchParams(window.location.search);
      shouldAutoTour = params.get('tour') === '1';
    } catch { shouldAutoTour = false; }
    if (shouldAutoTour) {
      // Small delay so the sidebar/content have mounted and laid out.
      const t = setTimeout(() => setTourOpen(true), 350);
      return () => clearTimeout(t);
    }
  }, []);

  // Runtime signal (window reused) to start the settings tour.
  useEffect(() => {
    const off = window.electronAPI.onStartSettingsTour?.(() => {
      setTimeout(() => setTourOpen(true), 200);
    });
    return () => { if (typeof off === 'function') off(); };
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
      case "Accounts":
        return <Accounts />;
      case "Database":
        return <Database />;
      default:
        return <Interface />;
    }
  };

  return (
    <div className="flex h-screen font-sans text-[13px] bg-transparent -webkit-app-region-no-drag">
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
          <div className="text-center text-accent font-bold text-md mt-4 mb-2 antialiased -webkit-app-region-drag">
            ATLAS SETTINGS
          </div>
          <div className="px-3 mb-3">
            <button
              onClick={() => setTourOpen(true)}
              className="w-full text-xs py-1.5 rounded-buttonTheme bg-button hover:bg-buttonHover text-text transition-colors -webkit-app-region-no-drag"
            >
              <i className="fas fa-circle-question mr-1" aria-hidden="true"></i> Take the tour
            </button>
          </div>
          <ul>
            {visibleSettingsTabs.map((item) => (
              <>
                <li
                  key={item.name}
                  data-tour={`settings-${item.name}`}
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
          <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 scroll-window-inset">
            {renderContent()}
          </div>
        </div>
      </div>

      <WelcomeTour
        open={tourOpen}
        onClose={() => setTourOpen(false)}
        steps={SETTINGS_TOUR_STEPS}
        onStepChange={(step) => { if (step?.tab) setSelected(step.tab) }}
      />
    </div>
  );
};

export default Settings
