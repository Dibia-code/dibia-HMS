import { useMemo, useState } from 'react'
import { PERM } from '@/auth/permissions'
import { useAuth } from '@/auth/AuthContext'
import { useRepo } from '@/data/RepositoryContext'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import {
  useToast, usePageHeader, Card, CardHead, Button, Switch, Pill, Input, EmptyState,
} from '@/components'
import { number, formatDateTime } from '@/lib/format'

const varClass = (v) => (v === 0 ? 'zero' : v > 0 ? 'pos' : 'neg')
const varText = (v) => (v === 0 ? '0' : v > 0 ? `+${v}` : String(v))

// Stocktaking — start a count, optionally "blind" (counter can't see expected
// quantities), enter counted figures, and submit the sheet for approval (§4).
// STOCKTAKING_MANAGE counts; STOCKTAKING_APPROVE signs off.
export default function StocktakingPage() {
  const { user, can } = useAuth()
  const canApprove = can(PERM.STOCKTAKING_APPROVE)
  const canManage = can(PERM.STOCKTAKING_MANAGE)
  const repo = useRepo()
  const toast = useToast()

  const [counting, setCounting] = useState(false)
  const [blind, setBlind] = useState(false)
  const [counts, setCounts] = useState({}) // productId -> string
  const [busy, setBusy] = useState(false)

  const { data: products } = useLiveQuery(() => repo.list('products'), [repo])
  const { data: sheets } = useLiveQuery(() => repo.list('stock_counts'), [repo])

  const history = useMemo(
    () => [...(sheets || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [sheets],
  )

  usePageHeader({ title: 'Stocktaking', subtitle: 'Physical stock counts' }, [])

  function start() {
    setCounts({})
    setCounting(true)
  }

  function reset() {
    setCounting(false)
    setCounts({})
  }

  async function submit() {
    const items = (products || []).map((p) => {
      const raw = counts[p.id]
      const counted = raw === '' || raw == null ? null : Number(raw)
      const system = p.quantity || 0
      return { productId: p.id, name: p.name, system, counted, variance: counted == null ? 0 : counted - system }
    })
    const entered = items.filter((i) => i.counted != null)
    if (!entered.length) {
      toast.error('Enter at least one counted quantity before submitting.')
      return
    }
    setBusy(true)
    try {
      await repo.create('stock_counts', {
        items,
        blind,
        status: 'submitted',
        countedBy: user.userId,
        countedByName: user.name,
        discrepancies: entered.filter((i) => i.variance !== 0).length,
      })
      toast.success('Count submitted for approval')
      reset()
    } catch (err) {
      toast.error(err.message || 'Could not submit count')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {!counting ? (
        <>
          <Card className="mb-3">
            <div className="st-toolbar">
              <div className="toggle-row" style={{ border: 'none', padding: 0 }}>
                <Switch checked={blind} onChange={setBlind} label="Blind count" />
              </div>
              {canManage && <Button variant="primary" icon="stocktaking" onClick={start} disabled={!products?.length}>Start count</Button>}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--muted-3)' }}>
              A blind count hides the expected system quantity while counting, so the count isn&apos;t biased by what the system thinks is on the shelf. Variances are revealed only after you submit.
            </div>
          </Card>

          <Card>
            <CardHead title="Recent counts" />
            {history.length === 0 ? (
              <EmptyState icon="stocktaking" title="No counts yet" hint="Start a count to reconcile physical stock against the system." />
            ) : (
              history.map((s) => (
                <div key={s.id} className="row-line">
                  <div className="grow">
                    <div className="r-title">{formatDateTime(s.createdAt)}{s.blind ? ' · blind' : ''}</div>
                    <div className="r-sub">{s.countedByName || 'Staff'} · {(s.items || []).filter((i) => i.counted != null).length} items counted</div>
                  </div>
                  <div className="row wrap"><Pill tone={s.status === 'approved' ? 'confirmed' : s.status === 'rejected' ? 'failed' : 'pending'}>{s.status === 'approved' ? 'Approved' : s.status === 'rejected' ? 'Needs recount' : 'Awaiting manager approval'}</Pill>
                  {canApprove && s.status !== 'approved' && <><Button size="sm" variant="primary" onClick={async () => { await repo.update('stock_counts', s.id, { status: 'approved', approvedBy: user.userId, approvedByName: user.name, approvedAt: new Date().toISOString() }); toast.success('Count approved') }}>Approve</Button><Button size="sm" variant="quiet" onClick={async () => { await repo.update('stock_counts', s.id, { status: 'rejected', reviewedBy: user.userId, reviewedByName: user.name }); toast.info('Count returned for recount') }}>Return for recount</Button></>}</div>
                  <div className="r-sub">{(s.discrepancies || 0) === 0 ? 'No variance' : `${s.discrepancies} variance${s.discrepancies === 1 ? '' : 's'}`}</div>
                </div>
              ))
            )}
          </Card>
        </>
      ) : (
        <Card>
          <CardHead title={blind ? 'Blind count in progress' : 'Count in progress'}>
            <div className="spacer" />
            <span className="r-sub">{blind ? 'Expected quantities hidden' : 'Expected quantities shown'}</span>
          </CardHead>

          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">System qty</th>
                  <th className="num">Counted</th>
                  <th className="num">Variance</th>
                </tr>
              </thead>
              <tbody>
                {(products || []).map((p) => {
                  const raw = counts[p.id]
                  const counted = raw === '' || raw == null ? null : Number(raw)
                  const variance = counted == null ? null : counted - (p.quantity || 0)
                  return (
                    <tr key={p.id}>
                      <td><span className="cell-strong">{p.name}</span></td>
                      <td className="num">{blind ? '•••' : number(p.quantity || 0)}</td>
                      <td className="num">
                        <Input
                          className="count-input"
                          type="number"
                          min="0"
                          value={raw ?? ''}
                          onChange={(e) => setCounts((c) => ({ ...c, [p.id]: e.target.value }))}
                          placeholder="—"
                          style={{ marginLeft: 'auto' }}
                        />
                      </td>
                      <td className="num">
                        {blind || variance == null ? <span className="text-muted">—</span> : <span className={`variance ${varClass(variance)}`}>{varText(variance)}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="row mt-3" style={{ gap: 10 }}>
            <Button variant="primary" onClick={submit} disabled={busy}>{busy ? 'Submitting…' : 'Submit for approval'}</Button>
            <Button variant="ghost" onClick={reset}>Cancel count</Button>
            <span className="r-sub">Submitted to a manager or administrator with stocktaking approval rights for review.</span>
          </div>
        </Card>
      )}
    </>
  )
}
