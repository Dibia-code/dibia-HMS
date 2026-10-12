import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import '@fontsource-variable/inter'
import '@/styles/index.css'
import App from '@/App'

// Register the service worker (offline app shell, §6). autoUpdate keeps it fresh;
// in dev this virtual module is a no-op (devOptions.enabled=false in vite.config).
registerSW({ immediate: true })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
