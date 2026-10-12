import { useMemo } from 'react'
import { useRepo } from '@/data/RepositoryContext'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import { usePageHeader, StatRow, StatCard, Card, SectionLabel, DataTable, Pill, Icon } from '@/components'
import { naira, number } from '@/lib/format'
import { planPrice, normalisePlan, usageDaysOf, usageLevel } from '@/lib/plans'
import { hospitalStatusPill } from '@/lib/status'

// Hospital Network — the admin's landing screen. Every figure/alert is derived
// from the live registry (seed today, platform API later).
export default function OverviewPage() {
  const repo = useRepo()
  usePageHeader({ title: 'Hospital Network', subtitle: 'Dibia HMS system overview' }, [])

  const { data: hospitals } = useLiveQuery(() => repo.list('hospitals'), [repo])
  const { data: tickets } = useLiveQuery(() => repo.list('tickets'), [repo])
  const { data: transactions } = useLiveQuery(() => repo.list('transactions'), [repo])

  const list = hospitals || []

  const stats = useMemo(() => {
    const registered = list.filter((p) => p.status !== 'pending')
    const active = list.filter((p) => p.status === 'active')
    const mrr = active.reduce((sum, p) => sum + planPrice(p.plan), 0)
    const pending = list.filter((p) => p.status === 'pending')
    const usage = active.reduce((sum, p) => sum + usageDaysOf(p), 0)
    const txns = transactions || []
    const paid = txns.filter((t) => t.status === 'paid').length
    const failed = txns.filter((t) => t.status === 'failed').length
    return { registered: registered.length, active: active.length, mrr, pending: pending.length, usage, paid, failed }
  }, [list, transactions])

  const recent = useMemo(
    () => [...list].sort((a, b) => new Date(b.registeredAt) - new Date(a.registeredAt)).slice(0, 4),
    [list],
  )

  const alerts = useMemo(() => {
    const out = []
    const failed = list.filter((p) => p.status === 'failed')
    const pending = list.filter((p) => p.status === 'pending')
    const syncTickets = (tickets || []).filter((t) => t.status === 'open' && /sync/i.test(t.issue))

    if (failed.length) {
      out.push({
        tone: 'critical', icon: 'alert',
        a1: `${failed.length} ${failed.length === 1 ? 'hospital' : 'hospitals'} with failed payments`,
        a2: 'Risk of losing access this week',
      })
    }
    if (pending.length) {
      out.push({
        tone: 'warn', icon: 'clock',
        a1: `${pending.length} new ${pending.length === 1 ? 'registration' : 'registrations'} awaiting approval`,
        a2: pending.map((p) => p.name).join(', '),
      })
    }
    const near = list.filter((p) => p.status === 'active' && usageLevel(p).level !== 'ok')
    if (near.length) {
      out.push({ tone: 'warn', icon: 'alert', a1: `${near.length} ${near.length === 1 ? 'hospital is' : 'hospitals are'} close to a tier ceiling`, a2: near.map((p) => p.name).join(', ') })
    }
    if (syncTickets.length) {
      out.push({
        tone: 'warn', icon: 'support',
        a1: `${syncTickets.length} ${syncTickets.length === 1 ? 'hospital' : 'hospitals'} reported sync issues`,
        a2: 'Open support tickets',
      })
    }
    if (!out.length) {
      out.push({ tone: 'ok', icon: 'check', a1: 'All systems normal', a2: 'Nothing needs your attention right now' })
    }
    return out
  }, [list, tickets])

  return (
    <>
      <StatRow>
        <StatCard label="Active hospitals" value={number(stats.active)} />
        <StatCard label="Usage-days this month" value={number(stats.usage)} />
        <StatCard label="Subscription payments" value={`${number(stats.paid)} paid, ${number(stats.failed)} failed`} />
        <StatCard label="Critical alerts" value={number(alerts.filter((a) => a.tone === 'critical' || a.tone === 'warn').length)} />
      </StatRow>
      <StatRow>
        <StatCard label="Monthly recurring revenue" value={naira(stats.mrr)} />
        <StatCard label="Registered hospitals" value={number(stats.registered)} />
        <StatCard label="Pending approvals" value={number(stats.pending)} />
      </StatRow>

      <div className="grid-2">
        <Card>
          <SectionLabel>Recently registered</SectionLabel>
          <DataTable
            columns={[
              {
                key: 'name', header: 'Hospital',
                render: (p) => (
                  <>
                    <div className="tenant-name">{p.name}</div>
                    <div className="tenant-sub">{p.location}</div>
                  </>
                ),
              },
              { key: 'branches', header: 'Branches' },
              { key: 'plan', header: 'Tier', render: (p) => normalisePlan(p.plan) },
              {
                key: 'status', header: 'Status',
                render: (p) => {
                  const s = hospitalStatusPill(p.status)
                  return <Pill tone={s.tone}>{s.label}</Pill>
                },
              },
            ]}
            rows={recent}
            getRowKey={(p) => p.id}
            empty="No hospitals registered yet"
          />
        </Card>

        <Card>
          <SectionLabel>Hospital network alerts</SectionLabel>
          {alerts.map((a, i) => (
            <div key={i} className={`alert-row ${a.tone}`}>
              <Icon name={a.icon} size={19} />
              <div>
                <div className="a1">{a.a1}</div>
                <div className="a2">{a.a2}</div>
              </div>
            </div>
          ))}
        </Card>
      </div>
    </>
  )
}
