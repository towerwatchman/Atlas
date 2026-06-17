import '../assets/css/main.css'
import { createRoot } from 'react-dom/client'
import GameDetailsWindow from '../components/detail/GameDetailsWindow.jsx'
import { ThemeProvider } from '../theme/ThemeProvider.jsx'
import { applyThemeOnLoad } from '../theme/applyTheme.js'

applyThemeOnLoad()

const root = createRoot(document.getElementById('root'))
root.render(
  <ThemeProvider>
    <GameDetailsWindow />
  </ThemeProvider>,
)
