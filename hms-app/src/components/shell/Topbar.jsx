import { useAuth } from '@/auth/AuthContext'
import { roleLabel } from '@/auth/roles'
import { SyncChip } from './SyncChip'
import { ProfileMenu } from './ProfileMenu'
import { useModule } from './useModule'
import { Button } from '../ui/Button'

export function Topbar({ onMenu, menuOpen }) {
  const { user } = useAuth()
  const mod = useModule()
  const roles = user?.roles || []
  const roleText = roles.length ? `${roleLabel(roles[0])}${roles.length > 1 ? ` +${roles.length - 1}` : ''}` : 'Staff'

  return (
    <header className="module-bar" style={{ '--module-accent': mod.accent }}>
      <Button className="mobile-menu-toggle" variant="quiet" icon={menuOpen ? 'close' : 'menu'} aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} onClick={onMenu} />
      <div className="mb-module">{mod.label}</div>
      {user?.hospitalName && <div className="mb-hospital">{user.hospitalName}</div>}
      <div className="mb-right">
        <SyncChip />
        <div className="mb-who">
          <div className="n">{user?.name}</div>
          <div className="r">{roleText}</div>
        </div>
        <ProfileMenu />
      </div>
    </header>
  )
}
