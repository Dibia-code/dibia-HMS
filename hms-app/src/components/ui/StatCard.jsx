import { Link } from 'react-router-dom'
import { cx } from '@/lib/cx'

// Stat card for dashboards (label / big value / optional delta). Matches
// .stat-card; wrap several in <StatRow> for the 4-up grid.
export function StatCard({ label, value, delta, deltaDir = 'flat', tone, to }) {
  const Tag = to ? Link : 'div'
  return (
    <Tag {...(to ? { to } : {})} className={cx('stat-card', tone && `tone-${tone}`, to && 'stat-link')}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {delta != null && <div className={cx('delta', deltaDir)}>{delta}</div>}
    </Tag>
  )
}

export function StatRow({ children, cols }) {
  return <div className={cx('stat-row', cols && `cols-${cols}`)}>{children}</div>
}
