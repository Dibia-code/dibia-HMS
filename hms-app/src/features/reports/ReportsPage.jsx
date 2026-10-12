import { useMemo, useState } from 'react'
import { useRepo } from '@/data/RepositoryContext'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import { usePageHeader, Card, CardHead, DataTable, StatRow, StatCard, Pill } from '@/components'
import { naira, formatDate, formatDateTime } from '@/lib/format'
import { useHospital } from '@/hooks/useHospital'
import { settlement, METHOD_LABEL } from '@/lib/billing'

const DAY = 86_400_000
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }

const PERIODS = [
  { key: 'today', label: 'Today', since: () => startOfToday() },
  { key: 'week', label: 'This week', since: () => Date.now() - 7 * DAY },
  { key: 'month', label: 'This month', since: () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).getTime() } },
  { key: 'all', label: 'All time', since: () => 0 },
]

// Reports — management read-only view of takings and the cashiers' end-of-shift
// closing reports (§5). REPORTS_VIEW.
export default function ReportsPage() {
  const repo = useRepo()
  const [period, setPeriod] = useState('today')

  const { data: sales } = useLiveQuery(() => repo.list('sales'), [repo])
  const { data: reports } = useLiveQuery(() => repo.list('shift_reports'), [repo])
  const { data: staff } = useLiveQuery(() => repo.list('staff'), [repo])
  const { data: visits } = useLiveQuery(() => repo.list('visits'), [repo])
  const { data: payments } = useLiveQuery(() => repo.list('payments'), [repo])
  const { config } = useHospital()

  const cashierName = (id, fallback) => staff?.find((s) => s.id === id)?.name || fallback || 'Cashier'
  const since = PERIODS.find((p) => p.key === period).since()

  const totals = useMemo(() => {
    const inWindow = (sales || []).filter((s) => new Date(s.createdAt).getTime() >= since)
    const by = { cash: 0, transfer: 0, credit: 0 }
    for (const s of inWindow) by[s.payment] = (by[s.payment] || 0) + (s.total || 0)
    return { ...by, total: by.cash + by.transfer + by.credit, count: inWindow.length }
  }, [sales, since])

  const care = useMemo(() => {
    const inWindow = (payments || []).filter((p) => new Date(p.createdAt).getTime() >= since)
    const method = {}
    for (const p of inWindow) {
      for (const m of p.methods) method[m.method] = (method[m.method] || 0) + (p.type === 'refund' ? -m.amount : m.amount)
    }
    const byVisit = new Map()
    for (const p of payments || []) {
      if (!byVisit.has(p.visitId)) byVisit.set(p.visitId, [])
      byVisit.get(p.visitId).push(p)
    }
    const dept = {}
    const service = {}
    const ids = new Set(inWindow.map((p) => p.visitId))
    for (const v of visits || []) {
      if (!ids.has(v.id)) continue
      const st = settlement(v, byVisit.get(v.id) || [], config)
      if (st.total <= 0) continue
      const share = Math.min(1, (st.paid + st.hmo) / st.total)
      const d = v.route?.department || 'Not assigned'
      dept[d] = (dept[d] || 0) + st.total * share
      for (const l of st.lines) service[l.type] = (service[l.type] || 0) + l.amount * share
    }
    return { method, dept, service }
  }, [payments, visits, since, config])

  const closings = useMemo(
    () => [...(reports || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [reports],
  )

  usePageHeader({ title: 'Reports', subtitle: 'Sales & shift closings' }, [])

  const saleCols = [
    { key: 'reference', header: 'Reference', render: (r) => <span className="cell-strong">{r.reference}</span> },
    { key: 'cashierId', header: 'Cashier', render: (r) => cashierName(r.cashierId) },
    { key: 'payment', header: 'Payment', render: (r) => <span style={{ textTransform: 'capitalize' }}>{r.payment}</span> },
    { key: 'createdAt', header: 'Time', render: (r) => formatDateTime(r.createdAt) },
    { key: 'total', header: 'Amount', align: 'num', render: (r) => naira(r.total || 0) },
  ]
  const saleRows = useMemo(
    () => (sales || []).filter((s) => new Date(s.createdAt).getTime() >= since).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [sales, since],
  )

  return (
    <>
      <div className="filter-chips mb-3">
        {PERIODS.map((p) => (
          <button key={p.key} type="button" className={`filter-chip ${period === p.key ? 'active' : ''}`} onClick={() => setPeriod(p.key)}>
            {p.label}
          </button>
        ))}
      </div>

      <StatRow>
        <StatCard label="Cash" value={naira(totals.cash)} />
        <StatCard label="Transfer" value={naira(totals.transfer)} />
        <StatCard label="Credit" value={naira(totals.credit)} />
        <StatCard label="Total sales" value={naira(totals.total)} delta={`${totals.count} transaction${totals.count === 1 ? '' : 's'}`} />
      </StatRow>

      <div className="section-label">Patient billing</div>
      <div className="grid grid-3">
        <Card>
          <CardHead title="By payment method" />
          {Object.keys(care.method).length === 0 ? <div className="empty-row">No patient payments in this period.</div> : Object.entries(care.method).map(([k, v]) => (
            <div key={k} className="row-line"><span className="grow">{METHOD_LABEL[k] || k}</span><span className="tabular fw-600">{naira(v)}</span></div>
          ))}
        </Card>
        <Card>
          <CardHead title="By department" />
          {Object.keys(care.dept).length === 0 ? <div className="empty-row">Nothing yet.</div> : Object.entries(care.dept).map(([k, v]) => (
            <div key={k} className="row-line"><span className="grow">{k}</span><span className="tabular fw-600">{naira(v)}</span></div>
          ))}
        </Card>
        <Card>
          <CardHead title="By service type" />
          {Object.keys(care.service).length === 0 ? <div className="empty-row">Nothing yet.</div> : Object.entries(care.service).map(([k, v]) => (
            <div key={k} className="row-line"><span className="grow" style={{ textTransform: 'capitalize' }}>{k === 'pharmacy' ? 'Pharmacy charges' : k === 'bed' ? 'Bed and admission' : k}</span><span className="tabular fw-600">{naira(v)}</span></div>
          ))}
        </Card>
      </div>

      <div className="grid grid-2 mt-3">
        <Card>
          <CardHead title="Closing sessions" />
          {closings.length === 0 ? (
            <div className="empty-row">No shift reports submitted yet.</div>
          ) : (
            closings.map((r) => {
              const balanced = (r.variance || 0) === 0
              return (
                <div key={r.id} className="row-line">
                  <div className="grow">
                    <div className="r-title">{cashierName(r.cashierId, r.cashierName)}</div>
                    <div className="r-sub">
                      {formatDate(r.createdAt)} · expected {naira(r.expectedCash || 0)} · counted {naira(r.countedCash || 0)}
                      {r.note ? ` · ${r.note}` : ''}
                    </div>
                  </div>
                  <Pill tone={balanced ? 'confirmed' : 'critical'}>
                    {balanced ? 'Balanced' : `${(r.variance || 0) > 0 ? 'Over' : 'Short'} ${naira(Math.abs(r.variance || 0))}`}
                  </Pill>
                </div>
              )
            })
          )}
        </Card>

        <Card>
          <CardHead title={`Sales (${saleRows.length})`} />
          <DataTable columns={saleCols} rows={saleRows} empty={<div className="empty-row">No sales in this period.</div>} />
        </Card>
      </div>
    </>
  )
}
