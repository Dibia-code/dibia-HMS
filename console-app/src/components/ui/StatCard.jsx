import { cx } from '@/lib/cx'

// A single platform metric (.card.stat-card). StatRow lays four across.
export function StatCard({ label, value, className }) {
  return (
    <div className={cx('card', 'stat-card', className)}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  )
}

export function StatRow({ children }) {
  return <div className="stat-row">{children}</div>
}
