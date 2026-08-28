import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { DesignGallery } from './ui/DesignGallery'
import './ui/tokens.css'
import './styles.css'
import './ui/foundations.css'
import './ui/components.css'
import './ui/shell.css'
import './ui/templates.css'

const galleryRequested = import.meta.env.DEV && (window.location.pathname === '/design-system' || new URLSearchParams(window.location.search).get('design-system') === '1')

createRoot(document.getElementById('root')!).render(<StrictMode>{galleryRequested ? <DesignGallery /> : <App />}</StrictMode>)
