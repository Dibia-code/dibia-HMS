import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { PERM } from '@/auth/permissions'
import { ROLE, roleLabel } from '@/auth/roles'
import { useRepo } from '@/data/RepositoryContext'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import { useHospital } from '@/hooks/useHospital'
import { usePageHeader, useToast, Card, CardHead, StatRow, StatCard, Pill, DataTable, Icon, Button } from '@/components'
import { summarise, daysLeft } from '@/lib/stock'
import { settlement } from '@/lib/billing'
import { useUsageDays } from '@/hooks/useUsageDays'
import { naira, number, formatDate, relativeTime } from '@/lib/format'

const isToday = (iso) => {
  const d = new Date(iso)
  const n = new Date()
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
}

function useHospitalData() {
  const repo = useRepo()
  const { config } = useHospital()
  const { data: visits } = useLiveQuery(() => repo.list('visits'), [repo])
  const { data: payments } = useLiveQuery(() => repo.list('payments'), [repo])
  return { visits: visits || [], payments: payments || [], config }
}

function UsageMeter() {
  const u = useUsageDays()
  return (
    <div className={`stat-card usage tone-${u.level === 'ok' ? 'info' : u.level}`}>
      <div className="label">Usage-days this month</div>
      <div className="meter" role="progressbar" aria-valuenow={u.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Usage-day meter">
        <div className={`meter-fill ${u.level}`} style={{ width: `${Math.max(u.pct, 8)}%` }}>
          <span>{u.pct}%</span>
        </div>
      </div>
      <div className="delta">
        {number(u.days)} of {u.tier.max === Infinity ? 'unlimited' : number(u.tier.max)} on the {u.tier.name} tier
        {u.upcoming && u.pct >= 80 ? `. Next tier: ${u.upcoming.name}, from ${number(u.upcoming.min)} usage-days.` : ''}
      </div>
    </div>
  )
}

function AdminGrid({ financeOnly = false }) {
  const { user } = useAuth()
  const repo = useRepo()
  const { visits, payments, config } = useHospitalData()
  const { data: sales } = useLiveQuery(() => repo.list('sales'), [repo])
  const { data: staff } = useLiveQuery(() => repo.list('staff'), [repo])

  const figures = useMemo(() => {
    const byVisit = new Map()
    for (const p of payments) {
      if (!byVisit.has(p.visitId)) byVisit.set(p.visitId, [])
      byVisit.get(p.visitId).push(p)
    }
    let revenue = 0
    for (const p of payments) {
      if (!isToday(p.createdAt)) continue
      if (p.type === 'refund') revenue -= p.amount
      else revenue += p.methods.filter((m) => m.method !== 'hmo').reduce((s, m) => s + m.amount, 0)
    }
    for (const s of sales || []) if (isToday(s.createdAt)) revenue += s.total || 0

    let outstanding = 0
    let outstandingCount = 0
    let hmo = 0
    for (const v of visits) {
      const st = settlement(v, byVisit.get(v.id) || [], config)
      outstanding += st.balance
      if (st.balance > 0) outstandingCount += 1
      hmo += st.hmo
    }
    const active = visits.filter((v) => v.status !== 'closed').length
    const cutoff = Date.now() - 5 * 60_000
    const online = (staff || []).filter((m) => m.active !== false && m.lastActiveAt && new Date(m.lastActiveAt).getTime() > cutoff).length
    return { revenue, outstanding, outstandingCount, hmo, active, online }
  }, [visits, payments, sales, config, staff])

  return financeOnly ? (
    <div className="stat-row cols-3">
      <StatCard label="Today’s collections" value={naira(figures.revenue)} tone="ok" />
      <StatCard label="Outstanding patient bills" value={naira(figures.outstanding)} delta={`${figures.outstandingCount} open bill${figures.outstandingCount === 1 ? '' : 's'}`} tone={figures.outstanding ? 'warn' : 'ok'} />
      <StatCard label="HMO receivables" value={naira(figures.hmo)} tone="info" />
    </div>
  ) : (
    <div className="stat-row cols-2x3">
      <StatCard label="Today’s revenue" value={naira(figures.revenue)} tone="ok" />
      <StatCard label="Outstanding bills" value={naira(figures.outstanding)} delta={`${figures.outstandingCount} bill${figures.outstandingCount === 1 ? '' : 's'}`} tone={figures.outstanding ? 'warn' : 'ok'} />
      <StatCard label="HMO receivables" value={naira(figures.hmo)} tone="info" />
      <StatCard label="Active patients" value={number(figures.active)} delta="open visits" />
      <StatCard label="Staff online now" value={number(figures.online)} delta={`of ${number((staff || []).filter((s) => s.active !== false).length)} active accounts`} tone="info" />
      <UsageMeter />
    </div>
  )
}

function PharmacyDashboard({ full }) {
  const { user, can } = useAuth()
  const repo = useRepo()
  const { config } = useHospital()
  const { data: products } = useLiveQuery(() => repo.list('products'), [repo])
  const { data: batches } = useLiveQuery(() => repo.list('batches'), [repo])
  const { data: sales } = useLiveQuery(() => repo.list('sales'), [repo])
  const { data: branches } = useLiveQuery(() => repo.list('branches'), [repo])
  const { data: audit } = useLiveQuery(() => repo.list('audit_log'), [repo])
  const { data: counts } = useLiveQuery(() => repo.list('stock_counts'), [repo])
  const { data: prescriptions } = useLiveQuery(() => repo.list('prescriptions'), [repo])

  const stock = useMemo(() => {
    const items = (products || []).filter((p) => !p.archived).map((p) => ({ product: p, s: summarise(p, batches || [], config.expiryWindows) }))
    const restock = items.filter((i) => ['low', 'out', 'expired'].includes(i.s.status)).sort((a, b) => a.s.criticality - b.s.criticality)
    const widest = Math.max(...config.expiryWindows)
    const productName = new Map((products || []).map((p) => [p.id, p.name]))
    const expiring = (batches || [])
      .filter((b) => (b.balance || 0) > 0 && b.expiry && daysLeft(b.expiry) <= widest)
      .map((b) => ({ ...b, name: productName.get(b.productId) || 'Unknown', days: daysLeft(b.expiry) }))
      .sort((a, b) => a.days - b.days)
    return { restock, expiring }
  }, [products, batches, config.expiryWindows])

  const branchPerf = useMemo(() => {
    const byBranch = new Map()
    for (const s of sales || []) byBranch.set(s.branchId, (byBranch.get(s.branchId) || 0) + (s.total || 0))
    return (branches || []).map((b) => ({ ...b, revenue: byBranch.get(b.id) || 0 }))
  }, [sales, branches])

  const queueRows = (prescriptions || []).filter((r) => r.status === 'pending' || r.status === 'partial').sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).slice(0, 5)
  const dispensing = (prescriptions || []).filter((r) => r.status === 'pending' || r.status === 'partial').length
  const lastCount = (counts || []).map((c) => c.createdAt).sort().pop()

  return (
    <>
      {!full && (
        <StatRow cols={3}>
          <StatCard to={`/${user.hospitalSlug}/dispensing`} label="Dispensing queue" value={number(dispensing)} delta="prescriptions waiting" tone={dispensing ? 'warn' : 'ok'} />
          <StatCard to={`/${user.hospitalSlug}/inventory?tab=restock`} label="Restock needed" value={number(stock.restock.length)} delta={stock.restock.length ? 'at or below threshold' : 'all healthy'} deltaDir={stock.restock.length ? 'down' : 'up'} tone={stock.restock.length ? 'warn' : 'ok'} />
          <StatCard to={`/${user.hospitalSlug}/inventory?tab=expiring`} label="Expiry alerts" value={number(stock.expiring.length)} delta="batches inside a warning window" tone={stock.expiring.length ? 'expiry' : 'ok'} />
        </StatRow>
      )}
      {!full && <div className="text-muted mt-1">Last stocktake: {lastCount ? formatDate(lastCount) : 'none recorded'}</div>}

      {!full && can(PERM.DISPENSE) && queueRows.length > 0 && (
        <Card className="mt-3">
          <CardHead title="Waiting for the pharmacy" />
          {queueRows.map((r) => (
            <Link key={r.id} to={`/${user.hospitalSlug}/dispensing/${r.id}`} className="row-line dash-link">
              <span className="grow"><span className="r-title">{r.patientName}</span><span className="r-sub">{r.lines.length} drug line{r.lines.length === 1 ? '' : 's'} · {relativeTime(r.createdAt)}</span></span>
              <Icon name="chevronRight" />
            </Link>
          ))}
        </Card>
      )}

      <div className="grid grid-2 mt-3">
        <Card>
          <CardHead title="Expiring batches">
            <div className="spacer" />
            <Pill tone={stock.expiring.length ? 'expiry' : 'active'}>{stock.expiring.length} {stock.expiring.length === 1 ? 'batch' : 'batches'}</Pill>
          </CardHead>
          <DataTable
            rowStatus={(r) => (r.days < 0 ? 'crit' : 'expiry')}
            columns={[
              { key: 'name', header: 'Product', render: (r) => <span className="cell-strong">{r.name}</span> },
              { key: 'batchNo', header: 'Batch' },
              { key: 'expiry', header: 'Expiry', render: (r) => (<span className={r.days < 0 ? 'text-critical fw-600' : ''}>{formatDate(r.expiry)} · {r.days < 0 ? 'expired' : `${r.days}d`}</span>) },
              { key: 'balance', header: 'Qty', align: 'num' },
            ]}
            rows={stock.expiring.slice(0, 6)}
            empty={<div className="empty-row">No stock inside an expiry window.</div>}
          />
        </Card>

        <Card>
          <CardHead title="Restock needed" />
          <DataTable
            rowStatus={({ s }) => (s.status === 'low' ? 'warn' : 'crit')}
            columns={[
              { key: 'name', header: 'Product', render: ({ product }) => <span className="cell-strong">{product.name}</span> },
              { key: 'q', header: 'Available', align: 'num', render: ({ s }) => s.sellable },
              { key: 't', header: 'Threshold', align: 'num', render: ({ s }) => s.threshold },
            ]}
            rows={stock.restock.slice(0, 6)}
            getRowKey={({ product }) => product.id}
            empty={<div className="empty-row">Every drug is above its threshold.</div>}
          />
        </Card>
      </div>

      {full && (
        <div className="grid grid-2 mt-3">
          <Card>
            <CardHead title="Branch performance" />
            <DataTable
              columns={[
                { key: 'name', header: 'Branch', render: (r) => <span className="cell-strong">{r.name}</span> },
                { key: 'revenue', header: 'Retail sales', align: 'num', render: (r) => naira(r.revenue) },
              ]}
              rows={branchPerf}
            />
          </Card>
          <Card>
            <CardHead title="Recent activity" />
            {(audit || [])
              .filter((a) => a.action !== 'auth.login')
              .sort((a, b) => new Date(b.at) - new Date(a.at))
              .slice(0, 5)
              .map((a) => (
                <div key={a.id} className="row-line">
                  <span className="grow">
                    <span className="r-title">{a.action.replace(/[._]/g, ' ')}</span>
                    <span className="r-sub">{a.ref}</span>
                  </span>
                  <span className="r-sub tabular">{relativeTime(a.at)}</span>
                </div>
              ))}
          </Card>
        </div>
      )}
    </>
  )
}

