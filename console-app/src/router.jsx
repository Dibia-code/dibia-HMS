import { createBrowserRouter } from 'react-router-dom'
import { RequireAuth, RootRedirect } from '@/auth/guards'
import { AppShell } from '@/components'
import Login from '@/pages/Login'
import NotFound from '@/pages/NotFound'
import OverviewPage from '@/features/overview/OverviewPage'
import HospitalsPage from '@/features/hospitals/HospitalsPage'
import BillingPage from '@/features/billing/BillingPage'
import SupportPage from '@/features/support/SupportPage'

// The console's routing table, exactly as scoped: /login, /overview,
// /hospitals, /billing, /support. Everything except /login sits behind the
// single auth gate and inside the shell (dark sidebar + topbar).
export const router = createBrowserRouter([
  { path: '/', element: <RootRedirect /> },
  { path: '/login', element: <Login /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/overview', element: <OverviewPage /> },
          { path: '/hospitals', element: <HospitalsPage /> },
          { path: '/billing', element: <BillingPage /> },
          { path: '/support', element: <SupportPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFound /> },
])
