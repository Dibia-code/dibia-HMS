const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const DAY = 86_400_000

export function stayDays(admission, now = Date.now()) {
  if (!admission?.admittedAt) return 0
  const end = admission.dischargedAt ? new Date(admission.dischargedAt).getTime() : now
  return Math.max(1, Math.ceil((end - new Date(admission.admittedAt).getTime()) / DAY))
}

export function computeBill(visit, config) {
  const charges = visit?.charges || []
  const levy = config.levy
  const admitted = visit?.type === 'inpatient' && visit?.admission?.admittedAt
  const days = admitted ? stayDays(visit.admission) : 0
  const scope = levy.appliesTo || 'both'
  const inScope = scope === 'both' || (admitted ? scope === 'inpatient' : scope === 'outpatient')
  const applyLevy = levy.enabled && inScope && (levy.amount || 0) > 0 && (admitted || charges.some((c) => c.type === 'consultation'))
  const levyAmount = applyLevy ? Number(levy.amount) * (admitted ? days : 1) : 0
  const showLevy = applyLevy && (levy.showOnBill || admitted)

  let firstConsult = true
  const lines = charges.map((c) => {
    const qty = Number(c.qty) || 1
    let unit = Number(c.unitPrice) || 0
    if (c.type === 'consultation' && firstConsult && applyLevy && !showLevy) {
      unit += levyAmount
    }
    if (c.type === 'consultation') firstConsult = false
    return { id: c.id, type: c.type, label: c.label, qty, unitPrice: unit, amount: round2(qty * unit) }
  })
  if (admitted) {
    const adm = config.admission
    if (adm.fee > 0) lines.push({ id: 'admission-fee', type: 'bed', label: 'Admission fee', qty: 1, unitPrice: adm.fee, amount: adm.fee })
    if (adm.bedPerDay > 0) lines.push({ id: 'bed-days', type: 'bed', label: `Bed, ${days} day${days === 1 ? '' : 's'}`, qty: days, unitPrice: adm.bedPerDay, amount: round2(days * adm.bedPerDay) })
  }
  if (showLevy) {
    const label = admitted ? `${levy.name || 'Levy'}, ${days} day${days === 1 ? '' : 's'}` : levy.name || 'Levy'
    lines.push({ id: 'levy', type: 'levy', label, qty: 1, unitPrice: levyAmount, amount: levyAmount })
  }

  const subtotal = round2(lines.reduce((sum, l) => sum + l.amount, 0))
  const vatRate = config.vat.enabled ? Number(config.vat.rate) || 0 : 0
  const inclusive = config.vat.mode === 'inclusive'
  const vat = inclusive ? round2(subtotal - subtotal / (1 + vatRate / 100)) : round2((subtotal * vatRate) / 100)
  const total = inclusive ? subtotal : round2(subtotal + vat)
  return { lines, subtotal, vatRate, vatMode: inclusive ? 'inclusive' : 'exclusive', vat, total }
}

export function settlement(visit, payments, config) {
  const bill = computeBill(visit, config)
  let collected = 0
  let hmo = 0
  let refunded = 0
  for (const p of payments) {
    if (p.type === 'refund') {
      refunded += Number(p.amount) || 0
      continue
    }
    for (const m of p.methods || []) {
      if (m.method === 'hmo') hmo += Number(m.amount) || 0
      else collected += Number(m.amount) || 0
    }
  }
  const paid = round2(collected - refunded)
  const balance = round2(Math.max(0, bill.total - paid - hmo))
  const credit = round2(Math.max(0, paid + hmo - bill.total))
  let status = 'unpaid'
  if (bill.total > 0 && balance === 0) status = 'settled'
  else if (paid + hmo > 0) status = 'part'
  if (bill.total === 0) status = paid + hmo > 0 ? 'advance' : 'empty'
  return { ...bill, paid, hmo, refunded, balance, credit, status }
}

export const BILL_STATUS = {
  unpaid: { label: 'Unpaid', tone: 'failed', row: 'crit' },
  part: { label: 'Part-paid', tone: 'pending', row: 'warn' },
  settled: { label: 'Settled', tone: 'active', row: 'ok' },
  empty: { label: 'No charges', tone: 'inactive', row: null },
  advance: { label: 'Paid in advance', tone: 'active', row: 'ok' },
}

export const METHOD_LABEL = {
  cash: 'Cash',
  pos: 'POS / card',
  transfer: 'Bank transfer',
  hmo: 'HMO / insurance',
}

export function vatLabel(st) {
  return st.vatMode === 'inclusive' ? `Includes VAT (${st.vatRate}%)` : `VAT (${st.vatRate}%)`
}
