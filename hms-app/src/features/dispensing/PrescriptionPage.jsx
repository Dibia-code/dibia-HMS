import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { PERM } from '@/auth/permissions'
import { useRepo } from '@/data/RepositoryContext'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import { useHospital } from '@/hooks/useHospital'
import { useToast, usePageHeader, Button, Card, Pill, Modal, Select, Input, EmptyState } from '@/components'
import { summarise, isExpired } from '@/lib/stock'
import { checkFlags } from '@/lib/interactions'
import { naira, formatDate, formatDateTime } from '@/lib/format'
import { ApprovalModal } from './ApprovalModal'
import { LabelSheet } from './LabelSheet'

export default function PrescriptionPage() {
  const { id } = useParams()
  const { user, can } = useAuth()
  const repo = useRepo()
  const toast = useToast()
  const navigate = useNavigate()
  const { hospital, config } = useHospital()

  const { data: rx } = useLiveQuery(() => repo.get('prescriptions', id), [repo, id])
  const { data: patient } = useLiveQuery(() => (rx ? repo.get('patients', rx.patientId) : null), [repo, rx?.patientId])
  const { data: products } = useLiveQuery(() => repo.list('products'), [repo])
  const { data: batches } = useLiveQuery(() => repo.list('batches'), [repo])
  const { data: dispensings } = useLiveQuery(() => repo.list('dispensings'), [repo])

  const [alt, setAlt] = useState({})
  const [qty, setQty] = useState({})
  const [pick, setPick] = useState({})
  const [suggest, setSuggest] = useState(null)
  const [untracked, setUntracked] = useState(null)
  const [approval, setApproval] = useState(null)
  const [labels, setLabels] = useState(null)
  const [busy, setBusy] = useState(false)

  usePageHeader(
    { title: 'Prescription', subtitle: rx ? `${rx.patientName} · ${rx.dibiaId}` : '', actions: <Button variant="ghost" onClick={() => navigate(`/${user.hospitalSlug}/dispensing`)}>Back to queue</Button> },
    [rx?.patientName],
  )

  const sums = useMemo(() => new Map((products || []).map((p) => [p.id, summarise(p, batches || [], config.expiryWindows)])), [products, batches, config.expiryWindows])
  const byId = useMemo(() => new Map((products || []).map((p) => [p.id, p])), [products])

  const mine = useMemo(() => (dispensings || []).filter((d) => d.prescriptionId === id), [dispensings, id])
  const earlier = useMemo(
    () => (dispensings || []).filter((d) => rx && d.visitId === rx.visitId && d.prescriptionId !== id).map((d) => byId.get(d.productId)?.genericName || d.drugName),
    [dispensings, rx, id, byId],
  )

  function resolve(line) {
    const chosen = alt[line.id] ? byId.get(alt[line.id]) : null
    if (chosen) return chosen
    if (line.productId && byId.get(line.productId)) return byId.get(line.productId)
    const n = line.drugName.toLowerCase()
    return (products || []).find((p) => !p.archived && (p.name.toLowerCase() === n || (p.genericName || '') === n)) || null
  }

  const flagsByLine = useMemo(() => {
    if (!rx) return {}
    const drugs = (Array.isArray(rx.lines) ? rx.lines : []).map((l) => {
      const p = alt[l.id] ? byId.get(alt[l.id]) : l.productId ? byId.get(l.productId) : (products || []).find((x) => x.name.toLowerCase() === l.drugName.toLowerCase())
      return { name: l.drugName, generic: p?.genericName || l.drugName }
    })
    const flags = checkFlags({ allergies: patient?.allergies, drugs, alsoTaking: earlier })
    const map = {}
    for (const f of flags) (map[rx.lines.find((l) => l.drugName === f.drug)?.id] ||= []).push(f)
    return map
  }, [rx, patient, products, alt, earlier, byId])

  function info(line) {
    const product = resolve(line)
    const s = product ? sums.get(product.id) : null
    const remaining = line.qty - (line.dispensedQty || 0)
    const done = line.status === 'done'
    const sellable = s?.sellable ?? 0
    const expiredOnly = !!s && sellable === 0 && s.expiredQty > 0
    const chosenBatch = pick[line.id] ? s?.batches.find((b) => b.id === pick[line.id]) : null
    const fefo = s?.fefo[0] || null
    const overridesFefo = !!chosenBatch && fefo && chosenBatch.id !== fefo.id
    const available = chosenBatch ? chosenBatch.balance : expiredOnly ? s.expiredQty : sellable
    const maxQty = Math.min(remaining, available)
    return { line, product, s, remaining, done, sellable, expiredOnly, chosenBatch, fefo, overridesFefo, maxQty, flags: flagsByLine[line.id] || [], substituted: !!product && !!line.productId && product.id !== line.productId }
  }

  function ask(items, needReason) {
    return new Promise((resolveFn) => setApproval({ items, needReason, resolve: resolveFn }))
  }

  async function run(lineIds) {
    const plans = lineIds.map((lid) => info(rx.lines.find((l) => l.id === lid))).filter((p) => !p.done && p.product && p.maxQty > 0)
    if (!plans.length) return toast.info('Nothing to dispense on those lines')
    const needs = []
    let needReason = false
    for (const p of plans) {
      if (p.product.controlled) needs.push({ kind: 'controlled', text: `${p.product.name} is a controlled drug` })
      for (const f of p.flags) {
        needs.push({ kind: f.kind, text: f.message })
        needReason = true
      }
      if (p.expiredOnly) {
        needs.push({ kind: 'expired', text: `${p.product.name}: only expired stock is left. Dispensing it needs a pharmacist override.` })
        needReason = true
      }
      if (p.overridesFefo) needs.push({ kind: 'fefo', text: `${p.product.name}: batch ${p.chosenBatch.batchNo} is not the earliest-expiry batch (${p.fefo.batchNo}).` })
    }
    let approver = null
    let reason = ''
    if (needs.length) {
      const result = await ask(needs, needReason)
      if (!result) return
      approver = result.approver
      reason = result.reason
    }
    setBusy(true)
    const records = []
    try {
      for (const p of plans) {
        const n = Math.min(Number(qty[p.line.id]) || p.maxQty, p.maxQty)
        const approvals = {}
        if (p.product.controlled) approvals.controlledBy = approver.name
        if (p.flags.length) approvals.flagOverride = { by: approver.name, reason }
        if (p.expiredOnly) approvals.expiredBy = approver.name
        if (p.overridesFefo) approvals.fefoBy = approver.name
        const out = await repo.dispenseLine({
          prescriptionId: rx.id,
          lineId: p.line.id,
          qty: n,
          productId: p.product.id,
          forceBatchId: p.chosenBatch?.id,
          allowExpired: p.expiredOnly,
          approvals,
          flags: p.flags,
          substituted: p.substituted || !!alt[p.line.id],
          actor: { id: user.userId, name: user.name },
        })
        records.push(...out.records)
        if (out.short > 0) toast.info(`${p.product.name}: ${out.short} outstanding`)
      }
      toast.success('Dispensed')
      setLabels(records)
    } catch (err) {
      toast.error(err.message || 'Could not dispense')
    } finally {
      setBusy(false)
    }
  }

  function alternatives(line) {
    const current = resolve(line)
    const base = current || { genericName: line.drugName.toLowerCase(), category: '' }
    return (products || []).filter((p) => !p.archived && p.id !== current?.id && (sums.get(p.id)?.sellable || 0) > 0 && ((base.genericName && p.genericName === base.genericName) || (!base.genericName && base.category && p.category === base.category)))
  }

  async function runUntracked() {
    const { line, product, price, flags } = untracked
    let approvals = {}
    if (flags.length || product?.controlled) {
      const items = [
        ...(product?.controlled ? [{ kind: 'controlled', text: `${product.name} is a controlled drug` }] : []),
        ...flags.map((f) => ({ kind: f.kind, text: f.message })),
      ]
      const result = await ask(items, flags.length > 0)
      if (!result) return
      if (product?.controlled) approvals.controlledBy = result.approver.name
      if (flags.length) approvals.flagOverride = { by: result.approver.name, reason: result.reason }
    }
    setBusy(true)
    try {
      const out = await repo.dispenseUntracked({
        prescriptionId: rx.id, lineId: line.id, qty: line.qty - (line.dispensedQty || 0), productId: product?.id ?? null,
        drugName: line.drugName, unitPrice: price, approvals, flags, actor: { id: user.userId, name: user.name },
      })
      toast.success('Dispensed. Stock was not recorded for this drug.')
      setUntracked(null)
      setLabels(out.records)
    } catch (err) {
      toast.error(err.message || 'Could not dispense')
    } finally {
      setBusy(false)
    }
  }

  if (!rx) return <EmptyState icon="pill" title="Prescription not found" />

  const allInfo = (Array.isArray(rx.lines) ? rx.lines : []).map((l) => info(l))
  const ready = allInfo.filter((i) => !i.done && i.product && i.maxQty > 0)

  return (
    <>
      <Card className="mb-2">
        <div className="row-between wrap">
          <div>
            <div className="fw-600" style={{ fontSize: 18 }}>{rx.patientName}</div>
            <div className="text-muted">{rx.dibiaId} · Visit {rx.visitNo}</div>
            <div className="text-muted">Prescribed by {rx.prescriber || 'not recorded'} · {formatDateTime(rx.createdAt)}</div>
          </div>
          <div className="row">
            <Pill tone={rx.source === 'external' ? 'pending' : 'info'} dot={false}>{rx.source === 'external' ? 'Outside prescription' : 'Dibia prescription'}</Pill>
            {patient?.allergies && <Pill tone="interaction" dot={false}>Allergy: {patient.allergies}</Pill>}
          </div>
        </div>
      </Card>

      {allInfo.map((i) => {
        const { line, product, s } = i
        const border = i.flags.length ? 'interaction' : i.done ? 'ok' : !product || (i.sellable === 0 && !i.expiredOnly) ? 'crit' : i.expiredOnly ? 'crit' : i.sellable < i.remaining ? 'warn' : 'ok'
        return (
          <Card key={line.id} className={`rx-line status-${border}`}>
            <div className="rl-head">
              <div>
                <div className="fw-600" style={{ fontSize: 16 }}>{line.drugName}{product && product.name !== line.drugName ? ` (giving ${product.name})` : ''}</div>
                <div className="text-muted">{[line.dose, line.frequency, line.duration].filter(Boolean).join(' · ') || 'As directed'} · quantity {line.qty}</div>
              </div>
              <div className="rl-chips">
                {i.done && <Pill tone="active">Dispensed {line.dispensedQty}</Pill>}
                {!i.done && line.status === 'partial' && <Pill tone="pending">{line.outstandingNote}</Pill>}
                {!i.done && !product && <Pill tone="failed">Not in inventory</Pill>}
                {!i.done && product && i.expiredOnly && <Pill tone="failed">Expired stock only</Pill>}
                {!i.done && product && !i.expiredOnly && i.sellable === 0 && <Pill tone="failed">Out of stock</Pill>}
                {!i.done && product && i.sellable > 0 && i.sellable >= i.remaining && <Pill tone="active">In stock · {i.sellable}</Pill>}
                {!i.done && product && i.sellable > 0 && i.sellable < i.remaining && <Pill tone="pending">Only {i.sellable} in stock</Pill>}
                {product?.controlled && <Pill tone="pending">Controlled drug</Pill>}
                {i.substituted || alt[line.id] ? <Pill tone="info" dot={false}>Substitution</Pill> : null}
                {i.flags.map((f, k) => <Pill key={k} tone="interaction">{f.kind === 'allergy' ? 'Allergy' : 'Interaction'}</Pill>)}
              </div>
            </div>

            {i.flags.map((f, k) => <div key={k} className="rl-flag">{f.message}</div>)}

            {!i.done && product && (
              <div className="rl-body">
                <div className="rl-batch">
                  {i.expiredOnly ? (
                    <span className="text-critical">Only expired batches remain. A pharmacist override is needed.</span>
                  ) : i.fefo ? (
                    <span>First to dispense (earliest expiry): batch <b>{(i.chosenBatch || i.fefo).batchNo}</b>, expires {formatDate((i.chosenBatch || i.fefo).expiry)} · {naira((i.chosenBatch || i.fefo).price)} each</span>
                  ) : (
                    <span className="text-critical">No stock</span>
                  )}
                </div>
                <div className="rl-actions">
                  {s && s.fefo.length > 1 && (
                    <Select aria-label={`Batch for ${line.drugName}`} value={pick[line.id] || ''} onChange={(e) => setPick({ ...pick, [line.id]: e.target.value || null })}>
                      <option value="">Recommended batch</option>
                      {s.fefo.map((b) => <option key={b.id} value={b.id}>{b.batchNo} · exp {formatDate(b.expiry)} · {b.balance} left</option>)}
                    </Select>
                  )}
                  {i.maxQty > 0 && (
                    <Input aria-label={`Quantity for ${line.drugName}`} type="number" min="1" max={i.maxQty} value={qty[line.id] ?? i.maxQty} onChange={(e) => setQty({ ...qty, [line.id]: e.target.value })} style={{ width: 96 }} />
                  )}
                  {(i.sellable === 0 || i.sellable < i.remaining) && (
                    <Button variant="quiet" onClick={() => setSuggest(line)}>Suggest alternative</Button>
                  )}
                  <Button variant="primary" disabled={busy || i.maxQty <= 0} onClick={() => run([line.id])}>
                    {i.maxQty > 0 && i.maxQty < i.remaining ? `Dispense ${i.maxQty}` : 'Dispense'}
                  </Button>
                </div>
              </div>
            )}
            {!i.done && !product && (
              <div className="rl-body">
                <span className="text-muted">This drug is not in the pharmacy inventory.</span>
                <div className="rl-actions">
                  <Button variant="quiet" onClick={() => setSuggest(line)}>Suggest alternative</Button>
                  <Button variant="ghost" onClick={() => setUntracked({ line, product: null, price: '', flags: i.flags })}>Dispense without stock record</Button>
                </div>
              </div>
            )}
            {!i.done && product && i.sellable === 0 && !i.expiredOnly && (
              <div className="rl-body">
                <span className="text-muted">No stock is recorded. You can still hand it over and log that stock was not recorded.</span>
                <Button variant="ghost" onClick={() => setUntracked({ line, product, price: String(product.price || ''), flags: i.flags })}>Dispense without stock record</Button>
              </div>
            )}
          </Card>
        )
      })}

      <div className="row wrap mt-3">
        <Button variant="primary" size="lg" disabled={busy || ready.length === 0} onClick={() => run(ready.map((r) => r.line.id))}>Dispense all</Button>
        {mine.length > 0 && <Button variant="ghost" icon="printer" onClick={() => setLabels(mine)}>Labels for this prescription</Button>}
        {can(PERM.BILLING_COLLECT) && <Button variant="ghost" icon="payment" onClick={() => navigate(`/${user.hospitalSlug}/cashier?visit=${rx.visitId}`)}>Collect payment</Button>}
      </div>

      {suggest && (
        <Modal title={`Alternatives for ${suggest.drugName}`} onClose={() => setSuggest(null)} labelledBy="alt-title" actions={<Button variant="ghost" onClick={() => setSuggest(null)}>Close</Button>}>
          {alternatives(suggest).length === 0 ? (
            <div className="text-muted">No matching drug is in stock. You can dispense what is available and note what is outstanding.</div>
          ) : (
            alternatives(suggest).map((p) => (
              <button key={p.id} type="button" className="result-row" onClick={() => { setAlt({ ...alt, [suggest.id]: p.id }); setSuggest(null) }}>
                <span className="grow"><span className="r-title">{p.name}</span><span className="r-sub">{sums.get(p.id).sellable} in stock · {naira(p.price)}</span></span>
                <Pill tone="info" dot={false}>Use this</Pill>
              </button>
            ))
          )}
        </Modal>
      )}

      {untracked && (
        <Modal
          title={`Dispense ${untracked.line.drugName} without a stock record?`}
          onClose={() => setUntracked(null)}
          labelledBy="untracked-title"
          actions={<><Button variant="ghost" onClick={() => setUntracked(null)}>Cancel</Button><Button variant="primary" disabled={busy} onClick={runUntracked}>Dispense</Button></>}
        >
          <p className="mb-2">The drug is logged as dispensed, billed to the visit, and marked stock not recorded so it can be reviewed later.</p>
          <div className="text-muted mb-2">Quantity: {untracked.line.qty - (untracked.line.dispensedQty || 0)}</div>
          <div className="field">
            <label htmlFor="ut-price">Price for each (naira)</label>
            <Input id="ut-price" inputMode="decimal" value={untracked.price} onChange={(e) => setUntracked({ ...untracked, price: e.target.value })} />
          </div>
        </Modal>
      )}

      {approval && (
        <ApprovalModal
          title="Pharmacist approval needed"
          items={approval.items}
          needReason={approval.needReason}
          onApproved={(r) => { approval.resolve(r); setApproval(null) }}
          onCancel={() => { approval.resolve(null); setApproval(null) }}
        />
      )}

      {labels && <LabelSheet records={labels} hospital={hospital} onClose={() => setLabels(null)} />}
    </>
  )
}
