import { createBrowserRouter } from 'react-router-dom'
import { RequireAuth, RootRedirect } from '@/auth/guards'
import { AppShell } from '@/components'
import Login from '@/pages/Login'
import PasswordReset from '@/pages/PasswordReset'
import NotFound from '@/pages/NotFound'
import OverviewPage from '@/features/overview/OverviewPage'
import HospitalsPage from '@/features/hospitals/HospitalsPage'
import BillingPage from '@/features/billing/BillingPage'
import SupportPage from '@/features/support/SupportPage'
import PrivacyPolicy from '@/pages/PrivacyPolicy'
import Terms from '@/pages/Terms'
import FeedbackLayerConsole from '../../shared/feedback/FeedbackLayerConsole'

// The console's routing table, exactly as scoped: /login, /overview,
// /hospitals, /billing, /support. Everything except /login sits behind the
// single auth gate and inside the shell (dark sidebar + topbar).
export const router = createBrowserRouter([{ element: <FeedbackLayerConsole />, children: [
  { path: '/', element: <RootRedirect /> },
  { path: '/login', element: <Login /> },
  { path: '/reset-password', element: <PasswordReset /> },
  { path: '/privacy', element: <PrivacyPolicy /> },
  { path: '/terms', element: <Terms /> },
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
]}])
