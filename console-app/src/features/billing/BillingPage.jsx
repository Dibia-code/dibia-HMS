import { useMemo } from 'react'
import { useRepo } from '@/data/RepositoryContext'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import { usePageHeader, StatRow, StatCard, Card, SectionLabel, DataTable, Pill, Button, useToast } from '@/components'
import { naira, number, formatDate } from '@/lib/format'
import { planPrice, normalisePlan, TIERS } from '@/lib/plans'
import { txnStatusPill, isThisMonth } from '@/lib/status'

// Billing — the platform's revenue view. Every figure is derived from the live
// registry and transaction feed (seed today, billing service later).
export default function BillingPage() {
  const repo = useRepo()
  const toast = useToast()
  usePageHeader({ title: 'Billing', subtitle: 'Subscription revenue across the platform' }, [])

  const { data: hospitals } = useLiveQuery(() => repo.list('hospitals'), [repo])
  const { data: transactions } = useLiveQuery(() => repo.list('transactions'), [repo])

  const hospitalList = hospitals || []
  const txns = transactions || []

  const stats = useMemo(() => {
    const active = hospitalList.filter((p) => p.status === 'active')
    const mrr = active.reduce((sum, p) => sum + planPrice(p.plan), 0)
    const failedThisMonth = txns.filter((t) => t.status === 'failed' && isThisMonth(t.date)).length
    // "Churned" = access an admin has turned off; we don't track cancellation
    // dates, so suspended tenants are the truthful stand-in.
    const churned = hospitalList.filter((p) => p.status === 'suspended').length
    const avgPlan = active.length ? Math.round(mrr / active.length) : 0
    return { mrr, failedThisMonth, churned, avgPlan }
  }, [hospitalList, txns])

  const recent = useMemo(
    () => [...txns].sort((a, b) => new Date(b.date) - new Date(a.date)),
    [txns],
  )
  async function confirmPayment(transaction) {
    await repo.update('transactions', transaction.id, { status: 'paid', confirmedAt: new Date().toISOString() })
    if (transaction.hospitalId) await repo.update('hospitals', transaction.hospitalId, { status: 'active' })
    toast.success(`Payment confirmed for ${transaction.hospitalName}`)
  }

  return (
    <>
      <StatRow>
        <StatCard label="Monthly recurring revenue" value={naira(stats.mrr)} />
        <StatCard label="Failed this month" value={number(stats.failedThisMonth)} />
        <StatCard label="Churned this month" value={number(stats.churned)} />
        <StatCard label="Average plan value" value={naira(stats.avgPlan)} />
      </StatRow>

      <div className="grid-2 mb-3">
        <Card>
          <SectionLabel>Hospitals by tier</SectionLabel>
          {TIERS.map((t) => {
            const count = hospitalList.filter((p) => p.status === 'active' && normalisePlan(p.plan) === t.key).length
            return (
              <div key={t.key} className="alert-row" style={{ justifyContent: 'space-between' }}>
                <div><div className="a1">{t.key}</div><div className="a2">{t.min}{t.max === Infinity ? '+' : ` to ${t.max}`} usage-days · {naira(t.fee)} a month</div></div>
                <b>{count}</b>
              </div>
            )
          })}
        </Card>
        <Card>
          <SectionLabel>Overdue accounts</SectionLabel>
          {hospitalList.filter((p) => p.status === 'failed').length === 0 ? (
            <div className="text-muted">No overdue accounts.</div>
          ) : (
            hospitalList.filter((p) => p.status === 'failed').map((p) => (
              <div key={p.id} className="alert-row"><div><div className="a1">{p.name}</div><div className="a2">Last payment failed · {normalisePlan(p.plan)} tier</div></div></div>
            ))
          )}
        </Card>
      </div>

      <Card>
        <SectionLabel>Recent transactions</SectionLabel>
        <DataTable
          columns={[
            { key: 'hospitalName', header: 'Hospital', render: (t) => <span className="tenant-name">{t.hospitalName}</span> },
            { key: 'plan', header: 'Tier', render: (t) => normalisePlan(t.plan) },
            { key: 'amount', header: 'Amount', render: (t) => naira(t.amount) },
            { key: 'date', header: 'Date', render: (t) => formatDate(t.date) },
            {
              key: 'status', header: 'Status',
              render: (t) => {
                const s = txnStatusPill(t.status)
                return <Pill tone={s.tone}>{s.label}</Pill>
              },
            },
            { key: 'confirm', header: 'Action', render: (t) => t.status === 'failed' ? <Button variant="primary" onClick={() => confirmPayment(t)}>Confirm payment received</Button> : '—' },
          ]}
          rows={recent}
          getRowKey={(t) => t.id}
          empty="No transactions yet"
        />
      </Card>
    </>
  )
}
