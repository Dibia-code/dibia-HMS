import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { Icon } from '../Icon'
import { CONSOLE_NAV } from './nav'
import { cx } from '@/lib/cx'

// Dibia HMS Super Admin navigation for the hospital network.
export function Sidebar({ open = false, onClose }) {
  const { logout } = useAuth()
  const navigate = useNavigate()

  const signOut = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <>
    {open && <button type="button" className="sidebar-scrim" aria-label="Close navigation menu" onClick={onClose} />}
    <aside className={`sidebar${open ? ' open' : ''}`}>
      <div className="sb-logo">
        <span className="sq"><Icon name="star" /></span>
        Dibia HMS
      </div>
      <div className="sb-tag">Super Admin Console</div>

      <nav>
        {CONSOLE_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => cx('sb-link', isActive && 'active')}
            onClick={onClose}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sb-bottom">
        <button type="button" className="sb-link" onClick={signOut}>
          <Icon name="logout" />
          <span>Log out</span>
        </button>
      </div>
    </aside>
    </>
  )
}
