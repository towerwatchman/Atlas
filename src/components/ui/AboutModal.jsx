// About modal for the main window. Reachable from the "About" nav item
// (right-hand group in the topnav layout, below Settings in the sidebar
// layout — see navItems.js / TopNav.jsx / Sidebar.jsx). Gives a short
// description of Atlas (mirroring the GitHub landing page), external links
// to the community/support destinations, a stubbed Help wiki link, and a
// short note on how to file issues. Can also re-launch the interactive
// welcome tour via onReplayTour.
//
// All outbound links go through window.electronAPI.openExternalUrl so they
// open in the user's real browser rather than inside an Electron window
// (same pattern used by the game-details external links).

const LINKS = {
  steamCurator:
    'https://store.steampowered.com/curator/44473903-Atlas-Game-Manager/',
  github: 'https://github.com/towerwatchman/Atlas',
  discord: 'https://discord.gg/6Q5xxnaRk',
  // Stub: the GitHub wiki hasn't been created yet. Kept here as the single
  // place to update once the real help/docs destination exists.
  helpWiki: 'https://github.com/towerwatchman/Atlas/wiki',
  issues: 'https://github.com/towerwatchman/Atlas/issues',
}

const openUrl = (url) => {
  try {
    window.electronAPI?.openExternalUrl?.(url)
  } catch (error) {
    console.error('Failed to open external url', error)
  }
}

// Small labelled link row with a leading glyph. Uses semantic theme tokens
// only so it follows the active theme.
const LinkRow = ({ label, description, onClick, icon }) => (
  <button
    type="button"
    onClick={onClick}
    className="group w-full flex items-start gap-3 text-left px-3 py-2 rounded-buttonTheme bg-button hover:bg-buttonHover transition-colors"
  >
    <span className="mt-0.5 flex-shrink-0 text-accent group-hover:text-accentHover transition-colors">
      {icon}
    </span>
    <span className="min-w-0">
      <span className="block text-sm font-medium text-text">{label}</span>
      {description && (
        <span className="block text-xs text-muted truncate">{description}</span>
      )}
    </span>
  </button>
)

const AboutModal = ({ open, onClose, version, onReplayTour }) => {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[2600] p-4"
      onClick={onClose}
    >
      <div
        className="bg-secondary rounded-cardTheme w-full max-w-lg max-h-[85vh] overflow-y-auto text-text shadow-lg border border-border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 p-5 pb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex-shrink-0 w-10 h-10 rounded-cardTheme bg-primary flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-6 h-6 text-accent" fill="currentColor">
                <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm-1 3h2v2h-2V7Zm0 4h2v6h-2v-6Z" />
              </svg>
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold leading-tight">About Atlas</h2>
              {version && (
                <p className="text-xs text-muted">
                  Version {version} <span className="text-warning">β</span>
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-buttonTheme hover:bg-tertiary transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Description */}
        <div className="px-5 pb-4">
          <p className="text-sm text-text/90 leading-relaxed">
            Atlas is an open-source game manager and launcher for Windows and
            Linux with a modern interface for viewing, finding, installing, and
            organizing your game library. Whether you're managing a small
            personal collection or hundreds of titles from multiple sources,
            Atlas keeps everything organized, searchable, and easy to launch.
          </p>
        </div>

        {/* Links */}
        <div className="px-5 pb-2 space-y-2">
          <LinkRow
            label="Steam Curator"
            description="Follow the Atlas Game Manager curator page"
            onClick={() => openUrl(LINKS.steamCurator)}
            icon={
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
                <path d="M12 2a10 10 0 0 0-9.94 8.9l5.36 2.22a2.83 2.83 0 0 1 1.6-.49h.14l2.38-3.45v-.05a3.78 3.78 0 1 1 3.78 3.78h-.09l-3.4 2.42v.12a2.84 2.84 0 0 1-5.65.4l-3.83-1.59A10 10 0 1 0 12 2Zm-3.2 15.16-1.23-.5a2.13 2.13 0 0 0 3.94-1.61 2.13 2.13 0 0 0-2.78-1.15l1.27.53a1.57 1.57 0 1 1-1.2 2.9Zm8.72-6.9a2.52 2.52 0 1 0-2.52-2.52 2.52 2.52 0 0 0 2.52 2.52Zm0-4.41a1.9 1.9 0 1 1-1.9 1.89 1.9 1.9 0 0 1 1.9-1.89Z" />
              </svg>
            }
          />
          <LinkRow
            label="GitHub"
            description="Source code, releases, and roadmap"
            onClick={() => openUrl(LINKS.github)}
            icon={
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.85 9.73.5.1.68-.22.68-.49v-1.7c-2.79.62-3.38-1.22-3.38-1.22-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.36 1.12 2.94.86.09-.67.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.36 9.36 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9v2.82c0 .27.18.6.69.49A10.02 10.02 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z" />
              </svg>
            }
          />
          <LinkRow
            label="Discord"
            description="Join the community & discuss upcoming features"
            onClick={() => openUrl(LINKS.discord)}
            icon={
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
                <path d="M19.54 5.34A16.3 16.3 0 0 0 15.4 4l-.2.4a12.1 12.1 0 0 1 3.66 1.87 13.6 13.6 0 0 0-11.72 0A12.1 12.1 0 0 1 10.8 4.4L10.6 4a16.3 16.3 0 0 0-4.14 1.34C3.8 9.3 3.07 13.16 3.43 16.97a16.4 16.4 0 0 0 5 2.53l.4-.55a10.7 10.7 0 0 1-1.7-.82l.42-.32a11.7 11.7 0 0 0 9.9 0l.42.32c-.54.32-1.11.6-1.7.82l.4.55a16.4 16.4 0 0 0 5-2.53c.42-4.42-.72-8.24-2.44-11.63ZM9.35 14.6c-.98 0-1.79-.9-1.79-2s.79-2 1.79-2 1.8.9 1.79 2c0 1.1-.8 2-1.79 2Zm5.3 0c-.98 0-1.79-.9-1.79-2s.79-2 1.79-2 1.8.9 1.79 2c0 1.1-.8 2-1.79 2Z" />
              </svg>
            }
          />
          <LinkRow
            label="Help & Documentation"
            description="Guides and FAQ on the Atlas wiki"
            onClick={() => openUrl(LINKS.helpWiki)}
            icon={
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z" />
                <path d="M9.5 9a2.5 2.5 0 1 1 3.6 2.24c-.7.35-1.1.9-1.1 1.76v.5" strokeLinecap="round" />
                <path d="M12 17h.01" strokeLinecap="round" />
              </svg>
            }
          />
        </div>

        {/* Reporting issues */}
        <div className="px-5 py-4 mt-1">
          <h3 className="text-sm font-semibold mb-1">Found a bug?</h3>
          <p className="text-xs text-muted leading-relaxed mb-2">
            Please report bugs by opening an issue on GitHub. Include a clear
            description of what happened and attach the <code className="text-text">log</code> file
            found in the root of your Atlas directory so we can reproduce it.
          </p>
          <button
            type="button"
            onClick={() => openUrl(LINKS.issues)}
            className="text-xs font-medium text-accent hover:text-accentHover transition-colors"
          >
            Open an issue on GitHub →
          </button>
        </div>

        {/* Footer actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-t border-border">
          {onReplayTour ? (
            <button
              type="button"
              onClick={onReplayTour}
              className="text-sm px-3 py-2 rounded-buttonTheme bg-button hover:bg-buttonHover transition-colors"
            >
              Take the tour
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClose}
            className="text-sm px-4 py-2 rounded-buttonTheme bg-accent hover:bg-accentHover text-white transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default AboutModal
