import { Link } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { useRepo } from '@/data/RepositoryContext'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import { usePageHeader, Icon } from '@/components'

// Staff (cashier) Home — deliberately the whole screen: one clear action (start
// a sale), with sync status in the topbar and nothing else competing.
export default function HomePage() {
  const { user } = useAuth()
  const repo = useRepo()
  const { data: branches } = useLiveQuery(() => repo.list('branches'), [repo])

  const branchName = user?.branchId ? branches?.find((b) => b.id === user.branchId)?.name : null
  const subtitle = [branchName, user?.name].filter(Boolean).join(' · ')

  usePageHeader({ title: 'Home', subtitle: subtitle || 'Cashier' }, [subtitle])

  return (
    <div className="home-wrap">
      <Link to={`/${user.hospitalSlug}/pos`} className="newsale-btn">
        <Icon name="pos" size={44} />
        <span>New Sale</span>
      </Link>
      <div className="home-hint">
        This is the whole home screen for a cashier — one clear action, sync status in
        the header, nothing else competing for attention.
      </div>
    </div>
  )
}
