import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import '@fontsource-variable/inter'
import '@/styles/index.css'

// The console is an always-online HQ tool — no service worker, no offline
// caching (contrast the hospital app). Just mount and go.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
