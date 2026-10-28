import { useMemo, useState } from 'react'
import { useRepo } from '@/data/RepositoryContext'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import {
  useToast, usePageHeader, Card, CardHead, Button, DataTable,
  Pill, FormPanel, FormGrid, Field, Input, Select,
} from '@/components'
import { naira, formatDate } from '@/lib/format'

const TABS = [
  { key: 'orders', label: 'Purchase orders' },
  { key: 'suppliers', label: 'Suppliers' },
]

const poPill = (s) => (s === 'received' ? { tone: 'confirmed', label: 'Received' } : { tone: 'pending', label: 'Pending' })

// Purchasing — two tabs (§4): raise purchase orders against suppliers, and keep
// the supplier ledger. PURCHASING_MANAGE only.
export default function PurchasingPage() {
  const repo = useRepo()
  const toast = useToast()

  const [tab, setTab] = useState('orders')
  const [poDraft, setPoDraft] = useState(null)
  const [supDraft, setSupDraft] = useState(null)
  const [errors, setErrors] = useState({})

  const { data: orders } = useLiveQuery(() => repo.list('purchase_orders'), [repo])
  const { data: suppliers } = useLiveQuery(() => repo.list('suppliers'), [repo])
  const { data: products } = useLiveQuery(() => repo.list('products'), [repo])

  const supplierName = (id) => suppliers?.find((s) => s.id === id)?.name || '—'

  const orderRows = useMemo(
    () => [...(orders || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [orders],
  )

  usePageHeader(
    {
      title: 'Purchasing',
      subtitle: 'Purchase orders & suppliers',
      actions:
        tab === 'orders'
          ? !poDraft && (
              <Button variant="primary" icon="plus" onClick={() => { setErrors({}); setPoDraft({ supplierId: suppliers?.[0]?.id || '', productId: products?.[0]?.id || '', qty: '', cost: '' }) }}>
                New purchase order
              </Button>
            )
          : !supDraft && (
              <Button variant="primary" icon="plus" onClick={() => { setErrors({}); setSupDraft({ name: '', phone: '', email: '', contactName: '', creditTerms: '' }) }}>
                Add supplier
              </Button>
            ),
    },
    [tab, !!poDraft, !!supDraft, suppliers?.length, products?.length],
  )

  async function savePo() {
    const e = {}
    if (!poDraft.supplierId) e.supplierId = 'Pick a supplier'
    if (!poDraft.productId) e.productId = 'Pick a product'
    if (!poDraft.qty || Number(poDraft.qty) <= 0) e.qty = 'Enter a quantity'
    if (poDraft.cost === '' || Number(poDraft.cost) < 0) e.cost = 'Enter a unit cost'
    setErrors(e)
    if (Object.keys(e).length) return
    const qty = Number(poDraft.qty)
    const cost = Number(poDraft.cost)
    try {
      await repo.create('purchase_orders', {
        reference: `PO-${1001 + (orders?.length || 0)}`,
        supplierId: poDraft.supplierId,
        status: 'pending',
        total: qty * cost,
        items: [{ productId: poDraft.productId, qty, cost }],
      })
      toast.success('Purchase order raised')
      setPoDraft(null)
    } catch (err) {
      toast.error(err.message || 'Could not raise order')
    }
  }

  async function receive(po) {
    await repo.update('purchase_orders', po.id, { status: 'received' })
    toast.success(`${po.reference} marked received`)
  }

  async function saveSupplier() {
    const e = {}
    if (!supDraft.name.trim()) e.name = 'Required'
    setErrors(e)
    if (Object.keys(e).length) return
    try {
      await repo.create('suppliers', {
        name: supDraft.name.trim(),
        phone: supDraft.phone.trim(),
        email: supDraft.email.trim(),
        contactName: supDraft.contactName.trim(),
        creditTerms: supDraft.creditTerms.trim(),
        balanceOwed: 0,
      })
      toast.success('Supplier added')
      setSupDraft(null)
    } catch (err) {
      toast.error(err.message || 'Could not add supplier')
    }
  }

  const orderCols = [
    { key: 'reference', header: 'PO number', render: (r) => <span className="cell-strong">{r.reference}</span> },
    { key: 'supplierId', header: 'Supplier', render: (r) => supplierName(r.supplierId) },
    { key: 'items', header: 'Items', align: 'num', render: (r) => (r.items || []).reduce((s, i) => s + (i.qty || 0), 0) },
    { key: 'total', header: 'Amount', align: 'num', render: (r) => naira(r.total || 0) },
    { key: 'createdAt', header: 'Date', render: (r) => formatDate(r.createdAt) },
    { key: 'status', header: 'Status', render: (r) => { const p = poPill(r.status); return <Pill tone={p.tone}>{p.label}</Pill> } },
    {
      key: 'actions', header: '', align: 'num',
      render: (r) => r.status !== 'received' && <Button variant="quiet" size="sm" onClick={() => receive(r)}>Mark received</Button>,
    },
  ]

  const supplierCols = [
    { key: 'name', header: 'Supplier', render: (r) => <span className="cell-strong">{r.name}</span> },
    { key: 'contactName', header: 'Contact person', render: (r) => r.contactName || '—' },
    { key: 'phone', header: 'Phone', render: (r) => r.phone || '—' },
    { key: 'email', header: 'Email', render: (r) => r.email || '—' },
    { key: 'creditTerms', header: 'Credit terms', render: (r) => r.creditTerms || '—' },
    { key: 'balanceOwed', header: 'Balance owed', align: 'num', render: (r) => <span className={(r.balanceOwed || 0) > 0 ? 'bal-owed' : 'bal-clear'}>{(r.balanceOwed || 0) > 0 ? naira(r.balanceOwed) : 'Clear'}</span> },
  ]

  return (
    <>
      <div className="filter-chips mb-3">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={`filter-chip ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'orders' && (
        <>
          {poDraft && (
            <div className="mb-3">
              <FormPanel title="New purchase order" submitLabel="Raise order" onClose={() => setPoDraft(null)} onSubmit={savePo}>
                <FormGrid>
                  <Field label="Supplier" htmlFor="po-sup" error={errors.supplierId}>
                    <Select id="po-sup" value={poDraft.supplierId} onChange={(e) => setPoDraft((d) => ({ ...d, supplierId: e.target.value }))}>
                      <option value="">Select supplier…</option>
                      {(suppliers || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Product" htmlFor="po-prod" error={errors.productId}>
                    <Select id="po-prod" value={poDraft.productId} onChange={(e) => setPoDraft((d) => ({ ...d, productId: e.target.value }))}>
                      <option value="">Select product…</option>
                      {(products || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Quantity" htmlFor="po-qty" error={errors.qty}>
                    <Input id="po-qty" type="number" min="1" value={poDraft.qty} onChange={(e) => setPoDraft((d) => ({ ...d, qty: e.target.value }))} placeholder="0" />
                  </Field>
                  <Field label="Unit cost (₦)" htmlFor="po-cost" error={errors.cost}>
                    <Input id="po-cost" type="number" min="0" value={poDraft.cost} onChange={(e) => setPoDraft((d) => ({ ...d, cost: e.target.value }))} placeholder="0" />
                  </Field>
                </FormGrid>
              </FormPanel>
            </div>
          )}
          <Card>
            <CardHead title={`Purchase orders (${orderRows.length})`} />
            <DataTable columns={orderCols} rows={orderRows} empty={<div className="empty-row">No purchase orders yet.</div>} />
          </Card>
        </>
      )}

      {tab === 'suppliers' && (
        <>
          {supDraft && (
            <div className="mb-3">
              <FormPanel title="Add supplier" submitLabel="Save supplier" onClose={() => setSupDraft(null)} onSubmit={saveSupplier}>
                <FormGrid>
                  <Field label="Supplier name" htmlFor="s-name" error={errors.name}>
                    <Input id="s-name" value={supDraft.name} onChange={(e) => setSupDraft((d) => ({ ...d, name: e.target.value }))} placeholder="e.g. Emzor Pharmaceuticals" />
                  </Field>
                  <Field label="Phone number" htmlFor="s-phone">
                    <Input id="s-phone" value={supDraft.phone} onChange={(e) => setSupDraft((d) => ({ ...d, phone: e.target.value }))} placeholder="e.g. 0803 000 0000" />
                  </Field>
                  <Field label="Contact person" htmlFor="s-contact"><Input id="s-contact" value={supDraft.contactName} onChange={(e) => setSupDraft((d) => ({ ...d, contactName: e.target.value }))} /></Field>
                  <Field label="Email address" htmlFor="s-email"><Input id="s-email" type="email" value={supDraft.email} onChange={(e) => setSupDraft((d) => ({ ...d, email: e.target.value }))} /></Field>
                  <Field label="Credit terms" htmlFor="s-terms" hint="e.g. Net 30, Net 14, Cash on delivery" span2>
                    <Input id="s-terms" value={supDraft.creditTerms} onChange={(e) => setSupDraft((d) => ({ ...d, creditTerms: e.target.value }))} placeholder="e.g. Net 30" />
                  </Field>
                </FormGrid>
              </FormPanel>
            </div>
          )}
          <Card>
            <CardHead title={`Suppliers (${suppliers?.length || 0})`} />
            <DataTable columns={supplierCols} rows={suppliers || []} empty={<div className="empty-row">No suppliers yet.</div>} />
          </Card>
        </>
      )}
    </>
  )
}
