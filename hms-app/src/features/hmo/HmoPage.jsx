import { useMemo, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { useRepo } from '@/data/RepositoryContext'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import { useToast, usePageHeader, Card, CardHead, StatRow, StatCard, DataTable, Pill, Button, Modal, Field, Input, Textarea, EmptyState } from '@/components'
import { naira, formatDate } from '@/lib/format'

const CLAIM_STATUS = {
  draft: { label: 'Not yet sent', tone: 'inactive', row: null },
  submitted: { label: 'Awaiting payment', tone: 'pending', row: 'warn' },
  part_paid: { label: 'Part-paid', tone: 'pending', row: 'warn' },
  paid: { label: 'Paid', tone: 'active', row: 'ok' },
  rejected: { label: 'Rejected', tone: 'failed', row: 'crit' },
}

export default function HmoPage() {
  const { user } = useAuth()
  const repo = useRepo()
  const toast = useToast()
  const actor = { id: user.userId, name: user.name }

  const { data: payments } = useLiveQuery(() => repo.list('payments'), [repo])
  const { data: visits } = useLiveQuery(() => repo.list('visits'), [repo])
  const { data: claims } = useLiveQuery(() => repo.list('hmo_claims'), [repo])
  const [dialog, setDialog] = useState(null)
  const [form, setForm] = useState({ amount: '', note: '' })

  usePageHeader({ title: 'HMO receivables', subtitle: 'Money owed to the hospital by insurance schemes' }, [])

  const data = useMemo(() => {
    const vmap = new Map((visits || []).map((v) => [v.id, v]))
    const claimed = new Set((claims || []).filter((c) => c.status !== 'rejected').flatMap((c) => (Array.isArray(c.items) ? c.items : []).map((i) => i.paymentId)))
    const items = []
    for (const p of payments || []) {
      if (p.type === 'refund') continue
      const amt = (Array.isArray(p.methods) ? p.methods : []).filter((m) => m.method === 'hmo').reduce((s, m) => s + m.amount, 0)
      if (amt <= 0) continue
      const v = vmap.get(p.visitId)
      items.push({ paymentId: p.id, visitId: p.visitId, visitNo: p.visitNo, patientName: p.patientName, amount: amt, scheme: v?.hmo?.scheme || 'Unknown scheme', at: p.createdAt })
    }
    const unclaimed = items.filter((i) => !claimed.has(i.paymentId))
    const schemes = new Map()
    const get = (name) => {
      if (!schemes.has(name)) schemes.set(name, { scheme: name, unclaimed: 0, awaiting: 0, paid: 0, items: [] })
      return schemes.get(name)
    }
    for (const i of unclaimed) {
      const s = get(i.scheme)
      s.unclaimed += i.amount
      s.items.push(i)
    }
    for (const c of claims || []) {
      const s = get(c.scheme)
      if (c.status === 'submitted' || c.status === 'draft') s.awaiting += c.amount
      else if (c.status === 'part_paid') { s.awaiting += c.amount - (c.paidAmount || 0); s.paid += c.paidAmount || 0 }
      else if (c.status === 'paid') s.paid += c.paidAmount || c.amount
    }
    const rows = [...schemes.values()].map((s) => ({ ...s, outstanding: s.unclaimed + s.awaiting }))
    return { rows, unclaimed: unclaimed.length, totals: rows.reduce((a, r) => ({ unclaimed: a.unclaimed + r.unclaimed, awaiting: a.awaiting + r.awaiting, paid: a.paid + r.paid }), { unclaimed: 0, awaiting: 0, paid: 0 }) }
  }, [payments, visits, claims])

  async function createClaim(row) {
    await repo.createClaim({ scheme: row.scheme, items: row.items.map(({ paymentId, visitId, visitNo, patientName, amount }) => ({ paymentId, visitId, visitNo, patientName, amount })), actor })
    toast.success(`Claim batch created for ${row.scheme}`)
  }

  async function submit(claim) {
    await repo.updateClaim(claim.id, { status: 'submitted', submittedAt: new Date().toISOString() }, { actor, action: 'hmo.claim_submitted' })
    toast.success('Claim marked as sent')
  }

  async function savePayment() {
    const amount = Number(form.amount)
    const claim = dialog.claim
    if (!(amount > 0)) return setForm({ ...form, error: 'Enter the amount received' })
    const paid = (claim.paidAmount || 0) + amount
    await repo.updateClaim(claim.id, { paidAmount: paid, paidAt: new Date().toISOString(), status: paid >= claim.amount - 0.005 ? 'paid' : 'part_paid', note: form.note }, { actor, action: 'hmo.claim_payment' })
    toast.success('Payment recorded')
    setDialog(null)
  }

  async function reject() {
    if (form.note.trim().length < 3) return setForm({ ...form, error: 'A reason is required' })
    await repo.updateClaim(dialog.claim.id, { status: 'rejected', note: form.note.trim() }, { actor, action: 'hmo.claim_rejected' })
    toast.info('Claim rejected. Its items return to unclaimed.')
    setDialog(null)
  }

  const sortedClaims = [...(claims || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

  return (
    <>
      <StatRow cols={3}>
        <StatCard label="Not yet claimed" value={naira(data.totals.unclaimed)} delta={`${data.unclaimed} item${data.unclaimed === 1 ? '' : 's'}`} tone={data.totals.unclaimed ? 'warn' : 'ok'} />
        <StatCard label="Awaiting payment" value={naira(data.totals.awaiting)} tone={data.totals.awaiting ? 'warn' : 'ok'} />
        <StatCard label="Received from schemes" value={naira(data.totals.paid)} tone="ok" />
      </StatRow>

      <div className="section-label">By scheme</div>
      {data.rows.length === 0 ? (
        <EmptyState icon="receipt" title="No HMO receivables yet" hint="They appear when a cashier bills part of a visit to an HMO." />
      ) : (
        <Card>
          <DataTable
            rowStatus={(r) => (r.unclaimed > 0 ? 'warn' : r.awaiting > 0 ? 'warn' : 'ok')}
            columns={[
              { key: 's', header: 'Scheme', render: (r) => <span className="cell-strong">{r.scheme}</span> },
              { key: 'u', header: 'Not yet claimed', align: 'num', render: (r) => naira(r.unclaimed) },
              { key: 'a', header: 'Awaiting payment', align: 'num', render: (r) => naira(r.awaiting) },
              { key: 'p', header: 'Received', align: 'num', render: (r) => naira(r.paid) },
              { key: 'o', header: 'Still owed', align: 'num', render: (r) => <b>{naira(r.outstanding)}</b> },
              { key: 'x', header: '', render: (r) => (r.unclaimed > 0 ? <Button size="sm" variant="primary" onClick={() => createClaim(r)}>Create claim batch</Button> : null) },
            ]}
            rows={data.rows}
            getRowKey={(r) => r.scheme}
          />
        </Card>
      )}

      <div className="section-label">Claim batches</div>
      <Card>
        <DataTable
          rowStatus={(c) => CLAIM_STATUS[c.status].row}
          columns={[
            { key: 'n', header: 'Claim', render: (c) => (<div><div className="cell-strong">{c.claimNo}</div><div className="cell-sub">{c.scheme} · {c.items.length} visit{c.items.length === 1 ? '' : 's'}</div></div>) },
            { key: 'd', header: 'Created', render: (c) => formatDate(c.createdAt) },
            { key: 'a', header: 'Amount', align: 'num', render: (c) => naira(c.amount) },
            { key: 'r', header: 'Received', align: 'num', render: (c) => naira(c.paidAmount || 0) },
            { key: 's', header: 'Status', render: (c) => <Pill tone={CLAIM_STATUS[c.status].tone}>{CLAIM_STATUS[c.status].label}</Pill> },
            {
              key: 'x', header: '',
              render: (c) => (
                <span className="row" style={{ gap: 6 }}>
                  {c.status === 'draft' && <Button size="sm" variant="ghost" onClick={() => submit(c)}>Mark as sent</Button>}
                  {['submitted', 'part_paid'].includes(c.status) && <Button size="sm" variant="primary" onClick={() => { setForm({ amount: String(c.amount - (c.paidAmount || 0)), note: '' }); setDialog({ kind: 'pay', claim: c }) }}>Record payment</Button>}
                  {['draft', 'submitted'].includes(c.status) && <Button size="sm" variant="danger" onClick={() => { setForm({ amount: '', note: '' }); setDialog({ kind: 'reject', claim: c }) }}>Rejected</Button>}
                </span>
              ),
            },
          ]}
          rows={sortedClaims}
          empty={<div className="empty-row">No claim batches yet.</div>}
        />
      </Card>

      {dialog?.kind === 'pay' && (
        <Modal title={`Payment for ${dialog.claim.claimNo}`} onClose={() => setDialog(null)} labelledBy="hmo-pay" actions={<><Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button><Button variant="primary" onClick={savePayment}>Save payment</Button></>}>
          <div className="stack-gap">
            <Field label="Amount received" htmlFor="hp-a" hint={`Claim total ${naira(dialog.claim.amount)}. A smaller amount is kept as part-paid.`} error={form.error}><Input id="hp-a" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value, error: '' })} /></Field>
            <Field label="Note" htmlFor="hp-n"><Input id="hp-n" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
      {dialog?.kind === 'reject' && (
        <Modal title={`Claim ${dialog.claim.claimNo} rejected`} onClose={() => setDialog(null)} labelledBy="hmo-rej" actions={<><Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button><Button variant="danger-solid" onClick={reject}>Mark rejected</Button></>}>
          <Field label="Reason given by the scheme" htmlFor="hr-r" required error={form.error}><Textarea id="hr-r" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value, error: '' })} /></Field>
        </Modal>
      )}
    </>
  )
}
