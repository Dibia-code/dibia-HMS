import { ROLES } from '@/auth/roles'
import { cx } from '@/lib/cx'

// Multi-role chip picker — the control behind the Staff "Add staff" form.
// `value` is an array of role slugs; clicking a chip toggles it. This is the UI
// that produces the many-to-many staff_roles rows (§4).
export function RoleChipPicker({ value = [], onChange, roles = ROLES }) {
  const selected = new Set(value)
  const toggle = (slug) => {
    const next = new Set(selected)
    if (next.has(slug)) next.delete(slug)
    else next.add(slug)
    onChange?.([...next])
  }
  return (
    <div className="role-picker" role="group" aria-label="Roles">
      {roles.map((role) => {
        const on = selected.has(role.slug)
        return (
          <button
            key={role.slug}
            type="button"
            className={cx('role-pick', on && 'selected')}
            aria-pressed={on}
            onClick={() => toggle(role.slug)}
          >
            {role.label}
          </button>
        )
      })}
    </div>
  )
}
