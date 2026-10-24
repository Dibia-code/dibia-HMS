import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { PERM } from '@/auth/permissions'
import { useRepo } from '@/data/RepositoryContext'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import { useHospital } from '@/hooks/useHospital'
import {
  useToast, usePageHeader, Card, Button, DataTable, SearchScanBar, FormPanel, FormGrid, Field, Input, Select,
  Switch, Icon, Pill, Modal, EmptyState,
} from '@/components'
import { naira, formatDate, formatDateTime, number } from '@/lib/format'
import { summarise, STATUS_META, daysLeft, isExpired, expiryWindowLabel, unitsFrom } from '@/lib/stock'

function readImageAsDataUrl(file, max = 512) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read that image'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('That file is not a valid image'))
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'restock', label: 'Restock needed' },
  { key: 'expiring', label: 'Expiring' },
  { key: 'out', label: 'Out of stock' },
  { key: 'expired', label: 'Expired' },
]

const MOVE_LABEL = {
  receipt: 'Received', opening: 'Opening balance', sale: 'Sold', dispense: 'Dispensed', return: 'Returned to stock',
  return_damaged: 'Returned, damaged', return_expired: 'Returned, expired', adjustment: 'Adjustment',
  damage: 'Written off, damaged', expired_writeoff: 'Written off, expired',
}

const emptyDraft = () => ({
  name: '', genericName: '', category: '', unit: 'tablet', packSize: '10', cartonSize: '10', barcode: '',
  rx: false, controlled: false, image: '', price: '', batchNo: '', mfgDate: '', expiry: '', quantity: '', cost: '', supplier: '',
})

const emptyBatch = () => ({ batchNo: '', mfgDate: '', expiry: '', quantity: '', unit: 'unit', cost: '', price: '', supplier: '' })

function ExpiryChip({ expiry, windows }) {
  if (!expiry) return <span className="text-muted">No expiry</span>
  const d = daysLeft(expiry)
  const label = expiryWindowLabel(d, windows)
  if (d < 0) return <Pill tone="failed">Expired {formatDate(expiry)}</Pill>
  return (
    <span>
      {formatDate(expiry)} {label && <Pill tone="expiry" dot={false}>{label}</Pill>}
    </span>
  )
}

