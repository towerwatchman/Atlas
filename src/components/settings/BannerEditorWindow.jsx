import { useState, useEffect } from 'react'
import BannerEditor from './BannerEditor.jsx'
import WindowBorderFrame from '../ui/WindowBorderFrame.jsx'
import WindowTitleBar from '../ui/WindowTitleBar.jsx'

const BannerEditorWindow = () => {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    window.electronAPI.onWindowStateChanged((state) => {
      setIsMaximized(state === 'maximized')
    })
  }, [])

  return (
    <div className="flex flex-col h-screen font-sans text-[13px] bg-secondary text-text -webkit-app-region-no-drag rounded-windowTheme overflow-hidden transform-gpu">
      <WindowBorderFrame />
      <WindowTitleBar title="Banner Editor" isMaximized={isMaximized} />
      <div className="flex-1 min-h-0 flex flex-col p-4">
        <BannerEditor />
      </div>
    </div>
  )
}

export default BannerEditorWindow

