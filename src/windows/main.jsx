import '../assets/css/main.css'
import { createRoot } from 'react-dom/client'
import App, { AppErrorBoundary } from '../App.jsx'

const root = createRoot(document.getElementById('root'))
root.render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
)