function DrugDetail({ product, summary, movements, suppliers, canManage, config, quickReceive = false, onClose }) {
  const { user } = useAuth()
  const repo = useRepo()
  const toast = useToast()
  const [receive, setReceive] = useState(null)
  const [adjust, setAdjust] = useState(null)
  const [threshold, setThreshold] = useState(String(summary.threshold))
  const actor = { id: user.userId, name: user.name }
  const isDefault = product.thresholdOverride == null

  useEffect(() => {
    if (quickReceive && canManage) setReceive({ ...emptyBatch(), price: String(product.price || '') })
  }, [quickReceive, canManage, product.id, product.price])

  async function saveThreshold(value) {
    try {
      await repo.setThreshold(product.id, value, actor)
      toast.success('Low-stock threshold saved')
    } catch (err) {
      toast.error(err.message)
    }
  }

  async function saveReceive() {
    const units = unitsFrom(receive.quantity, receive.unit, product)
    if (!units || units <= 0) return setReceive({ ...receive, error: 'Enter the quantity received' })
    if (receive.mfgDate && receive.expiry && receive.expiry <= receive.mfgDate) return setReceive({ ...receive, error: 'Expiry date must be after the manufacturing date' })
    try {
      await repo.receiveStock({
        productId: product.id,
        batch: { ...receive, received: units, price: receive.price || product.price },
        actor,
      })
      toast.success('Stock received')
      setReceive(null)
    } catch (err) {
      toast.error(err.message)
    }
  }

  async function saveAdjust() {
    if (adjust.reason.trim().length < 3) return setAdjust({ ...adjust, error: 'A reason is required' })
    try {
      await repo.adjustBatch({ batchId: adjust.batch.id, newBalance: adjust.balance, kind: adjust.kind, reason: adjust.reason.trim(), actor })
      toast.success('Stock updated')
      setAdjust(null)
    } catch (err) {
      toast.error(err.message)
    }
  }

  const meta = STATUS_META[summary.status]
  const batches = [...summary.batches].sort((a, b) => new Date(a.expiry || '9999') - new Date(b.expiry || '9999'))

  return (
    <Modal xl title={product.name} onClose={onClose} actions={<Button variant="primary" onClick={onClose}>Close</Button>}>
      <div className="row wrap mb-2">
        <Pill tone={meta.tone}>{meta.label}</Pill>
        {product.controlled && <Pill tone="pending">Controlled drug</Pill>}
        {product.rx && <Pill tone="info" dot={false}>Prescription</Pill>}
        <span className="text-muted">{product.genericName || 'No generic name'} · {product.category || 'No category'}</span>
      </div>
      <div className="stat-row cols-3 mb-2">
        <div className="stat-card"><div className="label">Available to dispense</div><div className="value">{number(summary.sellable)}</div><div className="delta">{product.unit}s</div></div>
        <div className="stat-card"><div className="label">Expired stock</div><div className="value">{number(summary.expiredQty)}</div></div>
        <div className="stat-card"><div className="label">Low-stock threshold</div><div className="value">{number(summary.threshold)}</div><div className="delta">{isDefault ? '25% of first stock' : 'Set by pharmacy'}</div></div>
      </div>

      {canManage && (
        <div className="row wrap mb-2">
          <Field label="Low-stock threshold" htmlFor="thr" hint="Default is 25% of the quantity first stocked.">
            <Input id="thr" type="number" min="0" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          </Field>
          <Button variant="ghost" onClick={() => saveThreshold(threshold)}>Save threshold</Button>
          {!isDefault && <Button variant="quiet" onClick={() => { saveThreshold(null); setThreshold(String(Math.ceil((product.initialStock ?? 0) * 0.25))) }}>Use default</Button>}
        </div>
      )}

      <div className="row-between">
        <div className="section-label" style={{ margin: 0 }}>Batches</div>
        {canManage && <Button size="sm" variant="primary" icon="plus" onClick={() => setReceive({ ...emptyBatch(), price: String(product.price || '') })}>Receive stock</Button>}
      </div>
      <div className="table-wrap mt-1">
        <DataTable
          rowStatus={(b) => (isExpired(b) ? 'crit' : daysLeft(b.expiry) <= Math.max(...config.expiryWindows) ? 'expiry' : 'ok')}
          columns={[
            { key: 'batchNo', header: 'Batch', render: (b) => <span className="cell-strong">{b.batchNo}</span> },
            { key: 'expiry', header: 'Expiry', render: (b) => <ExpiryChip expiry={b.expiry} windows={config.expiryWindows} /> },
            { key: 'received', header: 'Received', align: 'num', render: (b) => number(b.received) },
            { key: 'balance', header: 'Balance', align: 'num', render: (b) => number(b.balance) },
            { key: 'cost', header: 'Cost', align: 'num', render: (b) => naira(b.cost) },
            { key: 'price', header: 'Price', align: 'num', render: (b) => naira(b.price) },
            { key: 'supplier', header: 'Supplier', render: (b) => b.supplier || '-' },
            ...(canManage ? [{ key: 'a', header: '', render: (b) => <Button size="sm" variant="quiet" onClick={() => setAdjust({ batch: b, balance: String(b.balance), kind: 'adjustment', reason: '' })}>Adjust</Button> }] : []),
          ]}
          rows={batches}
          empty={<div className="empty-row">No batches recorded.</div>}
        />
      </div>

      <div className="section-label">Stock movement history</div>
      <div className="table-wrap">
        <DataTable
          columns={[
            { key: 'at', header: 'When', render: (m) => formatDateTime(m.at) },
            { key: 'type', header: 'Movement', render: (m) => MOVE_LABEL[m.type] || m.type },
            { key: 'batchNo', header: 'Batch', render: (m) => m.batchNo || '-' },
            { key: 'qty', header: 'Qty', align: 'num', render: (m) => <span className={m.qty < 0 ? 'text-critical' : ''}>{m.qty > 0 ? `+${m.qty}` : m.qty}</span> },
            { key: 'bal', header: 'Balance', align: 'num', render: (m) => `${m.stockBefore} to ${m.stockAfter}` },
            { key: 'staff', header: 'Staff', render: (m) => m.staffName || '-' },
            { key: 'why', header: 'Note', render: (m) => m.reason || m.note || m.ref || '' },
          ]}
          rows={movements.slice(0, 25)}
          empty={<div className="empty-row">No movements yet.</div>}
        />
      </div>

      {receive && (
        <Modal
          title={`Receive stock: ${product.name}`}
          onClose={() => setReceive(null)}
          actions={<><Button variant="ghost" onClick={() => setReceive(null)}>Cancel</Button><Button variant="primary" onClick={saveReceive}>Save batch</Button></>}
          labelledBy="receive-title"
        >
          <div className="form-grid">
            <Field label="Batch number" htmlFor="rb-no"><Input id="rb-no" value={receive.batchNo} onChange={(e) => setReceive({ ...receive, batchNo: e.target.value })} /></Field>
            <Field label="Supplier" htmlFor="rb-sup">
              <Input id="rb-sup" list="suppliers" value={receive.supplier} onChange={(e) => setReceive({ ...receive, supplier: e.target.value })} />
              <datalist id="suppliers">{suppliers.map((s) => <option key={s.id} value={s.name} />)}</datalist>
            </Field>
            <Field label="Manufacturing date" htmlFor="rb-mfg"><Input id="rb-mfg" type="date" value={receive.mfgDate} onChange={(e) => setReceive({ ...receive, mfgDate: e.target.value })} /></Field>
            <Field label="Expiry date" htmlFor="rb-exp"><Input id="rb-exp" type="date" value={receive.expiry} onChange={(e) => setReceive({ ...receive, expiry: e.target.value })} /></Field>
            <Field label="Quantity received" htmlFor="rb-q" error={receive.error} required><Input id="rb-q" type="number" min="0" value={receive.quantity} onChange={(e) => setReceive({ ...receive, quantity: e.target.value, error: '' })} /></Field>
            <Field label="Counted in" htmlFor="rb-u" hint={`1 pack = ${product.packSize || 1}, 1 carton = ${product.cartonSize || 1} packs`}>
              <Select id="rb-u" value={receive.unit} onChange={(e) => setReceive({ ...receive, unit: e.target.value })}>
                <option value="unit">Single {product.unit}s</option>
                <option value="pack">Packs</option>
                <option value="carton">Cartons</option>
              </Select>
            </Field>
            <Field label="Cost price per unit" htmlFor="rb-c"><Input id="rb-c" type="number" min="0" value={receive.cost} onChange={(e) => setReceive({ ...receive, cost: e.target.value })} /></Field>
            <Field label="Selling price per unit" htmlFor="rb-p"><Input id="rb-p" type="number" min="0" value={receive.price} onChange={(e) => setReceive({ ...receive, price: e.target.value })} /></Field>
          </div>
          {receive.quantity && <div className="text-muted mt-2">That adds {number(unitsFrom(receive.quantity, receive.unit, product))} {product.unit}s to stock.</div>}
        </Modal>
      )}

      {adjust && (
        <Modal
          title={`Adjust batch ${adjust.batch.batchNo}`}
          onClose={() => setAdjust(null)}
          actions={<><Button variant="ghost" onClick={() => setAdjust(null)}>Cancel</Button><Button variant="primary" onClick={saveAdjust}>Save adjustment</Button></>}
          labelledBy="adjust-title"
        >
          <div className="stack-gap">
            <Field label="Type" htmlFor="ad-k">
              <Select id="ad-k" value={adjust.kind} onChange={(e) => setAdjust({ ...adjust, kind: e.target.value })}>
                <option value="adjustment">Count correction</option>
                <option value="damage">Written off, damaged</option>
                <option value="expired_writeoff">Written off, expired</option>
              </Select>
            </Field>
            <Field label="New balance" htmlFor="ad-b" hint={`Currently ${adjust.batch.balance}`}><Input id="ad-b" type="number" min="0" value={adjust.balance} onChange={(e) => setAdjust({ ...adjust, balance: e.target.value })} /></Field>
            <Field label="Reason" htmlFor="ad-r" required error={adjust.error}><Input id="ad-r" value={adjust.reason} onChange={(e) => setAdjust({ ...adjust, reason: e.target.value, error: '' })} /></Field>
          </div>
        </Modal>
      )}
    </Modal>
  )
}