function DuplicateReview() {
  const repo = useRepo()
  const toast = useToast()
  const { user } = useAuth()
  const { data: patients } = useLiveQuery(() => repo.list('patients'), [repo])
  const byId = new Map((patients || []).map((p) => [p.id, p]))
  const open = (patients || []).filter((p) => p.duplicateReview === 'open')
  if (!open.length) return null

  async function resolve(p, outcome) {
    await repo.update('patients', p.id, { duplicateReview: outcome })
    await repo.create('audit_log', { action: 'patient.duplicate_reviewed', ref: p.fullName, actorId: user.userId, at: new Date().toISOString(), after: { outcome } })
    toast.success('Marked as reviewed')
  }

  return (
    <Card className="mt-3 status-interaction">
      <CardHead title="Possible duplicate patients to review" />
      {open.map((p) => (
        <div key={p.id} className="row-line">
          <span className="grow">
            <span className="r-title">{p.fullName} · {p.dibiaId}</span>
            <span className="r-sub">May match {(p.possibleDuplicateOf || []).map((id) => byId.get(id)?.fullName).filter(Boolean).join(', ') || 'another record'}</span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => resolve(p, 'kept_separate')}>Keep separate</Button>
          <Button size="sm" variant="primary" onClick={() => resolve(p, 'reviewed')}>Mark reviewed</Button>
        </div>
      ))}
    </Card>
  )
}

