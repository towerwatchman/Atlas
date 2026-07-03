module.exports = {
  content: [
    './src/**/*.{html,js,jsx}',
    './electron/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        // ── Surfaces / structure (existing tokens, now CSS-variable backed) ──
        canvas:             'var(--color-canvas)',
        shadow:             'var(--color-shadow)',
        primary:            'var(--color-primary)',
        secondary:          'var(--color-secondary)',
        tertiary:           'var(--color-tertiary)',
        library:            'var(--color-library)',
        border:             'var(--color-border)',
        selected:           'var(--color-selected)',
        accent:             'var(--color-accent)',
        accentBar:          'var(--color-accent-bar)',
        atlasLogo:          'var(--color-atlas-logo)',
        text:               'var(--color-text)',
        highlight:          'var(--color-highlight)',
        overlayTop:         'var(--color-overlay-top)',
        overlayBottom:      'var(--color-overlay-bottom)',

        // ── New semantic tokens (replace raw red/green/yellow/gray classes) ──
        muted:              'var(--color-muted)',
        danger:             'var(--color-danger)',
        dangerHover:        'var(--color-danger-hover)',
        dangerStrong:       'var(--color-danger-strong)',
        success:            'var(--color-success)',
        successHover:       'var(--color-success-hover)',
        warning:            'var(--color-warning)',
        info:               'var(--color-info)',

        // ── Button hover states (fix previously-undefined hover classes) ──
        button:             'var(--color-button)',
        buttonHover:        'var(--color-button-hover)',
        accentHover:        'var(--color-accent-hover)',
        accentMuted:        'var(--color-accent-muted)',

        // ── Progress bars ──
        progressBackground: 'var(--color-progress-background)',
        progressForeground: 'var(--color-progress-foreground)',

        // ── Window chrome ──
        windowBorder:       'var(--color-window-border)',

        // ── Game detail page (Steam-style) accents ──
        detailPlay:          'var(--color-detail-play)',
        detailPlayText:      'var(--color-detail-play-text)',
        detailLaunching:     'var(--color-detail-launching)',
        detailRunning:       'var(--color-detail-running)',
        detailAccent:        'var(--color-detail-accent)',
        detailAccentText:    'var(--color-detail-accent-text)',
        detailWishlistAdd:   'var(--color-detail-wishlist-add)',
        detailWishlistRemove:'var(--color-detail-wishlist-remove)',
        detailFavorite:      'var(--color-detail-favorite)',
      },
      borderRadius: {
        // Follows whichever radius the active theme has chosen for buttons
        // vs cards/panels respectively (sm/md/lg/pill, independently) — see
        // --radius-button-active / --radius-card-active in applyTheme.js.
        // `theme` is kept as a backward-compat alias for buttonTheme.
        theme:       'var(--radius-button-active)',
        buttonTheme: 'var(--radius-button-active)',
        cardTheme:   'var(--radius-card-active)',
        // Window border + every window's own corner clip (see
        // WindowBorderFrame.jsx, App.jsx, Settings.jsx, etc.) — both
        // must always use this same key so they can never drift apart.
        windowTheme: 'var(--radius-window-active)',
        // Fixed literal steps, NOT theme-dependent. Use these for small
        // structural elements (status badges, checkboxes, pills) that should
        // stay visually consistent regardless of theme, so a 'pill' radius
        // theme doesn't blow up a tiny badge into a circle.
        themeSm:   'var(--radius-sm)',
        themeMd:   'var(--radius-md)',
        themeLg:   'var(--radius-lg)',
        themePill: 'var(--radius-pill)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      spacing: {
        navSize: 'var(--nav-size)',
      },
    },
  },
  plugins: [],
}
