/**
 * Shared frameless-window title bar for every window EXCEPT the main
 * library window. Standardizes what used to be four slightly different
 * per-window headers (Settings floated its controls; Theme Builder / Banner
 * Editor / Importer used a taller h-[50px] text-lg bar) onto the compact
 * "Edit Game Details" style: a short h-8 bar, bg-primary background, a
 * text-sm title on the left, and the minimize / maximize / close controls
 * on the right.
 *
 * The whole bar is a drag region; the controls (and any `children` passed
 * for window-specific actions) opt back out via -webkit-app-region-no-drag.
 * `isMaximized` toggles the maximize/restore icon and is owned by each
 * window shell (fed from onWindowStateChanged).
 */
export default function WindowTitleBar({ title, isMaximized, children }) {
  const minimize = () => window.electronAPI.minimizeWindow()
  const maximize = () => window.electronAPI.maximizeWindow()
  const close = () => window.electronAPI.closeWindow()

  return (
    <div className="flex items-center justify-between h-8 flex-shrink-0 bg-primary px-2 -webkit-app-region-drag">
      <p className="text-sm text-text truncate">{title}</p>
      <div className="flex items-center -webkit-app-region-no-drag">
        {children}
        <button
          onClick={minimize}
          className="w-6 h-6 flex items-center justify-center bg-transparent hover:bg-tertiary transition-colors duration-200"
        >
          <i className="fas fa-minus fa-xs text-text"></i>
        </button>
        <button
          onClick={maximize}
          className="w-6 h-6 flex items-center justify-center bg-transparent hover:bg-tertiary transition-colors duration-200"
        >
          <i className={isMaximized ? 'fas fa-window-restore fa-xs text-text' : 'fas fa-window-maximize fa-xs text-text'}></i>
        </button>
        <button
          onClick={close}
          className="w-6 h-6 flex items-center justify-center bg-transparent hover:bg-danger transition-colors duration-200"
        >
          <i className="fas fa-times fa-xs text-text"></i>
        </button>
      </div>
    </div>
  )
}
