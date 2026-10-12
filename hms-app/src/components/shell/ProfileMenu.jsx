import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { roleLabel } from '@/auth/roles'
import { useTheme } from '@/theme/ThemeContext'
import { Icon } from '../Icon'
import { Button } from '../ui/Button'
import { initials } from '@/lib/format'

const OPTIONS = [
  { value: 'system', label: 'System default' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

export function ProfileMenu() {
  const { user, logout } = useAuth()
  const { preference, choose } = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="profile" ref={ref}>
      <button
        type="button"
        className="profile-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Profile and appearance"
      >
        {initials(user?.name)}
      </button>
      {open && (
        <div className="profile-menu" role="menu">
          <div className="pm-name">{user?.name}</div>
          <div className="pm-role">{(user?.roles || []).map(roleLabel).join(', ') || 'Staff'}</div>
          <div className="pm-label" id="appearance-label">Appearance</div>
          <div className="seg" role="radiogroup" aria-labelledby="appearance-label">
            {OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={preference === o.value}
                onClick={() => choose(o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
          <Button variant="ghost" block className="pm-out" icon="logout" onClick={logout}>
            Sign out
          </Button>
        </div>
      )}
    </div>
  )
}
