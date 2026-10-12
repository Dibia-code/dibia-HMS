import { useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { useRepo } from '@/data/RepositoryContext'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import { useToast, usePageHeader, Card, SectionLabel, Button, Field, Input, Textarea } from '@/components'
import { naira } from '@/lib/format'

const normalizeRef = (s) => s.trim().replace(/^#/, '').toLowerCase()

// Refund — cashier finds a completed sale by its reference, reviews the lines,
// records a reason, and confirms. Writes a refund + flips the sale to refunded,
// offline-first like every other write (§5).
export default function RefundPage() {
  const { user } = useAuth()
  const repo = useRepo()
  const toast = useToast()

  const [txn, setTxn] = useState('')
  const [found, setFound] = useState(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const { data: sales } = useLiveQuery(() => repo.list('sales'), [repo])

  function findSale() {
    setError('')
    const q = normalizeRef(txn)
    if (!q) { setError('Enter a transaction number.'); return }
    const hit = (sales || []).find((s) => normalizeRef(String(s.reference || '')) === q)
    if (!hit) { setFound(null); toast.error('No sale matches that transaction number'); return }
    if (hit.status === 'refunded') { setFound(hit); toast.info('This sale has already been refunded'); return }
    setFound(hit)
    setReason('')
  }

  async function confirmRefund() {
    if (!reason.trim()) { setError('A reason is required to process a refund.'); return }
    setError('')
    setBusy(true)
    try {
      await repo.create('refunds', {
        saleId: found.id,
        reference: found.reference,
        amount: found.total || 0,
        reason: reason.trim(),
        items: found.items || [],
        cashierId: user.userId,
        branchId: found.branchId || null,
      })
      await repo.update('sales', found.id, { status: 'refunded' })
      toast.success(`Refund processed for ${found.reference}`)
      setFound(null)
      setTxn('')
      setReason('')
    } catch (err) {
      toast.error(err.message || 'Could not process refund')
    } finally {
      setBusy(false)
    }
  }

  usePageHeader({ title: 'Refund', subtitle: 'Process a return' }, [])

  const alreadyRefunded = found?.status === 'refunded'

  return (
    <>
      <Card className="field-wide mb-2">
        <SectionLabel>Find the sale</SectionLabel>
        <Field label="Transaction number" htmlFor="txn" error={error && !found ? error : undefined}>
          <Input id="txn" value={txn} onChange={(e) => setTxn(e.target.value)} placeholder="e.g. #A1042" onKeyDown={(e) => e.key === 'Enter' && findSale()} />
        </Field>
        <Button variant="ghost" onClick={findSale}>Find sale</Button>
      </Card>

      {found && (
        <Card className="field-wide">
          <SectionLabel>Sale {found.reference}</SectionLabel>
          {(found.items || []).map((it, i) => (
            <div key={i} className="refund-summary">
              <span>{it.name} × {it.qty}</span>
              <span>{naira((it.price || 0) * (it.qty || 0))}</span>
            </div>
          ))}
          <div className="refund-summary total"><span>Total</span><span>{naira(found.total || 0)}</span></div>

          {alreadyRefunded ? (
            <div className="text-muted mt-2" style={{ fontSize: 13 }}>This sale was already refunded — no further action needed.</div>
          ) : (
            <>
              <Field className="mt-2" label="Reason for refund (required)" htmlFor="reason" error={error && found ? error : undefined}>
                <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer changed mind, wrong item dispensed…" />
              </Field>
              <Button variant="primary" onClick={confirmRefund} disabled={busy}>
                {busy ? 'Processing…' : 'Confirm refund'}
              </Button>
            </>
          )}
        </Card>
      )}
    </>
  )
}
