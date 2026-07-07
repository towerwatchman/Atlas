import '../assets/css/main.css'
import { createRoot } from 'react-dom/client'
import ImporterHelp from '../components/importer/ImporterHelp.jsx'
import { ThemeProvider } from '../theme/ThemeProvider.jsx'
import { applyThemeOnLoad } from '../theme/applyTheme.js'

applyThemeOnLoad()

const root = createRoot(document.getElementById('root'))
root.render(
  <ThemeProvider>
    <ImporterHelp />
  </ThemeProvider>,
)
