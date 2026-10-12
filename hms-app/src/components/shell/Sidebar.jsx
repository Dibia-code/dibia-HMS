import { NavLink } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { roleLabel } from '@/auth/roles'
import { Icon } from '../Icon'
import { MODULES, visibleNav } from './nav'
import { cx } from '@/lib/cx'

export function Sidebar({ onNavigate, open = false, onClose }) {
  const { user, can, logout } = useAuth()
  const backendEnabled = import.meta.env.PROD || import.meta.env.VITE_HMS_BACKEND_AUTH === 'true'
  const slug = user?.hospitalSlug
  const sections = visibleNav(can, user?.moduleCodes, backendEnabled)
  const roles = (user?.roles || []).map(roleLabel).join(', ')

  return (
    <>
    {open && <button className="sidebar-scrim" type="button" aria-label="Close navigation" onClick={onClose} />}
    <aside className={`sidebar${open ? ' mobile-open' : ''}`}>
      <div className="sb-logo">
        <span className="mark">
          <Icon name="activity" />
        </span>
        <span className="name">Dibia</span>
      </div>

      <div className="sb-org">
        <div className="org-name">{user?.hospitalName || 'Hospital'}</div>
        <div className="org-plan">{roles || 'Staff'}</div>
      </div>

      <nav aria-label="Main">
        {sections.map((section) => (
          <div key={section.module} style={{ '--module-accent': MODULES[section.module].accent }}>
            {section.label && <div className="sb-section">{section.label}</div>}
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={`/${slug}/${item.to}`}
                className={({ isActive }) => cx('sb-link', isActive && 'active')}
                onClick={onNavigate}
                title={item.label}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="sb-bottom">
        <button type="button" className="sb-link" onClick={logout} title="Sign out">
          <Icon name="logout" />
          <span>Sign out</span>
        </button>
      </div>
    </aside>
    </>
  )
}
