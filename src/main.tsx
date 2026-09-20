import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './index.css'

// Service Worker aktualisiert sich selbst; beim nächsten Start ist die neue
// Version aktiv. Kein Update-Banner mitten in einer Lernsession.
registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
