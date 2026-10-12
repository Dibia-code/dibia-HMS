import { Icon } from '../Icon'

// Empty-state row for tables/lists with no data yet.
export function EmptyState({ icon = 'inventory', title = 'Nothing here yet', hint, action }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '40px 24px' }}>
      <div style={{ color: 'var(--muted-4)', display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
        <Icon name={icon} size={30} />
      </div>
      <div className="fw-600" style={{ fontSize: 15 }}>{title}</div>
      {hint && <div className="text-muted mt-1" style={{ fontSize: 13.5 }}>{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
