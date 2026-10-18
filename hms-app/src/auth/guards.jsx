import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom'
import { useAuth } from './AuthContext'

// Minimal boot splash to avoid a redirect flash while the session is restoring.
function Splash() {
  return (
    <div className="auth-wrap">
      <div style={{ textAlign: 'center', color: 'var(--muted-2)' }}>
        <div className="auth-card" style={{ boxShadow: 'none', border: 'none', background: 'transparent' }}>
          <div className="brand">
            <span className="mark">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3C8.5 6.5 6 9.8 6 13.2A6 6 0 0 0 18 13.2C18 9.8 15.5 6.5 12 3Z" />
              </svg>
            </span>
            <span className="name">Dibia</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Gate 1 — authentication. Unauthenticated users go to /login, remembering the
// page they wanted so login can send them back.
export function RequireAuth() {
  const { isAuthed, restoring, user } = useAuth()
  const location = useLocation()
  if (restoring) return <Splash />
  if (!isAuthed) return <Navigate to="/login" replace state={{ from: location }} />
  if (user?.mustChangePassword && !user.passwordChangeSkipped) return <Navigate to="/change-password" replace />
  return <Outlet />
}

// Gate 2 — multi-tenancy at the route layer. A signed-in user may only browse
// their own hospital's slug; anything else bounces to their tenant (§3).
export function RequireTenant() {
  const { user, landingPath } = useAuth()
  const { hospitalSlug } = useParams()
  if (user?.hospitalSlug && hospitalSlug !== user.hospitalSlug) {
    return <Navigate to={`/${user.hospitalSlug}/${landingPath()}`} replace />
  }
  return <Outlet />
}

// Gate 3 — permission check on the UNION across all roles. `anyOf` is a single
// permission or a list (holding any one grants access). Denied users are sent
// to their own landing route rather than shown a dead end.
export function RequirePerms({ anyOf }) {
  const { can, landingPath } = useAuth()
  const { hospitalSlug } = useParams()
  if (!can(anyOf)) {
    return <Navigate to={`/${hospitalSlug}/${landingPath()}`} replace />
  }
  return <Outlet />
}

export function RequireModule({ code }) {
  const { user } = useAuth()
  const { hospitalSlug } = useParams()
  const backendEnabled = import.meta.env.PROD || import.meta.env.VITE_HMS_BACKEND_AUTH === 'true'
  if (!backendEnabled || user?.moduleCodes?.includes(code)) return <Outlet />
  return (
    <section className="card" role="status">
      <h2>Module access is locked</h2>
      <p>This hospital does not currently have access to this module. Contact Dibia administration after arranging manual payment.</p>
      <a className="btn btn-amber" href={`/${hospitalSlug}/subscription`}>View account and billing</a>
    </section>
  )
}

// Index redirect for `/:hospitalSlug` — send to dashboard or /pos per role (§2).
export function TenantIndexRedirect() {
  const { landingPath } = useAuth()
  const { hospitalSlug } = useParams()
  return <Navigate to={`/${hospitalSlug}/${landingPath()}`} replace />
}