function QuickAccess() {
  const { user, can } = useAuth()
  const tiles = [
    ['staff', 'Staff management', 'Add, suspend and set access', 'staff', PERM.STAFF_MANAGE],
    ['devices', 'Device management', 'Approve or revoke devices', 'monitor', PERM.SETTINGS_MANAGE],
    ['audit', 'Audit trail', 'Every action, by whom', 'activity', PERM.AUDIT_VIEW],
    ['reports', 'Billing and reports', 'Revenue, shifts, HMO', 'reports', PERM.REPORTS_VIEW],
  ].filter((t) => can(t[4]))
  return (
    <div className="quick-row">
      {tiles.map(([to, title, sub, icon]) => (
        <Link key={to} to={`/${user.hospitalSlug}/${to}`} className="quick-tile">
          <Icon name={icon} />
          <span><b>{title}</b><small>{sub}</small></span>
        </Link>
      ))}
    </div>
  )
}

function LowStockAlert() {
  const repo = useRepo()
  const { config } = useHospital()
  const { data: products } = useLiveQuery(() => repo.list('products'), [repo])
  const { data: batches } = useLiveQuery(() => repo.list('batches'), [repo])
  if (!config.notifyLowStock) return null
  const low = (products || []).filter((p) => !p.archived).map((p) => ({ p, s: summarise(p, batches || [], config.expiryWindows) })).filter((i) => i.s.status === 'low' || i.s.status === 'out')
  if (!low.length) return null
  return (
    <div className="banner" style={{ position: 'static', marginBottom: 16, borderRadius: 'var(--r-card)', border: '1px solid var(--banner-warn-border)' }} role="status">
      <Icon name="alert" />
      <div className="msg">Running low: {low.slice(0, 4).map((i) => i.p.name).join(', ')}{low.length > 4 ? ` and ${low.length - 4} more` : ''}.</div>
    </div>
  )
}