export default function InventoryPage() {
  const { user, can } = useAuth()
  const canManage = can(PERM.INVENTORY_MANAGE)
  const repo = useRepo()
  const toast = useToast()
  const { config } = useHospital()
  const location = useLocation()
  const navigate = useNavigate()

  const [params] = useSearchParams()
  const [tab, setTab] = useState(TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'all')
  const [view, setView] = useState('grid')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState(null)
  const [restockId, setRestockId] = useState(null)
  const [receiveChooserOpen, setReceiveChooserOpen] = useState(false)
  const [receiveProductId, setReceiveProductId] = useState('')
  const [draft, setDraft] = useState(null)
  const [errors, setErrors] = useState({})
  const fileRef = useRef(null)

  useEffect(() => {
    if (!location.state?.openNewProduct || !canManage) return
    setErrors({})
    setDraft(emptyDraft())
    navigate(`${location.pathname}${location.search}`, { replace: true, state: { returnToPos: location.state.returnToPos } })
  }, [canManage, location.pathname, location.search, location.state, navigate])

  const { data: products } = useLiveQuery(() => repo.list('products'), [repo])
  const { data: batches } = useLiveQuery(() => repo.list('batches'), [repo])
  const { data: movements } = useLiveQuery(() => repo.list('stock_movements'), [repo])
  const { data: suppliers } = useLiveQuery(() => repo.list('suppliers'), [repo])

  usePageHeader(
    {
      title: 'Inventory',
      subtitle: 'Stock, batches and expiry',
      actions: canManage && !draft && (
        <div className="row wrap">
          <Button variant="ghost" icon="plus" onClick={() => { setReceiveProductId(''); setReceiveChooserOpen(true) }}>Receive stock</Button>
          <Button variant="primary" icon="plus" onClick={() => { setErrors({}); setDraft(emptyDraft()) }}>Add product</Button>
        </div>
      ),
    },
    [canManage, !!draft],
  )

  const items = useMemo(
    () =>
      (products || [])
        .filter((p) => !p.archived)
        .map((p) => ({ product: p, s: summarise(p, batches || [], config.expiryWindows) })),
    [products, batches, config.expiryWindows],
  )

  const counts = useMemo(
    () => ({
      all: items.length,
      restock: items.filter((i) => i.s.status === 'low' || i.s.status === 'out' || i.s.status === 'expired').length,
      expiring: items.filter((i) => i.s.expiringSoon).length,
      out: items.filter((i) => i.s.status === 'out').length,
      expired: items.filter((i) => i.s.expiredQty > 0).length,
    }),
    [items],
  )

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = items.filter(({ product: p }) => !q || `${p.name} ${p.genericName || ''} ${p.category || ''} ${p.barcode || ''}`.toLowerCase().includes(q))
    if (tab === 'restock') list = list.filter((i) => ['low', 'out', 'expired'].includes(i.s.status)).sort((a, b) => a.s.criticality - b.s.criticality)
    else if (tab === 'expiring') list = list.filter((i) => i.s.expiringSoon).sort((a, b) => a.s.nearestDays - b.s.nearestDays)
    else if (tab === 'out') list = list.filter((i) => i.s.status === 'out')
    else if (tab === 'expired') list = list.filter((i) => i.s.expiredQty > 0)
    return list
  }, [items, query, tab])

  function onScan(scannedValue) {
    const q = String(scannedValue ?? query).trim()
    const hit = items.find(({ product: p }) => p.barcode === q || p.name.toLowerCase() === q.toLowerCase())
    if (hit) setOpenId(hit.product.id)
    else toast.error('No product matches that barcode')
  }

  function openRestock(productId) {
    setRestockId(productId)
    setOpenId(productId)
  }

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }))

  async function onPickImage(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      set('image', await readImageAsDataUrl(file))
    } catch (err) {
      toast.error(err.message || 'Could not use that image')
    }
  }

  async function save() {
    const e = {}
    if (!draft.name.trim()) e.name = 'Required'
    if (draft.price === '' || Number.isNaN(Number(draft.price))) e.price = 'Enter a price'
    if (draft.mfgDate && draft.expiry && draft.expiry <= draft.mfgDate) e.expiry = 'Expiry date must be after the manufacturing date'
    setErrors(e)
    if (Object.keys(e).length) return
    const product = {
      name: draft.name.trim(), genericName: draft.genericName.trim().toLowerCase(), category: draft.category.trim(),
      unit: draft.unit || 'unit', packSize: Number(draft.packSize) || 1, cartonSize: Number(draft.cartonSize) || 1,
      barcode: draft.barcode.trim(), rx: !!draft.rx, controlled: !!draft.controlled, image: draft.image || null,
      price: Number(draft.price), costPrice: Number(draft.cost || 0),
    }
    const received = Number(draft.quantity) || 0
    try {
      await repo.createProduct({
        product,
        batch: { batchNo: draft.batchNo.trim(), mfgDate: draft.mfgDate, expiry: draft.expiry || null, received, cost: draft.cost, price: draft.price, supplier: draft.supplier.trim() },
        actor: { id: user.userId, name: user.name },
      })
      toast.success('Product added')
      setDraft(null)
      if (location.state?.returnToPos) navigate(location.state.returnToPos, { replace: true })
    } catch (err) {
      toast.error(err.message || 'Could not save product')
    }
  }

  function closeProductForm() {
    setDraft(null)
    if (location.state?.returnToPos) navigate(location.state.returnToPos, { replace: true })
  }

  const open = openId ? items.find((i) => i.product.id === openId) : null

  return (
    <>
      <div className="inv-toolbar">
        <div className="filter-chips">
          {TABS.map((t) => (
            <button key={t.key} type="button" className={`filter-chip ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
              {t.label}{counts[t.key] ? ` · ${counts[t.key]}` : ''}
            </button>
          ))}
        </div>
        <div className="row">
          <div style={{ flex: '1 1 300px', minWidth: 220 }}>
            <SearchScanBar value={query} onChange={setQuery} onScan={onScan} placeholder="Search or scan a drug" />
          </div>
          <div className="seg two" role="radiogroup" aria-label="View" style={{ width: 168 }}>
            {[['grid', 'Grid'], ['list', 'List']].map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => setView(v)}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      {draft && canManage && (
        <div className="mb-3">
          <FormPanel title="New product" submitLabel="Save product" onClose={closeProductForm} onSubmit={save}>
            <FormGrid>
              <Field label="Product name" htmlFor="p-name" error={errors.name} required><Input id="p-name" value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Amoxicillin 500mg" /></Field>
              <Field label="Generic name" htmlFor="p-gen" hint="Used for substitutions and interaction checks"><Input id="p-gen" value={draft.genericName} onChange={(e) => set('genericName', e.target.value)} placeholder="e.g. amoxicillin" /></Field>
              <Field label="Category" htmlFor="p-cat"><Input id="p-cat" value={draft.category} onChange={(e) => set('category', e.target.value)} /></Field>
              <Field label="Unit" htmlFor="p-unit"><Input id="p-unit" value={draft.unit} onChange={(e) => set('unit', e.target.value)} placeholder="tablet, bottle, sachet" /></Field>
              <Field label="Units per pack" htmlFor="p-pack"><Input id="p-pack" type="number" min="1" value={draft.packSize} onChange={(e) => set('packSize', e.target.value)} /></Field>
              <Field label="Packs per carton" htmlFor="p-carton"><Input id="p-carton" type="number" min="1" value={draft.cartonSize} onChange={(e) => set('cartonSize', e.target.value)} /></Field>
              <Field label="Barcode" htmlFor="p-bar"><Input id="p-bar" value={draft.barcode} onChange={(e) => set('barcode', e.target.value)} /></Field>
              <Field label="Selling price (naira)" htmlFor="p-price" error={errors.price} required><Input id="p-price" type="number" min="0" value={draft.price} onChange={(e) => set('price', e.target.value)} /></Field>
              <Field label="First batch number" htmlFor="p-batch"><Input id="p-batch" value={draft.batchNo} onChange={(e) => set('batchNo', e.target.value)} /></Field>
              <Field label="Supplier" htmlFor="p-sup"><Input id="p-sup" value={draft.supplier} onChange={(e) => set('supplier', e.target.value)} /></Field>
              <Field label="Manufacturing date" htmlFor="p-mfg"><Input id="p-mfg" type="date" value={draft.mfgDate} max={draft.expiry || undefined} onChange={(e) => set('mfgDate', e.target.value)} /></Field>
              <Field label="Expiry date" htmlFor="p-exp" error={errors.expiry}><Input id="p-exp" type="date" min={draft.mfgDate || undefined} value={draft.expiry} onChange={(e) => set('expiry', e.target.value)} /></Field>
              <Field label="Quantity in stock" htmlFor="p-qty" hint="Low-stock alert starts at 25% of this. You can change it later."><Input id="p-qty" type="number" min="0" value={draft.quantity} onChange={(e) => set('quantity', e.target.value)} /></Field>
              <Field label="Cost price per unit" htmlFor="p-cost"><Input id="p-cost" type="number" min="0" value={draft.cost} onChange={(e) => set('cost', e.target.value)} /></Field>
              <Field label="Prescription only" span2><Switch checked={draft.rx} onChange={(on) => set('rx', on)} label={draft.rx ? 'Requires prescription' : 'Over the counter'} /></Field>
              <Field label="Controlled drug" span2 hint="A pharmacist PIN is asked for before this drug is dispensed."><Switch checked={draft.controlled} onChange={(on) => set('controlled', on)} label={draft.controlled ? 'Controlled' : 'Not controlled'} /></Field>
              <Field label="Product image" span2 hint="Saved on this device.">
                <div className="img-picker">
                  {draft.image ? <img className="img-thumb-lg" src={draft.image} alt="Product preview" /> : <span className="img-thumb-lg placeholder"><Icon name="image" size={26} /></span>}
                  <div className="img-picker-actions">
                    <Button variant="ghost" size="sm" icon="image" onClick={() => fileRef.current?.click()}>{draft.image ? 'Change image' : 'Upload image'}</Button>
                    <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickImage} />
                  </div>
                </div>
              </Field>
            </FormGrid>
          </FormPanel>
        </div>
      )}

      {receiveChooserOpen && canManage && (
        <Modal
          title="Receive stock"
          onClose={() => setReceiveChooserOpen(false)}
          actions={<><Button variant="ghost" onClick={() => setReceiveChooserOpen(false)}>Cancel</Button><Button variant="primary" disabled={!receiveProductId} onClick={() => { openRestock(receiveProductId); setReceiveChooserOpen(false) }}>Continue</Button></>}
        >
          <Field label="Choose a drug to restock" htmlFor="receive-product">
            <Select id="receive-product" value={receiveProductId} onChange={(event) => setReceiveProductId(event.target.value)}>
              <option value="">Select a drug</option>
              {(products || []).filter((product) => !product.archived).sort((a, b) => a.name.localeCompare(b.name)).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </Select>
          </Field>
          <p className="text-muted mt-2">Next, enter the received batch, quantity, cost, supplier, and expiry date.</p>
        </Modal>
      )}

      {rows.length === 0 ? (
        <EmptyState icon="inventory" title={tab === 'all' ? 'No products yet' : 'Nothing here'} hint={tab === 'restock' ? 'Every drug is above its low-stock threshold.' : 'Try another filter or search.'} />
      ) : view === 'grid' ? (
        <div className="inv-grid">
          {rows.map(({ product: p, s }) => {
            const meta = STATUS_META[s.status]
            return (
              <div key={p.id} className={`inv-card status-${meta.border}`} role="button" tabIndex={0} onClick={() => setOpenId(p.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOpenId(p.id) } }}>
                {p.image && <img className="inv-product-image" src={p.image} alt="" />}
                <span className="ic-top">
                  <span className="ic-name">{p.name}</span>
                  <Pill tone={meta.tone}>{meta.label}</Pill>
                </span>
                <span className="ic-gen">{p.genericName || p.category || 'No generic name'}{p.controlled ? ' · Controlled' : ''}</span>
                <span className="ic-qty">{number(s.sellable)} <small>{p.unit}s</small></span>
                <span className="ic-meta">
                  <span>{s.liveBatches.length} batch{s.liveBatches.length === 1 ? '' : 'es'}</span>
                  <span>{s.nearest ? `Nearest expiry ${formatDate(s.nearest.expiry)}` : s.expiredQty ? 'Only expired stock' : 'No expiry set'}</span>
                </span>
                {canManage && <Button size="sm" variant="primary" icon="plus" onClick={(event) => { event.stopPropagation(); openRestock(p.id) }}>Receive stock</Button>}
              </div>
            )
          })}
        </div>
      ) : (
        <Card>
          <DataTable
            rowStatus={({ s }) => STATUS_META[s.status].border}
            onRowClick={({ product }) => setOpenId(product.id)}
            columns={[
              { key: 'n', header: 'Drug', render: ({ product: p }) => (<div className="prod-cell">{p.image && <img className="prod-thumb" src={p.image} alt="" />}<div><div className="cell-strong">{p.name}</div><div className="cell-sub">{p.genericName || p.category || ''}</div></div></div>) },
              { key: 'q', header: 'Stock', align: 'num', render: ({ s, product }) => `${number(s.sellable)} ${product.unit}s` },
              { key: 'b', header: 'Batches', align: 'num', render: ({ s }) => s.liveBatches.length },
              { key: 'e', header: 'Nearest expiry', render: ({ s }) => (s.nearest ? formatDate(s.nearest.expiry) : '-') },
              { key: 's', header: 'Status', render: ({ s }) => <Pill tone={STATUS_META[s.status].tone}>{STATUS_META[s.status].label}</Pill> },
              { key: 'p', header: 'Price', align: 'num', render: ({ product }) => naira(product.price) },
              ...(canManage ? [{ key: 'restock', header: '', render: ({ product }) => <Button size="sm" variant="primary" icon="plus" onClick={(event) => { event.stopPropagation(); openRestock(product.id) }}>Receive stock</Button> }] : []),
            ]}
            rows={rows}
            getRowKey={({ product }) => product.id}
          />
        </Card>
      )}

      {open && (
        <DrugDetail
          product={open.product}
          summary={open.s}
          movements={(movements || []).filter((m) => m.productId === open.product.id).sort((a, b) => new Date(b.at) - new Date(a.at))}
          suppliers={suppliers || []}
          canManage={canManage}
          config={config}
          quickReceive={restockId === open.product.id}
          onClose={() => { setOpenId(null); setRestockId(null) }}
        />
      )}
    </>
  )
}
