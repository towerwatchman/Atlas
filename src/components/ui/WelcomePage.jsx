import atlasLogoUrl from '../../assets/images/atlas_logo.svg'

// First-run welcome page for the main window. Shown once, the very first
// time a user opens Atlas (tracked separately from the adult-content / age
// prompt via its own localStorage flag, WELCOME_SEEN_KEY). Pressing
// "Get Started" dismisses it; App.jsx then continues the first-run
// sequence: age confirmation (if not yet answered) -> interactive tour.
//
// Uses the real colored Atlas logo (the bundled SVG asset) rather than a
// monochrome glyph.

export const WELCOME_SEEN_KEY = 'atlasWelcomeSeen'

const Feature = ({ icon, title, body }) => (
  <div className="flex items-start gap-3">
    <span className="mt-0.5 flex-shrink-0 text-accent">{icon}</span>
    <span className="min-w-0">
      <span className="block text-sm font-medium text-text">{title}</span>
      <span className="block text-xs text-muted leading-relaxed">{body}</span>
    </span>
  </div>
)

const WelcomePage = ({ open, onGetStarted, version }) => {
  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[2800] p-4">
      <div className="bg-secondary rounded-cardTheme w-full max-w-md max-h-[90vh] overflow-y-auto text-text shadow-lg border border-border">
        {/* Logo + heading */}
        <div className="flex flex-col items-center text-center px-6 pt-8 pb-4">
          <img
            src={atlasLogoUrl}
            alt="Atlas"
            className="w-24 h-24 object-contain mb-4 select-none"
            draggable={false}
          />
          <h1 className="text-2xl font-semibold leading-tight">Welcome to Atlas</h1>
          {version && (
            <p className="text-xs text-muted mt-1">
              Version {version} <span className="text-warning">β</span>
            </p>
          )}
          <p className="text-sm text-text/90 leading-relaxed mt-3">
            Your open-source game manager and launcher. Atlas keeps your whole
            collection organized, searchable, and easy to launch — whether
            it's a handful of favorites or hundreds of titles.
          </p>
        </div>

        {/* Quick highlights */}
        <div className="px-6 py-4 space-y-3">
          <Feature
            title="Import from anywhere"
            body="Add titles from your disk or supported sources in a few clicks."
            icon={
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 3v12" strokeLinecap="round" />
                <path d="M8 11l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" />
              </svg>
            }
          />
          <Feature
            title="Rich metadata & art"
            body="Banners, tags, versions, and details pulled together automatically."
            icon={
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M3 15l4-4 4 4 3-3 4 4" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="8.5" cy="8.5" r="1.5" />
              </svg>
            }
          />
          <Feature
            title="Powerful filtering"
            body="Slice your library by tag, engine, rating, and date — and save the sets you use most."
            icon={
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 5h16l-6.5 8v5l-3 1v-6L4 5Z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            }
          />
        </div>

        {/* Catalog update note */}
        <div className="px-6 pb-2">
          <div className="flex items-start gap-2 rounded-buttonTheme border border-border bg-primary px-3 py-2">
            <i className="fas fa-clock-rotate-left text-accent mt-0.5" aria-hidden="true"></i>
            <p className="text-xs text-muted leading-relaxed">
              The online catalog refreshes frequently — new metadata and updates typically arrive
              every <span className="text-text font-medium">1–3 hours</span>. Check for updates periodically to stay current.
            </p>
          </div>
        </div>

        {/* CTA */}
        <div className="px-6 pb-8 pt-2">
          <button
            type="button"
            onClick={onGetStarted}
            className="w-full py-3 rounded-buttonTheme bg-accent hover:bg-accentHover text-white text-sm font-semibold transition-colors"
          >
            Get Started
          </button>
        </div>
      </div>
    </div>
  )
}

export default WelcomePage