function ReceptionBlock() {
  const { user } = useAuth()
  const { visits } = useHospitalData()
  const registered = visits.filter((v) => isToday(v.openedAt)).length
  const queue = visits.filter((v) => v.status === 'waiting').length
  const waiting = visits.filter((v) => v.status === 'waiting').sort((a, b) => new Date(a.openedAt) - new Date(b.openedAt)).slice(0, 5)
  return (
    <>
      <StatRow cols={3}>
        <StatCard label="Patients registered today" value={number(registered)} tone="info" />
        <StatCard label="Waiting in queue" value={number(queue)} tone={queue ? 'warn' : 'ok'} />
        <StatCard label="Open visits" value={number(visits.filter((v) => v.status !== 'closed').length)} />
      </StatRow>
      <div className="mt-3 row wrap">
        <Link to={`/${user.hospitalSlug}/reception`} className="btn btn-primary btn-lg">Register new patient</Link>
        <Link to={`/${user.hospitalSlug}/queue`} className="btn btn-ghost btn-lg">View queue</Link>
      </div>
      {waiting.length > 0 && (
        <Card className="mt-3">
          <CardHead title="Waiting now" />
          {waiting.map((v) => (
            <Link key={v.id} to={`/${user.hospitalSlug}/queue`} className="row-line dash-link">
              <span className="grow"><span className="r-title">{v.patientName}</span><span className="r-sub">{v.route?.department || 'Not assigned'} · {relativeTime(v.openedAt)}</span></span>
              <Icon name="chevronRight" />
            </Link>
          ))}
        </Card>
      )}
    </>
  )
}

