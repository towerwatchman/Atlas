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
        buttonHover:        'var(--color-button-hover)',
        accentHover:        'var(--color-accent-hover)',

        // ── Window chrome ──
        windowBorder:       'var(--color-window-border)',
      },
      borderRadius: {
        // Follows whichever radius the active theme has chosen (sm/md/lg/pill)
        // — see --radius-active in applyTheme.js. Use this on buttons and
        // cards: the surfaces that should reflect a theme's "personality".
        theme: 'var(--radius-active)',
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
