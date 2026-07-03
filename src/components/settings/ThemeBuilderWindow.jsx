import { useState, useEffect } from 'react'
import ThemeBuilder from './ThemeBuilder.jsx'
import WindowBorderFrame from '../ui/WindowBorderFrame.jsx'
import WindowTitleBar from '../ui/WindowTitleBar.jsx'

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
    <div className="flex flex-col h-screen font-sans text-[13px] bg-secondary text-text -webkit-app-region-no-drag rounded-windowTheme overflow-hidden transform-gpu">
      <WindowBorderFrame />
      {/* Header row: a real flex row (not absolutely positioned), so the
          scrollable content below can never slide up underneath it — the
          previous absolute-header-over-absolute-content approach let the
          content visibly scroll behind the header/window-controls. */}
      <WindowTitleBar title="Theme Builder" isMaximized={isMaximized} />
      {/* Main Content — a separate flex child below the OS window's drag
          header above. No padding/overflow here anymore: ThemeBuilder
          itself now splits into its own fixed header (back/save row +
          tabs) and scrollable body, so that split needs to happen INSIDE
          the flex-1 box ThemeBuilder fills, not wrapped around it. */}
      <div className="flex-1 min-h-0 flex flex-col">
        <ThemeBuilder onClose={() => window.electronAPI.closeWindow()} />
      </div>
    </div>
  )
}

export default ThemeBuilderWindow
