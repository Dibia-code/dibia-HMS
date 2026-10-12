import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'

// The console's only gate: authentication. Unauthenticated users go to /login,
// remembering the page they wanted so login can send them back. There is no
// multi-tenant or per-permission gating here — every signed-in user is a Dibia
// network super admin (contrast the hospital app's three-gate model).
export function RequireAuth() {
  const { isAuthed, restoring } = useAuth()
  const location = useLocation()
  if (restoring) return <div className="auth-wrap" role="status">Checking admin session…</div>
  if (!isAuthed) return <Navigate to="/login" replace state={{ from: location }} />
  return <Outlet />
}

// Root redirect — signed-in admins land on the overview, everyone else on login.
export function RootRedirect() {
  const { isAuthed } = useAuth()
  return <Navigate to={isAuthed ? '/overview' : '/login'} replace />
}
