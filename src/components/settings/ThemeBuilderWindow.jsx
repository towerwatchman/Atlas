import { useState, useEffect } from 'react'
import ThemeBuilder from './ThemeBuilder.jsx'
import WindowBorderFrame from '../ui/WindowBorderFrame.jsx'

/**
 * Window chrome (drag region, minimize/maximize/close) for the Theme
 * Builder's own BrowserWindow — see createThemeBuilderWindow in
 * electron/main.js. This is a real separate OS-level window, not a React
 * modal layered over Settings, so it needs its own copy of the same
 * frameless-window chrome Settings.jsx/importer.jsx already have, rather
 * than reusing Settings.jsx's JSX directly (which is tied to the Settings
 * sidebar/tab layout this window doesn't have).
 */
const ThemeBuilderWindow = () => {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    window.electronAPI.onWindowStateChanged((state) => {
      setIsMaximized(state === 'maximized')
    })
  }, [])

  return (
    <div className="flex flex-col h-screen font-sans text-[13px] bg-secondary text-text -webkit-app-region-no-drag rounded-md overflow-hidden">
      <WindowBorderFrame />
      {/* Header row: a real flex row (not absolutely positioned), so the
          scrollable content below can never slide up underneath it — the
          previous absolute-header-over-absolute-content approach let the
          content visibly scroll behind the header/window-controls. */}
      <div className="flex items-center justify-between h-[50px] flex-shrink-0 px-4 -webkit-app-region-drag">
        <h2 className="text-lg font-bold text-text">Theme Builder</h2>
        <div className="flex h-[28px] -webkit-app-region-no-drag">
          <button
            onClick={() => window.electronAPI.minimizeWindow()}
            className="w-7 h-7 flex items-center justify-center bg-transparent hover:bg-tertiary transition-colors duration-200"
          >
            <i className="fas fa-minus text-text"></i>
          </button>
          <button
            onClick={() => window.electronAPI.maximizeWindow()}
            className="w-7 h-7 flex items-center justify-center bg-transparent hover:bg-tertiary transition-colors duration-200"
          >
            <i className={isMaximized ? 'fas fa-window-restore text-text' : 'fas fa-window-maximize text-text'}></i>
          </button>
          <button
            onClick={() => window.electronAPI.closeWindow()}
            className="w-7 h-7 flex items-center justify-center bg-transparent hover:bg-danger transition-colors duration-200"
          >
            <i className="fas fa-times text-text"></i>
          </button>
        </div>
      </div>
      {/* Main Content — a separate flex child below the header row, so its
          own overflow-y-auto scrolling can never visually pass behind the
          header (there's nothing to pass behind; the header isn't
          overlaid on top of this element's stacking context at all). */}
      <div className="flex-1 min-h-0 p-4 overflow-y-auto">
        <ThemeBuilder onClose={() => window.electronAPI.closeWindow()} />
      </div>
    </div>
  )
}

export default ThemeBuilderWindow
