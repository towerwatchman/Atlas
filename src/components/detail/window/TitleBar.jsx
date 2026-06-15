export default function TitleBar({ isMaximized }) {
  const minimize = () => window.electronAPI.minimizeWindow()
  const maximize = () => window.electronAPI.maximizeWindow()
  const close = () => window.electronAPI.closeWindow()

  return (
    <div className="flex justify-between items-center h-8 bg-primary px-2 -webkit-app-region-drag">
      <div className="bg-primary h-8 flex justify-end items-center pr-2 -webkit-app-region-drag">
        <p className="text-sm absolute left-2 top-1">Edit Game Details</p>
        <div className="flex absolute top-1 right-2 h-[70px] -webkit-app-region-no-drag">
          <button
            onClick={minimize}
            className="w-6 h-6 flex items-center justify-center bg-transparent hover:bg-tertiary transition-colors duration-200"
            style={{ pointerEvents: 'auto', zIndex: 1000 }}
          >
            <i className="fas fa-minus fa-xs text-text"></i>
          </button>
          <button
            onClick={maximize}
            className="w-6 h-6 flex items-center justify-center bg-transparent hover:bg-tertiary transition-colors duration-200"
            style={{ pointerEvents: 'auto', zIndex: 1000 }}
          >
            <i className={isMaximized ? 'fas fa-window-restore fa-xs text-text' : 'fas fa-window-maximize fa-xs text-text'}></i>
          </button>
          <button
            onClick={close}
            className="w-6 h-6 flex items-center justify-center bg-transparent hover:bg-[DarkRed] transition-colors duration-200"
            style={{ pointerEvents: 'auto', zIndex: 1000 }}
          >
            <i className="fas fa-times fa-xs text-text"></i>
          </button>
        </div>
      </div>
    </div>
  )
}
