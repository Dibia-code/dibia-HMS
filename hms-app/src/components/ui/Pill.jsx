import { cx } from '@/lib/cx'
import { roleLabel } from '@/auth/roles'

// Pill / status badge. `tone` is a semantic status (active/confirmed/paid/success,
// pending/awaiting/trial, failed/critical/…, rx).
export function Pill({ tone, dot = true, className, children }) {
  return (
    <span className={cx('pill', tone, className)}>
      {dot && <span className="dot" />}
      {children}
    </span>
  )
}

// A single staff role badge; staff hold several (multi-role) — see <RoleBadges>.
export function RoleBadge({ role, children }) {
  return <span className="role-badge">{children ?? roleLabel(role)}</span>
}

export function RoleBadges({ roles = [] }) {
  if (!roles.length) return <span className="text-muted">—</span>
  return (
    <span className="row wrap" style={{ gap: 0 }}>
      {roles.map((r) => (
        <RoleBadge key={r} role={r} />
      ))}
    </span>
  )
}
