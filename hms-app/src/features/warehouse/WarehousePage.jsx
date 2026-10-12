import { useMemo, useState } from 'react'
import { useRepo } from '@/data/RepositoryContext'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import {
  useToast, usePageHeader, Card, CardHead, Button, DataTable, Pill,
  StatRow, StatCard, FormPanel, FormGrid, Field, Input, Select,
} from '@/components'
import { number, formatDate } from '@/lib/format'

// Warehouse — raise inter-branch stock transfers and approve the queue, plus a
// central view of stock on hand (§4). WAREHOUSE_MANAGE.
export default function WarehousePage() {
  const repo = useRepo()
  const toast = useToast()

  const [draft, setDraft] = useState(null)
  const [errors, setErrors] = useState({})

  const { data: transfers } = useLiveQuery(() => repo.list('transfers'), [repo])
  const { data: products } = useLiveQuery(() => repo.list('products'), [repo])
  const { data: branches } = useLiveQuery(() => repo.list('branches'), [repo])

  const branchName = (id) => branches?.find((b) => b.id === id)?.name || '—'

  const stats = useMemo(() => {
    const list = products || []
    return {
      pending: (transfers || []).filter((t) => t.status === 'pending' || !t.status).length,
      units: list.reduce((sum, p) => sum + (p.quantity || 0), 0),
      low: list.filter((p) => (p.quantity || 0) <= (p.reorderLevel || 0)).length,
    }
  }, [transfers, products])

  const transferRows = useMemo(
    () => [...(transfers || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [transfers],
  )

  usePageHeader(
    {
      title: 'Warehouse',
      subtitle: 'Central stock & transfers',
      actions: !draft && (
        <Button variant="primary" icon="plus" onClick={() => { setErrors({}); setDraft({ productId: products?.[0]?.id || '', qty: '', fromBranchId: branches?.[0]?.id || '', toBranchId: branches?.[1]?.id || '' }) }}>
          New transfer
        </Button>
      ),
    },
    [!!draft, products?.length, branches?.length],
  )

  async function save() {
    const e = {}
    if (!draft.productId) e.productId = 'Pick a product'
    if (!draft.qty || Number(draft.qty) <= 0) e.qty = 'Enter a quantity'
    if (!draft.fromBranchId) e.fromBranchId = 'Pick a source'
    if (!draft.toBranchId) e.toBranchId = 'Pick a destination'
    else if (draft.toBranchId === draft.fromBranchId) e.toBranchId = 'Must differ from source'
    setErrors(e)
    if (Object.keys(e).length) return
    const product = (products || []).find((p) => p.id === draft.productId)
    try {
      await repo.create('transfers', {
        productId: draft.productId,
        productName: product?.name || 'Stock',
        qty: Number(draft.qty),
        fromBranchId: draft.fromBranchId,
        toBranchId: draft.toBranchId,
        status: 'pending',
      })
      toast.success('Transfer request raised')
      setDraft(null)
    } catch (err) {
      toast.error(err.message || 'Could not raise transfer')
    }
  }

  async function decide(t, status) {
    await repo.update('transfers', t.id, { status })
    toast.success(`Transfer ${status}`)
  }

  const transferCols = [
    { key: 'productName', header: 'Product', render: (r) => <span className="cell-strong">{r.productName || 'Stock'}</span> },
    { key: 'qty', header: 'Qty', align: 'num', render: (r) => number(r.qty || 0) },
    { key: 'route', header: 'Route', render: (r) => `${branchName(r.fromBranchId)} → ${branchName(r.toBranchId)}` },
    { key: 'createdAt', header: 'Requested', render: (r) => formatDate(r.createdAt) },
    { key: 'status', header: 'Status', render: (r) => <Pill tone={r.status === 'approved' ? 'confirmed' : r.status === 'rejected' ? 'critical' : 'pending'}>{r.status === 'approved' ? 'Approved' : r.status === 'rejected' ? 'Rejected' : 'Pending'}</Pill> },
    {
      key: 'actions', header: '', align: 'num',
      render: (r) =>
        (r.status === 'pending' || !r.status) && (
          <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
            <Button variant="quiet" size="sm" onClick={() => decide(r, 'approved')}>Approve</Button>
            <Button variant="quiet" size="sm" onClick={() => decide(r, 'rejected')}>Reject</Button>
          </span>
        ),
    },
  ]

  const stockCols = [
    { key: 'name', header: 'Product', render: (r) => <span className="cell-strong">{r.name}</span> },
    { key: 'branchId', header: 'Branch', render: (r) => branchName(r.branchId) },
    { key: 'quantity', header: 'On hand', align: 'num', render: (r) => number(r.quantity || 0) },
    {
      key: 'reorderLevel', header: 'Reorder at', align: 'num',
      render: (r) => (
        <span className={(r.quantity || 0) <= (r.reorderLevel || 0) ? 'text-critical fw-600' : ''}>{number(r.reorderLevel || 0)}</span>
      ),
    },
  ]

  return (
    <>
      <StatRow>
        <StatCard label="Pending transfers" value={stats.pending} />
        <StatCard label="Total stock units" value={number(stats.units)} />
        <StatCard label="Low-stock items" value={stats.low} deltaDir={stats.low ? 'down' : 'flat'} delta={stats.low ? 'Reorder soon' : 'Healthy'} />
      </StatRow>

      {draft && (
        <div className="mt-3 mb-3">
          <FormPanel title="New stock transfer" submitLabel="Raise transfer" onClose={() => setDraft(null)} onSubmit={save}>
            <FormGrid>
              <Field label="Product" htmlFor="w-prod" error={errors.productId}>
                <Select id="w-prod" value={draft.productId} onChange={(e) => setDraft((d) => ({ ...d, productId: e.target.value }))}>
                  <option value="">Select product…</option>
                  {(products || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </Field>
              <Field label="Quantity" htmlFor="w-qty" error={errors.qty}>
                <Input id="w-qty" type="number" min="1" value={draft.qty} onChange={(e) => setDraft((d) => ({ ...d, qty: e.target.value }))} placeholder="0" />
              </Field>
              <Field label="From branch" htmlFor="w-from" error={errors.fromBranchId}>
                <Select id="w-from" value={draft.fromBranchId} onChange={(e) => setDraft((d) => ({ ...d, fromBranchId: e.target.value }))}>
                  {(branches || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </Field>
              <Field label="To branch" htmlFor="w-to" error={errors.toBranchId}>
                <Select id="w-to" value={draft.toBranchId} onChange={(e) => setDraft((d) => ({ ...d, toBranchId: e.target.value }))}>
                  {(branches || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </Field>
            </FormGrid>
          </FormPanel>
        </div>
      )}

      <Card className="mt-3 mb-3">
        <CardHead title={`Transfer requests (${transferRows.length})`} />
        <DataTable columns={transferCols} rows={transferRows} empty={<div className="empty-row">No transfer requests yet.</div>} />
      </Card>

      <Card>
        <CardHead title="Central stock" />
        <DataTable columns={stockCols} rows={products || []} empty={<div className="empty-row">No products yet.</div>} />
      </Card>
    </>
  )
}
