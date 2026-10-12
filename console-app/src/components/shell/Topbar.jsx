import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { useTheme } from '@/theme/ThemeContext'

const OPTIONS = [
  { value: 'system', label: 'System default' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

function OnlineChip() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return (
    <div className={`online-chip ${online ? '' : 'offline'}`} role="status">
      <span className="dot" />
      {online ? 'Online' : 'Offline. Reconnect to continue.'}
    </div>
  )
}

function ProfileMenu() {
  const { user, userInitials, logout } = useAuth()
  const { preference, choose } = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false)
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
      <button type="button" className="profile-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label="Profile and appearance">
        {userInitials}
      </button>
      {open && (
        <div className="profile-menu" role="menu">
          <div className="pm-name">{user?.name}</div>
          <div className="pm-role">Dibia HMS Super Admin</div>
          <div className="pm-label" id="appearance-label">Appearance</div>
          <div className="seg" role="radiogroup" aria-labelledby="appearance-label">
            {OPTIONS.map((o) => (
              <button key={o.value} type="button" role="radio" aria-checked={preference === o.value} onClick={() => choose(o.value)}>
                {o.label}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-secondary" style={{ width: '100%', marginTop: 12 }} onClick={logout}>
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

export function Topbar() {
  const { user } = useAuth()
  return (
    <header className="module-bar">
      <div className="mb-module">Dibia HMS Super Admin</div>
      <div className="mb-right">
        <OnlineChip />
        <div className="mb-who">
          <div className="n">{user?.name}</div>
          <div className="r">Hospital network administrator</div>
        </div>
        <ProfileMenu />
      </div>
    </header>
  )
}
