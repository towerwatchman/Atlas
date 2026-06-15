import '../assets/css/main.css'
import { createRoot } from 'react-dom/client'
import GameDetailsWindow from '../components/detail/GameDetailsWindow.jsx'

const root = createRoot(document.getElementById('root'))
root.render(<GameDetailsWindow />)
