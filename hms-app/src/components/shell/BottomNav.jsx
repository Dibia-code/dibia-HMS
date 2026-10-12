import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { Icon } from '../Icon'
import { Button } from '../ui/Button'
import { visibleNav } from './nav'
import { cx } from '@/lib/cx'

export function BottomNav() {
  const { user, can, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const slug = user?.hospitalSlug

  const all = visibleNav(can).flatMap((s) => s.items)
  const pinned = all.filter((it) => it.bottom)
  const needsMore = all.length > 5
  const shown = needsMore ? pinned.slice(0, 4) : all

  return (
    <>
      <nav className="bottom-nav" aria-label="Main">
        {shown.map((item) => (
          <NavLink
            key={item.to}
            to={`/${slug}/${item.to}`}
            className={({ isActive }) => cx('bn-item', isActive && 'active')}
          >
            <Icon name={item.icon} />
            <span>{item.label.split(' ')[0]}</span>
          </NavLink>
        ))}
        {needsMore && (
          <button type="button" className="bn-item" onClick={() => setOpen(true)}>
            <Icon name="menu" />
            <span>More</span>
          </button>
        )}
      </nav>

      {open && (
        <div className="sheet-overlay" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="All pages">
            <div className="sh-title">All pages</div>
            {all.map((item) => (
              <NavLink
                key={item.to}
                to={`/${slug}/${item.to}`}
                className={({ isActive }) => cx('sb-link', isActive && 'active')}
                onClick={() => setOpen(false)}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </NavLink>
            ))}
            <Button variant="ghost" block className="mt-2" icon="logout" onClick={logout}>
              Sign out
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
