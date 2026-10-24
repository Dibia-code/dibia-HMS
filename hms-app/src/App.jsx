import { RouterProvider } from 'react-router-dom'
import { RepositoryProvider, useDataReady } from '@/data/RepositoryContext'
import { AuthProvider } from '@/auth/AuthContext'
import { ThemeProvider } from '@/theme/ThemeContext'
import { ToastProvider } from '@/components'
import { Icon } from '@/components/Icon'
import { router } from '@/router'
import CookieConsent from '@/components/CookieConsent'
import PwaUpdatePrompt from '@/components/PwaUpdatePrompt'

// Boot gate — hold the router until the local DB is seeded so no screen queries
// an empty store on first load.
function Boot({ children }) {
  const ready = useDataReady()
  if (!ready) {
    return (
      <div className="auth-wrap">
        <div className="brand" style={{ opacity: 0.7 }}>
          <span className="mark">
            <Icon name="activity" size={20} />
          </span>
          <span className="name">Dibia</span>
        </div>
      </div>
    )
  }
  return children
}

// Provider order matters:
//   ToastProvider      — outermost, so login/register can raise toasts too
//   RepositoryProvider — owns IndexedDB + sync engine + tenant scope
//   AuthProvider       — reads the repo to resolve a session, sets the scope
export default function App() {
  return (
    <ToastProvider>
      <RepositoryProvider>
        <AuthProvider>
          <ThemeProvider>
            <Boot>
              <RouterProvider router={router} />
              <CookieConsent />
            </Boot>
            <PwaUpdatePrompt />
          </ThemeProvider>
        </AuthProvider>
      </RepositoryProvider>
    </ToastProvider>
  )
}
