/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{jsx,js,html}'
  ],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--canvas)',
        primary: 'var(--primary)',
        secondary: 'var(--secondary)',
        tertiary: 'var(--tertiary)',
        border: 'var(--border)',
        selected: 'var(--selected)',
        accent: 'var(--accent)',
        'accent-bar': 'var(--accent-bar)',
        'atlas-logo': 'var(--atlas-logo)',
        text: 'var(--text)',
        highlight: 'var(--highlight)'
      }
    }
  },
  plugins: []
};