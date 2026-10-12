import { initials as toInitials } from '@/lib/format'

// Round avatar chip (amber, dark ink) — shows the admin's initials.
export function Avatar({ name, initials }) {
  return <div className="avatar">{initials || toInitials(name || 'Dibia HMS Super Admin')}</div>
}
