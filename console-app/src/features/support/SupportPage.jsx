import { useMemo, useState } from 'react'
import { useRepo } from '@/data/RepositoryContext'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import { usePageHeader, Card, SectionLabel, DataTable, Pill, Button, useToast } from '@/components'
import { number } from '@/lib/format'
import { priorityPill, ticketStatusPill } from '@/lib/status'

// Support — the ticket queue raised by registered hospitals. Read-only for now;
// triage/reply tooling arrives with the support service later (FRONTEND_SPEC §7).
// Open tickets sort first, then by priority.
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 }

export default function SupportPage() {
  const repo = useRepo()
  const toast = useToast()
  const [drafts, setDrafts] = useState({})
  usePageHeader({ title: 'Support', subtitle: 'Tickets raised by registered hospitals' }, [])

  const { data: tickets } = useLiveQuery(() => repo.list('tickets'), [repo])
  const list = tickets || []

  const ordered = useMemo(() => {
    const openFirst = (t) => (t.status === 'open' ? 0 : 1)
    const rank = (t) => PRIORITY_RANK[t.priority] ?? 3
    return [...list].sort((a, b) => openFirst(a) - openFirst(b) || rank(a) - rank(b))
  }, [list])

  const openCount = useMemo(() => list.filter((t) => t.status === 'open').length, [list])
  async function reply(ticket) {
    const replyText = (drafts[ticket.id] || '').trim()
    if (!replyText) return
    await repo.update('tickets', ticket.id, { reply: replyText, repliedAt: new Date().toISOString() })
    setDrafts((current) => ({ ...current, [ticket.id]: '' }))
    toast.success(`Reply saved for ${ticket.hospitalName}`)
  }
  async function resolve(ticket) {
    await repo.update('tickets', ticket.id, { status: 'resolved', resolvedAt: new Date().toISOString() })
    toast.success('Support issue marked resolved')
  }

  return (
    <Card>
      <SectionLabel>Open tickets ({number(openCount)})</SectionLabel>
      <DataTable
        columns={[
          { key: 'hospitalName', header: 'Hospital', render: (t) => <span className="tenant-name">{t.hospitalName}</span> },
          { key: 'issue', header: 'Issue', render: (t) => <div><div>{t.issue || 'No issue details provided'}</div>{t.reply && <div className="tenant-sub">Last reply: {t.reply}</div>}</div> },
          {
            key: 'priority', header: 'Priority',
            render: (t) => {
              const p = priorityPill(t.priority)
              return <Pill tone={p.tone}>{p.label}</Pill>
            },
          },
          {
            key: 'status', header: 'Status',
            render: (t) => {
              const s = ticketStatusPill(t.status)
              return <Pill tone={s.tone}>{s.label}</Pill>
            },
          },
          {
            key: 'actions', header: 'Reply / resolve',
            render: (t) => <div className="ticket-actions"><textarea aria-label={`Reply to ${t.hospitalName}`} rows={2} value={drafts[t.id] ?? ''} onChange={(event) => setDrafts((current) => ({ ...current, [t.id]: event.target.value }))} placeholder="Write a reply…" /><Button variant="secondary" disabled={!(drafts[t.id] || '').trim()} onClick={() => reply(t)}>Save reply</Button>{t.status === 'open' && <Button variant="primary" onClick={() => resolve(t)}>Resolve</Button>}</div>,
          },
        ]}
        rows={ordered}
        getRowKey={(t) => t.id}
        empty="No support tickets"
      />
    </Card>
  )
}
