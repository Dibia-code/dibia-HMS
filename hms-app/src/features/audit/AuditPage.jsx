import { useMemo, useState } from 'react'
import { useRepo } from '@/data/RepositoryContext'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import { usePageHeader, Card, DataTable, Icon } from '@/components'
import { formatDateTime } from '@/lib/format'

const show = (v) => {
  if (v == null) return '-'
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'none'
  if (typeof v === 'object') return Object.entries(v).map(([k, x]) => `${k}: ${show(x)}`).join('; ')
  return String(v)
}

export default function AuditPage() {
  const repo = useRepo()
  const { data: audit } = useLiveQuery(() => repo.list('audit_log'), [repo])
  const { data: staff } = useLiveQuery(() => repo.list('staff'), [repo])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(null)

  usePageHeader({ title: 'Audit trail', subtitle: 'Every significant action, who did it, and what changed' }, [])

  const names = useMemo(() => new Map((staff || []).map((s) => [s.id, s.name])), [staff])
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (audit || [])
      .slice()
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .filter((a) => !q || `${a.action} ${a.ref || ''} ${names.get(a.actorId) || ''}`.toLowerCase().includes(q))
      .slice(0, 300)
  }, [audit, query, names])

  return (
    <>
      <div className="search-box mb-2" style={{ maxWidth: 520 }}>
        <Icon name="search" />
        <input aria-label="Search the audit trail" placeholder="Search by staff, action or record" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <Card>
        <DataTable
          onRowClick={(a) => setOpen(open === a.id ? null : a.id)}
          columns={[
            { key: 'at', header: 'When', render: (a) => formatDateTime(a.at) },
            { key: 'who', header: 'Staff', render: (a) => names.get(a.actorId) || (a.actorId ? 'Unknown' : 'System') },
            { key: 'action', header: 'Action', render: (a) => <span className="cell-strong">{a.action.replace(/[._]/g, ' ')}</span> },
            {
              key: 'ref', header: 'Record',
              render: (a) => (
                <div>
                  <div>{a.ref || ''}</div>
                  {open === a.id && (a.before || a.after || a.reason) && (
                    <div className="audit-diff">
                      {a.before && <div><span>Before</span>{show(a.before)}</div>}
                      {a.after && <div><span>After</span>{show(a.after)}</div>}
                      {a.reason && <div><span>Reason</span>{a.reason}</div>}
                    </div>
                  )}
                </div>
              ),
            },
          ]}
          rows={rows}
          empty={<div className="empty-row">No activity recorded.</div>}
        />
      </Card>
      <div className="text-muted mt-2">Records are never deleted. Corrections are logged as new entries.</div>
    </>
  )
}
