import { useMemo, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { useRepo } from '@/data/RepositoryContext'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import { useToast, usePageHeader, Card, Button, SectionLabel, Field, Input, Textarea } from '@/components'
import { naira } from '@/lib/format'

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }

// Submit Report — the cashier's end-of-shift close (§5). Today's takings are
// auto-filled from this cashier's own sales (split by payment method), expected
// cash in the till is the cash portion, and the cashier counts the drawer. Any
// variance requires a note. Submitting writes a shift_report the management
// Reports screen reads — offline-first, like every other write.
export default function SubmitReportPage() {
  const { user } = useAuth()
  const repo = useRepo()
  const toast = useToast()

  const [counted, setCounted] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const { data: sales } = useLiveQuery(() => repo.list('sales'), [repo])
  const { data: payments } = useLiveQuery(() => repo.list('payments'), [repo])
  const { data: reports } = useLiveQuery(() => repo.list('shift_reports'), [repo])

  // A shift runs from this cashier's last closing report (or the start of today).
  const since = useMemo(() => {
    const mine = (reports || []).filter((r) => r.cashierId === user.userId).map((r) => new Date(r.createdAt).getTime())
    return mine.length ? Math.max(...mine) : startOfToday()
  }, [reports, user.userId])

  const till = useMemo(() => {
    const mine = (sales || []).filter((s) => s.cashierId === user.userId && new Date(s.createdAt).getTime() > since)
    const by = { cash: 0, transfer: 0, credit: 0 }
    for (const s of mine) by[s.payment] = (by[s.payment] || 0) + (s.total || 0)
    const care = { cash: 0, pos: 0, transfer: 0, hmo: 0, refunds: 0 }
    for (const p of payments || []) {
      if (p.cashierId !== user.userId || new Date(p.createdAt).getTime() <= since) continue
      if (p.type === 'refund') {
        for (const m of p.methods) if (m.method === 'cash') care.refunds += m.amount
        continue
      }
      for (const m of p.methods) care[m.method] = (care[m.method] || 0) + m.amount
    }
    return { ...by, care, total: by.cash + by.transfer + by.credit, count: mine.length }
  }, [sales, payments, user.userId, since])

  const expected = till.cash + till.care.cash - till.care.refunds // only cash should physically be in the drawer
  const countedNum = counted.trim() === '' ? null : Number(counted)
  const hasCounted = countedNum != null && !Number.isNaN(countedNum)
  const variance = hasCounted ? countedNum - expected : null

  async function submit() {
    if (!hasCounted) {
      setError('Enter the cash you counted in the till.')
      return
    }
    if (variance !== 0 && !note.trim()) {
      setError('Add a note explaining the variance before submitting.')
      return
    }
    setError('')
    setBusy(true)
    try {
      await repo.submitShiftReport({
        cashierId: user.userId,
        cashierName: user.name,
        expectedCash: expected,
        countedCash: countedNum,
        variance,
        note: note.trim(),
        breakdown: { cash: till.cash, transfer: till.transfer, credit: till.credit, patientCash: till.care.cash, patientPos: till.care.pos, patientTransfer: till.care.transfer, patientHmo: till.care.hmo, cashRefunds: till.care.refunds },
        shiftStart: new Date(since).toISOString(),
        salesTotal: till.total,
        salesCount: till.count,
      })
      toast.success('Report submitted to your manager')
      setCounted('')
      setNote('')
    } catch (err) {
      toast.error(err.message || 'Could not submit report')
    } finally {
      setBusy(false)
    }
  }

  usePageHeader({ title: 'Submit Report', subtitle: 'End of shift closing' }, [])

  const varianceTone = variance === 0 ? 'var(--confirmed)' : 'var(--critical)'
  const varianceText =
    variance == null ? null : variance === 0 ? 'Balances exactly' : `${variance > 0 ? 'Over' : 'Short'} by ${naira(Math.abs(variance))}`

  return (
    <>
      <Card className="field-wide mb-2">
        <SectionLabel>Retail sales this shift</SectionLabel>
        <div className="refund-summary"><span>Cash sales</span><span>{naira(till.cash)}</span></div>
        <div className="refund-summary"><span>Transfer sales</span><span>{naira(till.transfer)}</span></div>
        <div className="refund-summary"><span>Credit sales</span><span>{naira(till.credit)}</span></div>
        <div className="refund-summary total"><span>Total sales</span><span>{naira(till.total)}</span></div>
      </Card>

      <Card className="field-wide mb-2">
        <SectionLabel>Patient payments this shift</SectionLabel>
        <div className="refund-summary"><span>Cash collected</span><span>{naira(till.care.cash)}</span></div>
        <div className="refund-summary"><span>POS / card</span><span>{naira(till.care.pos)}</span></div>
        <div className="refund-summary"><span>Bank transfer</span><span>{naira(till.care.transfer)}</span></div>
        <div className="refund-summary"><span>Billed to HMO (not in the drawer)</span><span>{naira(till.care.hmo)}</span></div>
        <div className="refund-summary"><span>Cash refunds paid out</span><span>-{naira(till.care.refunds)}</span></div>
      </Card>

      <Card className="field-wide">
        <SectionLabel>Cash reconciliation</SectionLabel>

        <Field label="Expected cash in till" hint="Cash sales and patient cash payments, less cash refunds. Transfers, cards, credit and HMO don't sit in the drawer.">
          <Input value={naira(expected)} disabled style={{ background: 'var(--disabled-bg)', color: 'var(--muted-2)' }} />
        </Field>

        <Field label="Actual cash counted (₦)" htmlFor="counted" error={error && !hasCounted ? error : undefined}>
          <Input
            id="counted"
            type="number"
            min="0"
            inputMode="numeric"
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
            placeholder="e.g. 57700"
          />
        </Field>

        {varianceText && (
          <div className="row" style={{ gap: 7, margin: '-6px 0 14px', fontSize: 12.5, fontWeight: 700, color: varianceTone }}>
            <span className="row-status" style={{ color: varianceTone }}><span className="dot" style={{ background: varianceTone }} />{varianceText}</span>
          </div>
        )}

        <Field label="Notes (required if there's a variance)" htmlFor="note" error={error && hasCounted ? error : undefined}>
          <Textarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. ₦500 short — one customer's change was miscounted at 2pm"
          />
        </Field>

        <Button variant="primary" onClick={submit} disabled={busy}>
          {busy ? 'Submitting…' : 'Submit report to manager'}
        </Button>
        <div style={{ fontSize: 11.5, color: 'var(--muted-3)', marginTop: 10 }}>
           This closes your shift and sends the report to the hospital&apos;s Reports page for manager review.
        </div>
      </Card>
    </>
  )
}
