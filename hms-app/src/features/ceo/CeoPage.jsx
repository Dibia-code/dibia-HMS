import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { useRepo } from '@/data/RepositoryContext'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import { usePageHeader, Card, SectionLabel, Icon } from '@/components'
import { naira, nairaCompact } from '@/lib/format'

const DAY = 86_400_000
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }
const daysUntil = (iso) => (iso ? Math.round((new Date(iso).getTime() - Date.now()) / DAY) : Infinity)
const isToday = (iso) => iso && new Date(iso).getTime() >= startOfToday()

// CEO / Owner view (§4) — a cross-branch cockpit: headline numbers, one-tap
// "act as" any role, per-branch performance, and alerts. Every figure here is
// derived from live local data, never hard-coded.
export default function CeoPage() {
  const { user } = useAuth()
  const repo = useRepo()
  const slug = user?.hospitalSlug

  const { data: sales } = useLiveQuery(() => repo.list('sales'), [repo])
  const { data: products } = useLiveQuery(() => repo.list('products'), [repo])
  const { data: staff } = useLiveQuery(() => repo.list('staff'), [repo])
  const { data: branches } = useLiveQuery(() => repo.list('branches'), [repo])
  const { data: customers } = useLiveQuery(() => repo.list('customers'), [repo])
  const { data: reports } = useLiveQuery(() => repo.list('shift_reports'), [repo])

  const costOf = useMemo(() => {
    const m = new Map((products || []).map((p) => [p.id, p.costPrice || 0]))
    return (productId) => m.get(productId) || 0
  }, [products])

  const profitOfSale = (s) =>
    (s.items || []).reduce((sum, l) => sum + ((l.price || 0) - costOf(l.productId)) * (l.qty || 0), 0)

  const stats = useMemo(() => {
    const todays = (sales || []).filter((s) => isToday(s.createdAt))
    return {
      salesToday: todays.reduce((sum, s) => sum + (s.total || 0), 0),
      profitToday: todays.reduce((sum, s) => sum + profitOfSale(s), 0),
      stockValue: (products || []).reduce((sum, p) => sum + (p.quantity || 0) * (p.costPrice || 0), 0),
      staffActive: (staff || []).filter((s) => s.active !== false).length,
    }
  }, [sales, products, staff])

  const branchPerf = useMemo(
    () =>
      (branches || []).map((b) => {
        const bsales = (sales || []).filter((s) => s.branchId === b.id && isToday(s.createdAt))
        const staffCount = (staff || []).filter((s) => s.branchId === b.id).length
        return {
          id: b.id,
          name: b.name + (b.isMain ? ' (Head office)' : ''),
          staffCount,
          count: bsales.length,
          sales: bsales.reduce((sum, s) => sum + (s.total || 0), 0),
          profit: bsales.reduce((sum, s) => sum + profitOfSale(s), 0),
        }
      }),
    [branches, sales, staff],
  )

  const alerts = useMemo(() => {
    const out = []
    const restock = (products || []).filter((p) => (p.quantity || 0) <= (p.reorderLevel || 0))
    if (restock.length) out.push({ tone: 'warn', icon: 'alert', a1: `${restock.length} product${restock.length === 1 ? '' : 's'} need restocking`, a2: restock.slice(0, 3).map((p) => p.name).join(', ') })
    const expiring = (products || []).filter((p) => daysUntil(p.expiry) <= 30)
    if (expiring.length) out.push({ tone: 'warn', icon: 'alert', a1: `${expiring.length} product${expiring.length === 1 ? '' : 's'} near expiry`, a2: 'Within the 30-day expiry window' })
    const overdue = (customers || []).filter((c) => c.standing === 'overdue')
    if (overdue.length) out.push({ tone: 'critical', icon: 'alert', a1: `${overdue.length} overdue credit account${overdue.length === 1 ? '' : 's'}`, a2: overdue.map((c) => c.name).join(', ') })
    const variances = (reports || []).filter((r) => (r.variance || 0) !== 0)
    if (variances.length) out.push({ tone: 'critical', icon: 'alert', a1: 'Cash variance on a closing report', a2: `${variances.length} shift${variances.length === 1 ? '' : 's'} did not balance` })
    if (!out.length) out.push({ tone: 'ok', icon: 'check', a1: 'All systems normal', a2: 'No stock, credit, or cash-variance alerts' })
    return out
  }, [products, customers, reports])

  usePageHeader({ title: 'CEO View', subtitle: 'All branches, remote monitoring' }, [])

  const actAs = [
    { label: 'Act as Cashier — New Sale', to: 'pos' },
    { label: 'Act as Inventory Officer', to: 'inventory' },
    { label: 'Act as Purchasing', to: 'purchasing' },
    { label: 'Act as Warehouse Manager', to: 'warehouse' },
    { label: 'Manage staff & roles', to: 'staff' },
  ]

  return (
    <>
      <div className="stat-row">
        <div className="stat-card"><div className="label">Total sales today</div><div className="value">{naira(stats.salesToday)}</div></div>
        <div className="stat-card"><div className="label">Net profit (est.)</div><div className="value">{naira(stats.profitToday)}</div></div>
        <div className="stat-card"><div className="label">Total stock value</div><div className="value">{nairaCompact(stats.stockValue)}</div></div>
        <div className="stat-card"><div className="label">Staff active now</div><div className="value">{stats.staffActive}</div></div>
      </div>

      <Card className="mt-3 mb-3">
        <SectionLabel>Act as</SectionLabel>
        <div style={{ fontSize: 12.5, color: 'var(--muted-3)', marginBottom: 14 }}>
          As the owner, you have full access — jump into any part of the system directly, the same as any staff member would.
        </div>
        <div className="act-as">
          {actAs.map((a) => (
            <Link key={a.to} className="btn btn-ghost" to={`/${slug}/${a.to}`}>{a.label}</Link>
          ))}
        </div>
      </Card>

      <div className="grid grid-2">
        <Card>
          <SectionLabel>Branch performance (today)</SectionLabel>
          {branchPerf.length === 0 ? (
            <div className="empty-row">No branches yet.</div>
          ) : (
            branchPerf.map((b) => (
              <div key={b.id} className="branch-perf">
                <div>
                  <div className="bp-name">{b.name}</div>
                  <div className="bp-sub">{b.staffCount} staff · {b.count} sale{b.count === 1 ? '' : 's'} today</div>
                </div>
                <div className="bp-figs">
                  <div className="bp-fig"><div className="n">{naira(b.sales)}</div><div className="l">Sales</div></div>
                  <div className="bp-fig"><div className="n">{naira(b.profit)}</div><div className="l">Profit</div></div>
                </div>
              </div>
            ))
          )}
        </Card>

        <Card>
          <SectionLabel>Alerts</SectionLabel>
          {alerts.map((a, i) => (
            <div key={i} className={`alert-row ${a.tone}`}>
              <Icon name={a.icon} />
              <div><div className="a1">{a.a1}</div><div className="a2">{a.a2}</div></div>
            </div>
          ))}
        </Card>
      </div>
    </>
  )
}
