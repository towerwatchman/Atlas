import { useState, useEffect } from 'react'
import ThemeBuilder from './ThemeBuilder.jsx'

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
    <div className="flex flex-col h-screen font-sans text-[13px] bg-secondary text-text -webkit-app-region-no-drag">
      {/* Drag Header */}
      <div className="absolute left-0 top-0 w-full h-[50px] z-30 -webkit-app-region-drag" />
      {/* Window Controls */}
      <div className="flex absolute top-1 right-2 h-[28px] z-40">
        <button
          onClick={() => window.electronAPI.minimizeWindow()}
          className="w-7 h-7 flex items-center justify-center bg-transparent hover:bg-tertiary transition-colors duration-200 -webkit-app-region-no-drag"
        >
          <i className="fas fa-minus text-text"></i>
        </button>
        <button
          onClick={() => window.electronAPI.maximizeWindow()}
          className="w-7 h-7 flex items-center justify-center bg-transparent hover:bg-tertiary transition-colors duration-200 -webkit-app-region-no-drag"
        >
          <i className={isMaximized ? 'fas fa-window-restore text-text' : 'fas fa-window-maximize text-text'}></i>
        </button>
        <button
          onClick={() => window.electronAPI.closeWindow()}
          className="w-7 h-7 flex items-center justify-center bg-transparent hover:bg-danger transition-colors duration-200 -webkit-app-region-no-drag"
        >
          <i className="fas fa-times text-text"></i>
        </button>
      </div>
      {/* Main Content */}
      <div className="flex-1 p-4 pt-[54px] overflow-y-auto border border-accent rounded-md m-1">
        <h2 className="text-2xl font-bold mb-4 text-text">Theme Builder</h2>
        <ThemeBuilder onClose={() => window.electronAPI.closeWindow()} />
      </div>
    </div>
  )
}

export default ThemeBuilderWindow
