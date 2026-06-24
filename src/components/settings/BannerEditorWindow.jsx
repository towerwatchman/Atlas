import { useState, useEffect } from 'react'
import BannerEditor from './BannerEditor.jsx'
import WindowBorderFrame from '../ui/WindowBorderFrame.jsx'

const BannerEditorWindow = () => {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    window.electronAPI.onWindowStateChanged((state) => {
      setIsMaximized(state === 'maximized')
    })
  }, [])

  return (
    <div className="flex flex-col h-screen font-sans text-[13px] bg-secondary text-text -webkit-app-region-no-drag rounded-windowTheme overflow-hidden transform-gpu [clip-path:inset(0_round_var(--radius-window-active))]">
      <WindowBorderFrame />
      <div className="flex items-center justify-between h-[50px] flex-shrink-0 px-4 -webkit-app-region-drag">
        <h2 className="text-lg font-bold text-text">Banner Editor</h2>
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
      <div className="flex-1 min-h-0 flex flex-col p-4">
        <BannerEditor />
      </div>
    </div>
  )
}

export default BannerEditorWindow

