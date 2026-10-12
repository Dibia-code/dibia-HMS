import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { PERM } from '@/auth/permissions'
import { useRepo } from '@/data/RepositoryContext'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import { useHospital } from '@/hooks/useHospital'
import { useToast, usePageHeader, Button, Card, DataTable, Pill, Modal, ConfirmDialog, Field, Input, Select, Textarea } from '@/components'
import { settlement, BILL_STATUS, METHOD_LABEL, vatLabel } from '@/lib/billing'
import { naira, formatDateTime, formatDate } from '@/lib/format'
import { ReceiptView } from './Receipt'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'outstanding', label: 'Outstanding' },
  { key: 'settled', label: 'Settled' },
]

function refundable(payment, all) {
  const cash = payment.methods.filter((m) => m.method !== 'hmo').reduce((s, m) => s + m.amount, 0)
  const already = all.filter((p) => p.type === 'refund' && p.refundOf === payment.id).reduce((s, p) => s + p.amount, 0)
  return Math.max(0, Math.round((cash - already) * 100) / 100)
}

export default function BillsPage() {
  const { user, can } = useAuth()
  const repo = useRepo()
  const toast = useToast()
  const navigate = useNavigate()
  const { hospital, config } = useHospital()

  const { data: visits } = useLiveQuery(() => repo.list('visits'), [repo])
  const { data: payments } = useLiveQuery(() => repo.list('payments'), [repo])

  const [filter, setFilter] = useState('all')
  const [openId, setOpenId] = useState(null)
  const [receipt, setReceipt] = useState(null)
  const [refunding, setRefunding] = useState(null)
  const [refundForm, setRefundForm] = useState({ amount: '', method: 'cash', reason: '' })
  const [refundError, setRefundError] = useState('')
  const [refundConfirm, setRefundConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  usePageHeader({ title: 'Bills and receipts', subtitle: 'Every patient bill, current and settled' }, [])

  const byVisit = useMemo(() => {
    const map = new Map()
    for (const p of payments || []) {
      if (!map.has(p.visitId)) map.set(p.visitId, [])
      map.get(p.visitId).push(p)
    }
    return map
  }, [payments])

  const allRows = useMemo(
    () =>
      (visits || []).map((v) => {
        const pays = byVisit.get(v.id) || []
        return { id: v.id, visit: v, pays, st: settlement(v, pays, config) }
      }),
    [visits, byVisit, config],
  )

  const rows = useMemo(
    () =>
      allRows
        .filter((r) => r.st.status !== 'empty')
        .filter((r) => (filter === 'outstanding' ? r.st.balance > 0 : filter === 'settled' ? r.st.status === 'settled' : true))
        .sort((a, b) => new Date(b.visit.openedAt) - new Date(a.visit.openedAt)),
    [allRows, filter],
  )

  const detail = openId ? allRows.find((r) => r.id === openId) : null

  function startRefund(p, pays) {
    const max = refundable(p, pays)
    const firstMethod = p.methods.find((m) => m.method !== 'hmo')?.method || 'cash'
    setRefundForm({ amount: String(max), method: firstMethod, reason: '' })
    setRefundError('')
    setRefunding({ payment: p, max })
  }

  function reviewRefund() {
    const amount = Number(String(refundForm.amount).replace(/,/g, ''))
    if (!Number.isFinite(amount) || amount <= 0) return setRefundError('Enter the amount to refund')
    if (amount > refunding.max + 0.001) return setRefundError(`The most that can be refunded is ${naira(refunding.max)}`)
    if (refundForm.reason.trim().length < 3) return setRefundError('A reason is required')
    setRefundError('')
    setRefundConfirm(true)
  }

  async function doRefund() {
    setBusy(true)
    try {
      const record = await repo.recordRefund({
        payment: refunding.payment,
        amount: Math.round(Number(String(refundForm.amount).replace(/,/g, '')) * 100) / 100,
        method: refundForm.method,
        reason: refundForm.reason.trim(),
        actorId: user.userId,
        cashierName: user.name,
      })
      setRefundConfirm(false)
      setRefunding(null)
      setReceipt(record)
      toast.success('Refund recorded')
    } catch (err) {
      toast.error(err.message || 'Could not record the refund')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="filter-chips mb-2">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className={`filter-chip ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      <Card>
        <DataTable
          rowStatus={(r) => BILL_STATUS[r.st.status].row}
          onRowClick={(r) => setOpenId(r.id)}
          columns={[
            { key: 'patient', header: 'Patient', render: (r) => (<div><div className="cell-strong">{r.visit.patientName}</div><div className="cell-sub">{r.visit.dibiaId}</div></div>) },
            { key: 'visit', header: 'Visit', render: (r) => (<div><div>{r.visit.visitNo}</div><div className="cell-sub">{formatDate(r.visit.openedAt)}</div></div>) },
            { key: 'total', header: 'Total', align: 'num', render: (r) => naira(r.st.total) },
            { key: 'paid', header: 'Paid', align: 'num', render: (r) => naira(r.st.paid) },
            { key: 'hmo', header: 'HMO', align: 'num', render: (r) => (r.st.hmo ? naira(r.st.hmo) : '') },
            { key: 'bal', header: 'Balance', align: 'num', render: (r) => <span className={r.st.balance > 0 ? 'text-critical fw-600' : ''}>{naira(r.st.balance)}</span> },
            { key: 'status', header: 'Status', render: (r) => <Pill tone={BILL_STATUS[r.st.status].tone}>{BILL_STATUS[r.st.status].label}</Pill> },
          ]}
          rows={rows}
          empty={<div className="empty-row">No bills match this filter.</div>}
        />
      </Card>

      {detail && (
        <Modal
          wide
          title={`${detail.visit.patientName}, ${detail.visit.visitNo}`}
          onClose={() => setOpenId(null)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setOpenId(null)}>Close</Button>
              {can(PERM.BILLING_COLLECT) && detail.st.balance > 0 && (
                <Button variant="primary" onClick={() => navigate(`/${user.hospitalSlug}/cashier?visit=${detail.id}`)}>Collect payment</Button>
              )}
            </>
          }
        >
          <div className="bill-lines">
            {detail.st.lines.map((l) => (
              <div key={l.id} className="bill-line">
                <span className="grow"><span className="r-title">{l.label}</span>{l.qty > 1 && <span className="r-sub">{l.qty} x {naira(l.unitPrice)}</span>}</span>
                <span className="tabular">{naira(l.amount)}</span>
              </div>
            ))}
          </div>
          <div className="bill-totals">
            <div><span>Subtotal</span><span>{naira(detail.st.subtotal)}</span></div>
            {detail.st.vat > 0 && <div><span>{vatLabel(detail.st)}</span><span>{naira(detail.st.vat)}</span></div>}
            <div className="strong"><span>Total</span><span>{naira(detail.st.total)}</span></div>
            <div><span>Paid</span><span>{naira(detail.st.paid)}</span></div>
            {detail.st.hmo > 0 && <div><span>Billed to HMO</span><span>{naira(detail.st.hmo)}</span></div>}
            <div className={`due ${detail.st.balance > 0 ? 'owing' : 'clear'}`}><span>Balance</span><span>{naira(detail.st.balance)}</span></div>
          </div>

          <div className="section-label">Receipts</div>
          {detail.pays.length === 0 ? (
            <div className="text-muted">No payments recorded yet.</div>
          ) : (
            detail.pays
              .slice()
              .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
              .map((p) => {
                const max = p.type === 'payment' ? refundable(p, detail.pays) : 0
                return (
                  <div key={p.id} className="row-line">
                    <span className="grow">
                      <span className="r-title">
                        {p.receiptNo} {p.type === 'refund' && <Pill tone="failed" dot={false}>Refund</Pill>}
                      </span>
                      <span className="r-sub">
                        {formatDateTime(p.createdAt)} · {(Array.isArray(p.methods) ? p.methods : []).map((m) => METHOD_LABEL[m.method] || m.method).join(', ')} · {p.cashierName}
                        {p.reason ? ` · ${p.reason}` : ''}
                      </span>
                    </span>
                    <span className={`tabular fw-600 ${p.type === 'refund' ? 'text-critical' : ''}`}>{p.type === 'refund' ? '-' : ''}{naira(p.amount)}</span>
                    <Button size="sm" variant="ghost" onClick={() => setReceipt(p)}>Reprint</Button>
                    {can(PERM.BILLING_REFUND) && max > 0 && (
                      <Button size="sm" variant="danger" onClick={() => startRefund(p, detail.pays)}>Refund</Button>
                    )}
                  </div>
                )
              })
          )}
        </Modal>
      )}

      {refunding && !refundConfirm && (
        <Modal
          title={`Refund ${refunding.payment.receiptNo}`}
          onClose={() => setRefunding(null)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setRefunding(null)}>Cancel</Button>
              <Button variant="danger-solid" onClick={reviewRefund}>Review refund</Button>
            </>
          }
        >
          <div className="stack-gap">
            <Field label="Amount to refund" htmlFor="rf-amount" hint={`Up to ${naira(refunding.max)}`}>
              <Input id="rf-amount" inputMode="decimal" value={refundForm.amount} onChange={(e) => setRefundForm({ ...refundForm, amount: e.target.value })} />
            </Field>
            <Field label="Refund method" htmlFor="rf-method">
              <Select id="rf-method" value={refundForm.method} onChange={(e) => setRefundForm({ ...refundForm, method: e.target.value })}>
                {['cash', 'pos', 'transfer'].map((m) => (
                  <option key={m} value={m}>{METHOD_LABEL[m]}</option>
                ))}
              </Select>
            </Field>
            <Field label="Reason" htmlFor="rf-reason" required error={refundError}>
              <Textarea id="rf-reason" value={refundForm.reason} onChange={(e) => setRefundForm({ ...refundForm, reason: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}

      {refunding && refundConfirm && (
        <ConfirmDialog
          destructive
          title="Refund this payment?"
          message={<p>{naira(Number(String(refundForm.amount).replace(/,/g, '')))} will be refunded to <b>{refunding.payment.patientName}</b>. This is logged against the visit and cannot be undone.</p>}
          confirmLabel="Refund"
          busy={busy}
          onConfirm={doRefund}
          onCancel={() => setRefundConfirm(false)}
        />
      )}

      {receipt && <ReceiptView payment={receipt} hospital={hospital} onClose={() => setReceipt(null)} />}
    </>
  )
}
