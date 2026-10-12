import { RouterProvider } from 'react-router-dom'
import { ToastProvider } from '@/components'
import { RepositoryProvider } from '@/data/RepositoryContext'
import { AuthProvider } from '@/auth/AuthContext'
import { ThemeProvider } from '@/theme/ThemeContext'
import { router } from '@/router'
import CookieConsent from '@/components/CookieConsent'

// Provider order (outer → inner): toasts are available everywhere, the
// repository sits above auth so future session bootstrapping can read it, and
// the router renders the tree. Swap RepositoryProvider's backing store to go
// live — nothing here changes.
export default function App() {
  return (
    <ToastProvider>
      <RepositoryProvider>
        <AuthProvider>
          <ThemeProvider>
            <RouterProvider router={router} />
            <CookieConsent />
          </ThemeProvider>
        </AuthProvider>
      </RepositoryProvider>
    </ToastProvider>
  )
}
