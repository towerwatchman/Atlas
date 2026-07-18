import '../assets/css/main.css'
import { createRoot } from 'react-dom/client'
import App, { AppErrorBoundary } from '../App.jsx'
import { ThemeProvider } from '../theme/ThemeProvider.jsx'
import { BannerTemplateProvider } from '../theme/BannerTemplateProvider.jsx'
import { ToastProvider } from '../components/ui/toast/ToastContext.jsx'
import { applyThemeOnLoad } from '../theme/applyTheme.js'

// Apply the saved theme/layout before React mounts so there is no flash of
// default colors on startup. ThemeProvider (below) takes over from here for
// any in-app theme changes and live cross-window updates.
applyThemeOnLoad()

const root = createRoot(document.getElementById('root'))
root.render(
  <ThemeProvider>
    <BannerTemplateProvider>
      <ToastProvider>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </ToastProvider>
    </BannerTemplateProvider>
  </ThemeProvider>,
)
