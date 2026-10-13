import { useMemo, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { useRepo } from '@/data/RepositoryContext'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import {
  useToast, usePageHeader, Card, Button, SectionLabel, SearchScanBar, PayToggle, Select, EmptyState,
} from '@/components'
import { naira } from '@/lib/format'
import { summarise } from '@/lib/stock'
import { refCode } from '@/lib/id'

const stockClass = (p) => (p.quantity <= 0 ? 'out' : p.quantity <= p.reorderLevel ? 'low' : 'in')
const stockLabel = (p) => (p.quantity <= 0 ? 'Out of stock' : `${p.quantity} in stock`)

// POS — the offline-first sale path (§5, §6). recordSale writes the sale,
// decrements stock, and appends one outbox op per affected record in a single
// IndexedDB transaction, so a sale rung up with no network is durable locally
// and syncs (idempotently) on reconnect. The SyncChip in the topbar reflects it.
export default function PosPage() {
  const { user } = useAuth()
  const repo = useRepo()
  const toast = useToast()

  const [query, setQuery] = useState('')
  const [cart, setCart] = useState([]) // [{ productId, name, price, qty, rx, stock }]
  const [payment, setPayment] = useState('cash')
  const [customerId, setCustomerId] = useState('')
  const [busy, setBusy] = useState(false)

  const { data: rawProducts } = useLiveQuery(() => repo.list('products'), [repo])
  const { data: batches } = useLiveQuery(() => repo.list('batches'), [repo])
  const products = useMemo(
    () => (rawProducts || []).filter((p) => !p.archived).map((p) => ({ ...p, quantity: summarise(p, batches || []).sellable })),
    [rawProducts, batches],
  )
  const { data: customers } = useLiveQuery(() => repo.list('customers'), [repo])

  usePageHeader({ title: 'New Sale', subtitle: 'Point of sale' }, [])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = products || []
    if (!q) return list
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q) ||
        (p.barcode || '').includes(q),
    )
  }, [products, query])

  const inCart = useMemo(() => new Map(cart.map((l) => [l.productId, l])), [cart])
  const subtotal = cart.reduce((s, l) => s + l.price * l.qty, 0)
  const requiresCustomer = payment === 'credit'
  const hasRx = cart.some((l) => l.rx)

  function addToCart(p) {
    if (p.quantity <= 0) return
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === p.id)
      if (existing) {
        if (existing.qty >= p.quantity) {
          toast.info(`Only ${p.quantity} of ${p.name} in stock`)
          return prev
        }
        return prev.map((l) => (l.productId === p.id ? { ...l, qty: l.qty + 1 } : l))
      }
      return [...prev, { productId: p.id, name: p.name, price: p.price, qty: 1, rx: p.rx, stock: p.quantity }]
    })
  }

  function setQty(productId, qty) {
    setCart((prev) =>
      prev.flatMap((l) => {
        if (l.productId !== productId) return [l]
        const clamped = Math.max(0, Math.min(qty, l.stock))
        return clamped === 0 ? [] : [{ ...l, qty: clamped }]
      }),
    )
  }

  const removeLine = (productId) => setCart((prev) => prev.filter((l) => l.productId !== productId))

  function onScan(scannedValue) {
    const q = String(scannedValue ?? query).trim()
    if (!q) return
    const hit = (products || []).find((p) => p.barcode === q || p.name.toLowerCase() === q.toLowerCase())
    if (hit) {
      addToCart(hit)
      setQuery('')
    } else {
      toast.error('No product matches that barcode')
    }
  }

  async function complete() {
    if (!cart.length) return
    if (requiresCustomer && !customerId) {
      toast.error('Select a customer for credit sales')
      return
    }
    setBusy(true)
    try {
      const customer = (customers || []).find((c) => c.id === customerId)
      const saved = await repo.recordSale({
        reference: refCode('SALE'),
        items: cart.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, price: l.price, lineTotal: l.price * l.qty })),
        subtotal,
        total: subtotal,
        payment,
        customerId: customerId || null,
        customerName: customer?.name || null,
        cashierId: user.userId,
        cashierName: user.name,
      })
      toast.success(`Sale ${saved.reference} · ${naira(saved.total)} recorded`)
      setCart([])
      setPayment('cash')
      setCustomerId('')
      setQuery('')
    } catch (err) {
      toast.error(err.message || 'Could not complete the sale')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pos-grid">
      {/* Product picker */}
      <div>
        <SearchScanBar
          value={query}
          onChange={setQuery}
          onScan={onScan}
          autoFocus
          placeholder="Search product, generic name, or scan barcode"
        />
        {results.length === 0 ? (
          <div className="mt-3">
            <EmptyState icon="search" title="No products found" hint="Try a different name or barcode." />
          </div>
        ) : (
          <div className="product-grid">
            {results.map((p) => {
              const line = inCart.get(p.id)
              return (
                <button key={p.id} type="button" className="product-tile" disabled={p.quantity <= 0} onClick={() => addToCart(p)}>
                  <div className="pname">
                    {p.name}
                    {p.rx && <span className="role-badge" style={{ marginLeft: 6 }}>Rx</span>}
                  </div>
                  <div className="pmeta">
                    <span className={`stock-dot ${stockClass(p)}`} />
                    {stockLabel(p)}
                    {line ? ` · ${line.qty} in cart` : ''}
                  </div>
                  <div className="pprice">{naira(p.price)}</div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Cart */}
      <Card>
        <SectionLabel>Current sale</SectionLabel>
        {cart.length === 0 ? (
          <div className="empty-row">Search or scan to add products.</div>
        ) : (
          cart.map((l) => (
            <div key={l.productId} className="cart-line">
              <div>
                <div className="cname">{l.name}</div>
                <div className="cmeta">{naira(l.price)} each</div>
              </div>
              <div className="row" style={{ gap: 12 }}>
                <span className="qty-stepper">
                  <button type="button" onClick={() => setQty(l.productId, l.qty - 1)} aria-label="Decrease quantity">−</button>
                  <span className="n">{l.qty}</span>
                  <button type="button" onClick={() => setQty(l.productId, l.qty + 1)} aria-label="Increase quantity" disabled={l.qty >= l.stock}>+</button>
                </span>
                <strong style={{ minWidth: 64, textAlign: 'right' }}>{naira(l.price * l.qty)}</strong>
                <Button variant="quiet" size="sm" icon="x" aria-label={`Remove ${l.name}`} onClick={() => removeLine(l.productId)} />
              </div>
            </div>
          ))
        )}

        <div className="cart-total-row"><span>Subtotal</span><span>{naira(subtotal)}</span></div>
        <div className="cart-total-row"><span>VAT (included)</span><span>—</span></div>
        <div className="cart-total-row grand"><span>Total</span><span>{naira(subtotal)}</span></div>

        <SectionLabel style={{ marginTop: 16 }}>Payment</SectionLabel>
        <PayToggle
          value={payment}
          onChange={setPayment}
          options={[
            { value: 'cash', label: 'Cash' },
            { value: 'transfer', label: 'Transfer' },
            { value: 'credit', label: 'Credit', disabled: !customers?.length, disabledHint: 'No customers on file' },
          ]}
        />
        {requiresCustomer && (
          <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="mt-2" aria-label="Customer">
            <option value="">Select customer…</option>
            {(customers || []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.standing === 'overdue' ? ' (overdue)' : ''}
              </option>
            ))}
          </Select>
        )}
        {hasRx && (
          <div className="mt-2 text-muted" style={{ fontSize: 12.5 }}>
            <span className="stock-dot low" />
            Contains prescription (Rx) items — verify prescription before dispensing.
          </div>
        )}

        <Button variant="primary" block className="mt-3" disabled={!cart.length || busy} onClick={complete}>
          {busy ? 'Recording…' : `Complete sale · ${naira(subtotal)}`}
        </Button>
      </Card>
    </div>
  )
}
