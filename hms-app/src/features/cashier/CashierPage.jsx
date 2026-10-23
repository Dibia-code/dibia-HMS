import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { PERM } from '@/auth/permissions'
import { useRepo } from '@/data/RepositoryContext'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import { useHospital } from '@/hooks/useHospital'
import { useToast, usePageHeader, Button, Card, CardHead, Field, Input, Pill, PayToggle, ConfirmDialog, EmptyState, Icon } from '@/components'
import { settlement, BILL_STATUS, METHOD_LABEL, vatLabel } from '@/lib/billing'
import { STATUS_BY_KEY } from '@/lib/hospital'
import { naira, relativeTime } from '@/lib/format'
import { ReceiptView } from './Receipt'

const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'pos', label: 'POS / card' },
  { value: 'transfer', label: 'Bank transfer' },
  { value: 'hmo', label: 'HMO' },
  { value: 'split', label: 'Split' },
]
const SPLIT_METHODS = ['cash', 'pos', 'transfer', 'hmo']

const money = (v) => {
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

export default function CashierPage() {
  const { user, can } = useAuth()
  const repo = useRepo()
  const toast = useToast()
  const { hospital, config } = useHospital()
  const pharmacyStaff = (user?.roles || []).some((role) => ['pharmacist', 'superintendent_pharmacist', 'pharmacy_cashier', 'dispenser', 'sales_staff'].includes(role))
  const collectionBlocked = !config.pharmacyCollectPayments && pharmacyStaff && !can(PERM.SETTINGS_MANAGE)
  const [params, setParams] = useSearchParams()

  const { data: visits } = useLiveQuery(() => repo.list('visits'), [repo])
  const { data: payments } = useLiveQuery(() => repo.list('payments'), [repo])

  const [query, setQuery] = useState('')
  const [method, setMethod] = useState('cash')
  const [amount, setAmount] = useState('')
  const [tendered, setTendered] = useState('')
  const [split, setSplit] = useState([{ method: 'cash', amount: '' }, { method: 'pos', amount: '' }])
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState(null)

  usePageHeader({ title: 'New payment', subtitle: 'Find the patient, review the bill, collect payment' }, [])

  const visitId = params.get('visit')
  const paymentsByVisit = useMemo(() => {
    const map = new Map()
    for (const p of payments || []) {
      if (!map.has(p.visitId)) map.set(p.visitId, [])
      map.get(p.visitId).push(p)
    }
    return map
  }, [payments])

  const rows = useMemo(
    () =>
      (visits || []).map((v) => ({ visit: v, st: settlement(v, paymentsByVisit.get(v.id) || [], config) })),
    [visits, paymentsByVisit, config],
  )

  const owing = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows
      .filter((r) => r.st.balance > 0)
      .filter((r) => !q || `${r.visit.patientName} ${r.visit.dibiaId} ${r.visit.visitNo}`.toLowerCase().includes(q))
      .sort((a, b) => {
        const ac = a.visit.status === 'at_cashier' ? 0 : 1
        const bc = b.visit.status === 'at_cashier' ? 0 : 1
        return ac - bc || new Date(b.visit.openedAt) - new Date(a.visit.openedAt)
      })
  }, [rows, query])

  const advanceable = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows
      .filter((r) => r.visit.status !== 'closed' && r.st.status === 'empty')
      .filter((r) => !q || `${r.visit.patientName} ${r.visit.dibiaId} ${r.visit.visitNo}`.toLowerCase().includes(q))
  }, [rows, query])

  const current = rows.find((r) => r.visit.id === visitId) || null
  const st = current?.st
  const visit = current?.visit
  const due = st?.balance || 0
  const advance = !!current && st.total === 0 && visit.status !== 'closed'

  useEffect(() => {
    if (!current) return
    setAmount(current.st.total === 0 ? '' : String(due))
    setTendered('')
    setMethod('cash')
    setSplit([{ method: 'cash', amount: '' }, { method: 'pos', amount: '' }])
  }, [visitId, due]) // eslint-disable-line react-hooks/exhaustive-deps

  function select(id) {
    setParams(id ? { visit: id } : {})
  }

  const collect = advance ? money(amount) : Math.min(money(amount), due)
  const splitTotal = split.reduce((s, r) => s + money(r.amount), 0)
  const change = method === 'cash' && money(tendered) > collect ? money(tendered) - collect : 0

  let problem = ''
  if (current) {
    if (collect <= 0) problem = 'Enter the amount to collect'
    else if (!advance && money(amount) > due + 0.001) problem = 'Amount is more than the balance due'
    else if (advance && (method === 'hmo' || (method === 'split' && split.some((r) => r.method === 'hmo' && money(r.amount) > 0)))) problem = 'HMO cannot be used for an advance payment'
    else if (method === 'hmo' && !visit.hmo) problem = 'This patient has no HMO cover on file'
    else if (method === 'cash' && tendered && money(tendered) < collect) problem = 'Amount tendered is less than the amount to collect'
    else if (method === 'split') {
      if (Math.abs(splitTotal - collect) > 0.005) problem = `Split amounts must add up to ${naira(collect)}`
      else if (split.some((r) => r.method === 'hmo' && money(r.amount) > 0) && !visit.hmo) problem = 'This patient has no HMO cover on file'
    }
  }

  const isFull = advance || collect >= due - 0.005

  if (collectionBlocked) return <div className="card"><div className="section-label">Pharmacy payment collection is disabled</div><p className="text-muted">The hospital admin has assigned patient bill payments to Cashier staff.</p></div>

  function methodsToRecord() {
    if (method === 'split') {
      return split.filter((r) => money(r.amount) > 0).map((r) => ({ method: r.method, amount: money(r.amount) }))
    }
    return [{ method, amount: collect }]
  }

  async function submit() {
    setBusy(true)
    try {
      const methods = methodsToRecord()
      const record = await repo.recordPayment({
        visit,
        methods,
        lines: st.lines,
        totals: { subtotal: st.subtotal, vat: st.vat, vatRate: st.vatRate, vatMode: st.vatMode, total: st.total },
        balanceAfter: advance ? 0 : Math.max(0, Math.round((due - collect) * 100) / 100),
        advance,
        actorId: user.userId,
        cashierName: user.name,
      })
      setReceipt(record)
      setConfirm(null)
      toast.success(advance ? 'Advance payment recorded' : isFull ? 'Payment collected' : 'Part-payment recorded')
    } catch (err) {
      toast.error(err.message || 'Could not record the payment')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {!current && (
        <>
          <Card className="mb-3">
            <div className="search-box">
              <Icon name="search" />
              <input
                aria-label="Find patient"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by patient name, Dibia ID or visit number"
                autoFocus
              />
            </div>
          </Card>

          <div className="section-label">Awaiting payment</div>
          {owing.length === 0 ? (
            <EmptyState icon="payment" title="No outstanding bills" hint="New bills appear here as patients are registered and charged." />
          ) : (
            owing.map(({ visit: v, st: s }) => {
              const q = STATUS_BY_KEY[v.status]
              return (
                <button key={v.id} type="button" className={`bill-pick status-${BILL_STATUS[s.status].row || 'none'}`} onClick={() => select(v.id)}>
                  <span className="grow">
                    <span className="r-title">{v.patientName}</span>
                    <span className="r-sub">{v.dibiaId} · {v.visitNo} · opened {relativeTime(v.openedAt)}</span>
                  </span>
                  {q && v.status !== 'closed' && <Pill tone={q.tone}>{q.label}</Pill>}
                  <span className="bill-amt">{naira(s.balance)}</span>
                  <Icon name="chevronRight" />
                </button>
              )
            })
          )}

          {advanceable.length > 0 && (
            <>
              <div className="section-label">Open visits with no charges yet</div>
              {advanceable.map(({ visit: v }) => (
                <button key={v.id} type="button" className="bill-pick status-none" onClick={() => select(v.id)}>
                  <span className="grow">
                    <span className="r-title">{v.patientName}</span>
                    <span className="r-sub">{v.dibiaId} · {v.visitNo} · take an advance payment</span>
                  </span>
                  <Icon name="chevronRight" />
                </button>
              ))}
            </>
          )}
        </>
      )}

      {current && (
        <div className="cashier-grid">
          <div>
            <Card className={`mb-2 status-${BILL_STATUS[st.status].row || 'none'}`}>
              <div className="row-between wrap">
                <div>
                  <div className="fw-600" style={{ fontSize: 18 }}>{visit.patientName}</div>
                  <div className="text-muted">{visit.dibiaId} · {visit.visitNo}</div>
                </div>
                <div className="row">
                  {visit.hmo && <Pill tone="info" dot={false}>{visit.hmo.scheme || 'HMO'}{visit.hmo.memberId ? ` · ${visit.hmo.memberId}` : ''}</Pill>}
                  <Pill tone={BILL_STATUS[st.status].tone}>{BILL_STATUS[st.status].label}</Pill>
                  <Button variant="quiet" onClick={() => select(null)}>Change patient</Button>
                </div>
              </div>
            </Card>

            <Card>
              <CardHead title="Bill" />
              {st.lines.length === 0 ? (
                <div className="empty-row">No charges have been logged for this visit yet.</div>
              ) : (
                <div className="bill-lines">
                  {st.lines.map((l) => (
                    <div key={l.id} className="bill-line">
                      <span className="grow">
                        <span className="r-title">{l.label}</span>
                        {l.qty > 1 && <span className="r-sub">{l.qty} x {naira(l.unitPrice)}</span>}
                      </span>
                      <span className="tabular">{naira(l.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="bill-totals">
                <div><span>Subtotal</span><span>{naira(st.subtotal)}</span></div>
                {st.vat > 0 && <div><span>{vatLabel(st)}</span><span>{naira(st.vat)}</span></div>}
                <div className="strong"><span>Total</span><span>{naira(st.total)}</span></div>
                {st.paid > 0 && <div><span>Paid so far</span><span>{naira(st.paid)}</span></div>}
                {st.hmo > 0 && <div><span>Billed to HMO</span><span>{naira(st.hmo)}</span></div>}
                <div className={`due ${due > 0 ? 'owing' : 'clear'}`}><span>Balance due</span><span>{naira(due)}</span></div>
              </div>
            </Card>
          </div>

          <Card className="pay-card">
            <CardHead title="Collect payment" />
            {due <= 0 && !advance ? (
              <div className="status-ok settled-note">This bill is settled.</div>
            ) : (
              <>
                <div className="field">
                  <label id="pm-label">Payment method</label>
                  <PayToggle options={METHODS.filter((m) => m.value === 'split' || config.paymentMethods[m.value] !== false)} value={method} onChange={setMethod} />
                </div>

                <div className="stack-gap mt-2">
                  <Field label={advance ? 'Advance amount' : 'Amount to collect'} htmlFor="amount" hint={advance ? 'Kept against this visit and used when charges are added.' : isFull ? 'Full balance' : `Part-payment. ${naira(due - collect)} will remain outstanding.`}>
                    <Input id="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  </Field>

                  {method === 'cash' && (
                    <Field label="Amount tendered" htmlFor="tendered" hint={change > 0 ? `Change to give: ${naira(change)}` : 'Optional. Enter to work out change.'}>
                      <Input id="tendered" inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value)} />
                    </Field>
                  )}

                  {method === 'hmo' && (
                    <div className={visit.hmo ? 'status-info settled-note' : 'status-crit settled-note'}>
                      {visit.hmo ? `Billed to ${visit.hmo.scheme || 'HMO'} as a receivable. No cash is collected.` : 'No HMO cover was recorded at reception for this visit.'}
                    </div>
                  )}

                  {method === 'split' && (
                    <div className="stack-gap">
                      {split.map((row, i) => (
                        <div key={i} className="split-row">
                          <select
                            className="select"
                            aria-label={`Split method ${i + 1}`}
                            value={row.method}
                            onChange={(e) => setSplit(split.map((r, j) => (j === i ? { ...r, method: e.target.value } : r)))}
                          >
                            {SPLIT_METHODS.filter((m) => config.paymentMethods[m] !== false).map((m) => (
                              <option key={m} value={m}>{METHOD_LABEL[m]}</option>
                            ))}
                          </select>
                          <input
                            className="input"
                            inputMode="decimal"
                            aria-label={`Split amount ${i + 1}`}
                            placeholder="0.00"
                            value={row.amount}
                            onChange={(e) => setSplit(split.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)))}
                          />
                        </div>
                      ))}
                      <div className="row">
                        <Button size="sm" variant="quiet" icon="plus" onClick={() => setSplit([...split, { method: 'transfer', amount: '' }])}>Add method</Button>
                        <span className="text-muted spacer">Entered {naira(splitTotal)} of {naira(collect)}</span>
                      </div>
                    </div>
                  )}
                </div>

                {problem && <div className="pay-problem">{problem}</div>}

                <div className="stack-gap mt-2">
                  <Button variant="primary" size="lg" block disabled={!!problem || !isFull} onClick={() => setConfirm('full')}>
                    {advance ? 'Take advance payment' : 'Collect payment'}
                  </Button>
                  {!advance && (
                    <Button variant="ghost" block disabled={!!problem || isFull} onClick={() => setConfirm('part')}>
                      Record part-payment
                    </Button>
                  )}
                </div>
              </>
            )}
          </Card>
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          title={advance ? 'Take this advance payment?' : confirm === 'full' ? 'Collect this payment?' : 'Record this part-payment?'}
          message={
            <>
              <p>
                {naira(collect)} from <b>{visit.patientName}</b>
                {method === 'split' ? ' across several methods' : ` by ${METHOD_LABEL[method]}`}.
              </p>
              {confirm === 'part' && <p className="mt-1">Balance after this payment: <b>{naira(due - collect)}</b>.</p>}
            </>
          }
          confirmLabel={advance ? 'Take payment' : confirm === 'full' ? 'Collect payment' : 'Record part-payment'}
          busy={busy}
          onConfirm={submit}
          onCancel={() => setConfirm(null)}
        />
      )}

      {receipt && (
        <ReceiptView
          payment={receipt}
          hospital={hospital}
          onClose={() => { setReceipt(null); select(null) }}
          onDone={() => { setReceipt(null); select(null) }}
          doneLabel="New payment"
        />
      )}
    </>
  )
}