function CashierBlock() {
  const { user } = useAuth()
  const { visits, payments, config } = useHospitalData()
  const mine = payments.filter((p) => p.cashierId === user.userId && isToday(p.createdAt))
  const collected = mine.reduce((s, p) => (p.type === 'refund' ? s - p.amount : s + p.methods.filter((m) => m.method !== 'hmo').reduce((a, m) => a + m.amount, 0)), 0)
  const owing = useMemo(() => {
    const byVisit = new Map()
    for (const p of payments) {
      if (!byVisit.has(p.visitId)) byVisit.set(p.visitId, [])
      byVisit.get(p.visitId).push(p)
    }
    return visits.filter((v) => settlement(v, byVisit.get(v.id) || [], config).balance > 0).length
  }, [visits, payments, config])
  const atCashier = visits.filter((v) => v.status === 'at_cashier').length
  const awaiting = useMemo(() => {
    const byVisit = new Map()
    for (const p of payments) {
      if (!byVisit.has(p.visitId)) byVisit.set(p.visitId, [])
      byVisit.get(p.visitId).push(p)
    }
    return visits
      .map((v) => ({ v, st: settlement(v, byVisit.get(v.id) || [], config) }))
      .filter((r) => r.st.balance > 0)
      .sort((a, b) => (b.v.status === 'at_cashier') - (a.v.status === 'at_cashier') || new Date(a.v.openedAt) - new Date(b.v.openedAt))
      .slice(0, 5)
  }, [visits, payments, config])

  return (
    <>
      <StatRow cols={3}>
        <StatCard label="Your collections today" value={naira(collected)} tone="ok" />
        <StatCard label="Outstanding bills" value={number(owing)} tone={owing ? 'warn' : 'ok'} />
        <StatCard label="Waiting at cashier" value={number(atCashier)} tone={atCashier ? 'warn' : 'ok'} />
      </StatRow>
      <div className="mt-3">
        <Link to={`/${user.hospitalSlug}/cashier`} className="btn btn-primary btn-lg">New payment</Link>
      </div>
      {awaiting.length > 0 && (
        <Card className="mt-3">
          <CardHead title="Awaiting payment" />
          {awaiting.map(({ v, st }) => (
            <Link key={v.id} to={`/${user.hospitalSlug}/cashier?visit=${v.id}`} className="row-line dash-link">
              <span className="grow"><span className="r-title">{v.patientName}</span><span className="r-sub">{v.dibiaId} · {v.status === 'at_cashier' ? 'At the cashier' : 'Bill open'}</span></span>
              <b className="tabular">{naira(st.balance)}</b>
              <Icon name="chevronRight" />
            </Link>
          ))}
        </Card>
      )}
    </>
  )
}

export default function DashboardPage() {
  const { user, can } = useAuth()
  const roles = user?.roles || []
  // Only hospital-level leadership sees the Hospital Management dashboard.
  // Branch managers have their own operational dashboard for their branch.
  const isHospitalManagement = roles.some((role) => [ROLE.FACILITY_ADMIN, ROLE.CEO_OWNER, ROLE.SUPER_ADMIN].includes(role))
  const admin = isHospitalManagement && can(PERM.DASHBOARD_ADMIN)
  const branchManager = !admin && roles.includes(ROLE.BRANCH_MANAGER)
  const showReception = !admin && !branchManager && can(PERM.PATIENTS_MANAGE)
  const showCashier = !admin && !branchManager && roles.some((role) => role === ROLE.CASHIER || role === ROLE.PHARMACY_CASHIER)
  const pharmacyRoles = [ROLE.PHARMACIST, ROLE.SUPERINTENDENT_PHARMACIST, ROLE.DISPENSER, ROLE.PHARMACY_CASHIER, ROLE.INVENTORY_OFFICER, ROLE.SALES_STAFF, ROLE.WAREHOUSE_OFFICER]
  const showPharmacy = !admin && !branchManager && roles.some((role) => pharmacyRoles.includes(role))
  const showFinance = !admin && !branchManager && roles.includes(ROLE.ACCOUNTANT)
  const primaryRole = roles.find((role) => role === ROLE.FACILITY_ADMIN || role === ROLE.CEO_OWNER || role === ROLE.SUPER_ADMIN)
    || roles[0]
  const dashboardTitle = primaryRole ? `${roleLabel(primaryRole)} dashboard` : 'Hospital dashboard'

  usePageHeader(
    { title: dashboardTitle, subtitle: user?.hospitalName ? `${user.hospitalName} · your work at a glance` : 'Your work at a glance' },
    [user?.hospitalName],
  )

  return (
    <>
      {admin && (
        <>
          <LowStockAlert />
          <AdminGrid />
          <QuickAccess />
          <DuplicateReview />
          <PharmacyDashboard full />
        </>
      )}
      {branchManager && (
        <>
          <AdminGrid financeOnly />
          <QuickAccess />
          <ReceptionBlock />
          <div className="mt-3"><CashierBlock /></div>
          <div className="mt-3"><PharmacyDashboard /></div>
        </>
      )}
      {showReception && <ReceptionBlock />}
      {showCashier && (
        <div className={showReception ? 'mt-3' : ''}>
          <CashierBlock />
        </div>
      )}
      {showPharmacy && <PharmacyDashboard />}
      {showFinance && (
        <>
          <AdminGrid financeOnly />
          <QuickAccess />
        </>
      )}
    </>
  )
}
