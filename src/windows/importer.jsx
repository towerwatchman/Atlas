import '../assets/css/main.css'
import { createRoot } from 'react-dom/client'
import Importer from '../components/importer/Importer.jsx'
import { ThemeProvider } from '../theme/ThemeProvider.jsx'
import { applyThemeOnLoad } from '../theme/applyTheme.js'

applyThemeOnLoad()

const root = createRoot(document.getElementById('root'))
root.render(
  <ThemeProvider>
    <Importer />
  </ThemeProvider>,
)
