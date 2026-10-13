import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { PERM } from '@/auth/permissions'
import { useRepo } from '@/data/RepositoryContext'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import { useToast, usePageHeader, Card, CardHead, SectionLabel, Button, Switch, Field, Input, Select, Icon } from '@/components'
import { naira, formatDateTime } from '@/lib/format'
import BillingSettings from './BillingSettings'
import HospitalSettings from './HospitalSettings'
import { connectScanner, connectUsb, disconnectHardware, getHardwareConfig, openCashDrawer, printBarcodeLabels, printReceiptToUsb, restoreHardwareConnections, setLabelProtocol } from '@/lib/hardware'

const TABS = [
  { key: 'billing', label: 'Billing' },
  { key: 'hospital', label: 'Hospital' },
  { key: 'hardware', label: 'Hardware' },
  { key: 'barcode', label: 'Barcode' },
  { key: 'receipt', label: 'Receipt & Tax' },
  { key: 'catpay', label: 'Categories & Payments' },
]

const DEVICES = [
  { key: 'printer', name: 'Receipt printer', icon: 'printer', sub: 'Thermal 80mm · USB' },
  { key: 'scanner', name: 'Barcode scanner', icon: 'scan', sub: 'USB HID · plug and play' },
  { key: 'drawer', name: 'Cash drawer', icon: 'expenses', sub: 'Opens via printer kick-out' },
  { key: 'label', name: 'Label printer', icon: 'tag', sub: 'For shelf & product labels' },
]

// The sample sale the receipt preview is drawn from — enough lines to show a
// realistic total, VAT and change.
const SAMPLE_ITEMS = [
  { name: 'Paracetamol 500mg', qty: 2, price: 80 },
  { name: 'Vitamin C 1000mg', qty: 1, price: 450 },
  { name: 'ORS Sachets', qty: 3, price: 70 },
]
const METHODS = [
  { key: 'cash', label: 'Cash' },
  { key: 'transfer', label: 'Transfer' },
  { key: 'credit', label: 'Credit' },
]
const METHOD_LABEL = { cash: 'Cash', transfer: 'Bank transfer', credit: 'Credit (on account)' }

// Settings — device pairing, barcode labels, receipt/tax options, and category
// & payment configuration (§4).
//
// Access split (Task 5): ANY staff member with SETTINGS_DEVICES may open this
// page to pair a printer/scanner and print receipts. Editing the receipt
// TEMPLATE and business/payment configuration needs SETTINGS_MANAGE — only the
// CEO/Owner. Hardware + Barcode are device-local and open to everyone; the
// Receipt and Payments editors are gated to `canManage`, everyone else sees
// them read-only (but can still print).
export default function SettingsPage() {
  const repo = useRepo()
  const toast = useToast()
  const { user, can } = useAuth()
  const canManage = can(PERM.SETTINGS_MANAGE)

  const [tab, setTab] = useState('hardware')

  // Each flag shows/hides that block on the printed receipt — the toggle model
  // carried over from the original design, extended with the new fields.
  const [receipt, setReceipt] = useState({
    logo: true,       // hospital name at the top
    address: true,    // branch address line
    contact: true,    // phone + merchant email
    meta: true,       // receipt no., payment date & time, cashier
    method: true,     // payment method line (auto-detected at checkout)
    vat: true,        // VAT breakdown line
    tendered: true,   // amount tendered + change (cash sales)
    autoPrint: false, // skip the print prompt after each sale
  })
  const [footer, setFooter] = useState('Thank you for your patronage. Goods sold in good condition are not returnable.')
  const [vatRate, setVatRate] = useState('7.5')
  const [pay, setPay] = useState({ cash: true, transfer: true, credit: true })
  const [sampleMethod, setSampleMethod] = useState('cash')
  const [hardware, setHardware] = useState(() => ({ ...getHardwareConfig(), connected: {} }))
  const [hardwareBusy, setHardwareBusy] = useState('')
  const [labelProtocol, setLabelProtocolState] = useState(() => getHardwareConfig().labelProtocol || 'TSPL')

  const { data: products } = useLiveQuery(() => repo.list('products'), [repo])
  const { data: hospitals } = useLiveQuery(() => repo.list('hospitals'), [repo])
  const { data: branches } = useLiveQuery(() => repo.list('branches'), [repo])

  const categories = useMemo(
    () => [...new Set((products || []).map((p) => p.category).filter(Boolean))].sort(),
    [products],
  )
  const hospital = useMemo(() => (hospitals || []).find((p) => p.id === user?.hospitalId) || null, [hospitals, user])
  const mainBranch = useMemo(() => (branches || []).find((b) => b.isMain) || (branches || [])[0] || null, [branches])

  // Business details on the receipt header (name, address, phone, merchant
  // email). Prefilled from the hospital record once it loads; edits live in
  // component state for this session, matching the rest of the page.
  const [biz, setBiz] = useState(null)
  useEffect(() => {
    if (biz || !hospital) return
    setBiz({
      name: hospital.name || user?.hospitalName || '',
      address: mainBranch?.address || '',
      phone: hospital.phone || '',
      email: hospital.email || '',
    })
  }, [hospital, mainBranch, biz, user])
  const bizView = biz || {
    name: hospital?.name || user?.hospitalName || 'Your Hospital',
    address: mainBranch?.address || '',
    phone: hospital?.phone || '',
    email: hospital?.email || '',
  }
  const setBizField = (k, v) => setBiz({ ...bizView, [k]: v })

  usePageHeader({ title: 'Settings', subtitle: 'Devices, receipts & configuration' }, [])
  useEffect(() => { restoreHardwareConnections().then(setHardware).catch(() => {}) }, [])

  const runHardwareAction = async (key, action, success) => {
    setHardwareBusy(key)
    try {
      await action()
      setHardware(await restoreHardwareConnections())
      if (success) toast.success(success)
    } catch (error) { toast.error(error?.message || 'Could not use the selected device.') }
    finally { setHardwareBusy('') }
  }
  const connectDevice = (key) => runHardwareAction(key, () => key === 'scanner' ? connectScanner() : connectUsb(key), `${DEVICES.find((device) => device.key === key)?.name} connected`)
  const disconnectDevice = (key) => runHardwareAction(key, () => disconnectHardware(key), `${DEVICES.find((device) => device.key === key)?.name} disconnected`)

  // ---- receipt preview maths ----
  const rate = Number(vatRate) || 0
  const subtotal = SAMPLE_ITEMS.reduce((s, it) => s + it.qty * it.price, 0)
  const vatAmt = receipt.vat ? (subtotal * rate) / 100 : 0
  const total = subtotal + vatAmt
  const tendered = Math.max(1000, Math.ceil(total / 500) * 500)
  const change = tendered - total
  const activeMethod = pay[sampleMethod] ? sampleMethod : (METHODS.find((m) => pay[m.key])?.key || 'cash')
  const now = new Date()

  const receiptText = () => [bizView.name || 'Your Hospital', bizView.address, bizView.phone, bizView.email, '', 'Receipt: SALE-7F3K9', `Date: ${formatDateTime(now)}`, `Served by: ${user?.name || 'Cashier'}`, '', ...SAMPLE_ITEMS.map((it) => `${it.name} x${it.qty}  ${naira(it.qty * it.price)}`), '', `Subtotal: ${naira(subtotal)}`, ...(receipt.vat ? [`VAT (${rate}%): ${naira(vatAmt)}`] : []), `TOTAL: ${naira(total)}`, `Payment: ${METHOD_LABEL[activeMethod]}`, ...(activeMethod === 'cash' && receipt.tendered ? [`Tendered: ${naira(tendered)}`, `Change: ${naira(change)}`] : []), '', footer].filter((line) => line !== null && line !== undefined).join('\n')
  const printTest = () => {
    if (hardware.connected?.printer || getHardwareConfig().printer) {
      runHardwareAction('printer', () => printReceiptToUsb(receiptText()), 'Test receipt sent to receipt printer')
      return
    }
    setTab('receipt')
    window.setTimeout(() => window.print(), 100)
  }

  return (
    <>
      <div className="filter-chips mb-3">
        {TABS.filter((t) => (t.key !== 'billing' && t.key !== 'hospital') || canManage).map((t) => (
          <button key={t.key} type="button" className={`filter-chip ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'billing' && <BillingSettings />}
      {tab === 'hospital' && <HospitalSettings />}

      {tab === 'hardware' && (
        <Card>
          <CardHead title="Connect hardware" />
          <div className="text-muted" style={{ marginBottom: 14 }}>Connect devices attached to this computer. Choose Connect, select the device in the browser prompt, and approve access.</div>
          <div className="hw-grid">
            {DEVICES.map((d) => {
              const connected = d.key === 'drawer' ? !!hardware.connected?.printer : !!hardware.connected?.[d.key]
              const detail = d.key === 'drawer' ? 'Cash drawers normally connect to the receipt printer. Connect that printer, then send the drawer command.' : d.key === 'scanner' ? 'Connect a supported USB HID scanner. Keyboard-wedge scanners also work in focused scan fields.' : d.key === 'printer' ? 'Select a USB receipt printer. The printer must expose a browser-accessible print interface.' : 'Select a compatible USB label printer. Supported command sets: TSPL, ZPL, and ESC/POS.'
              return (
                <div key={d.key} className="hw-card">
                  <div className="hw-top">
                    <span className="hw-icon"><Icon name={d.icon} size={20} /></span>
                    <span className="hw-name">{d.name}</span>
                  </div>
                  <div className="hw-sub">{detail}</div>
                  <div className="row-between">
                    <span className="row-status" style={{ color: connected ? 'var(--confirmed)' : 'var(--muted-3)' }}>
                      <span className="dot" style={{ background: connected ? 'var(--confirmed)' : 'var(--muted-4)' }} />
                      {connected ? `Connected${hardware[d.key]?.name ? ` · ${hardware[d.key].name}` : ''}` : 'Not connected'}
                    </span>
                    {d.key === 'drawer'
                      ? <Button size="sm" variant="ghost" disabled={!connected || !!hardwareBusy} onClick={() => runHardwareAction('drawer', openCashDrawer, 'Cash drawer command sent')}>Open drawer</Button>
                      : <Button size="sm" variant={connected ? 'ghost' : 'primary'} disabled={!!hardwareBusy} onClick={() => connected ? disconnectDevice(d.key) : connectDevice(d.key)}>{hardwareBusy === d.key ? 'Working…' : connected ? 'Disconnect' : 'Connect'}</Button>}
                  </div>
                  {d.key === 'printer' && connected && <Button className="mt-2" size="sm" variant="ghost" icon="printer" disabled={!!hardwareBusy} onClick={printTest}>Print test</Button>}
                  {d.key === 'label' && <Field className="mt-2" label="Printer command language" htmlFor="label-protocol"><Select id="label-protocol" value={labelProtocol} onChange={(e) => { setLabelProtocolState(e.target.value); setLabelProtocol(e.target.value) }}><option value="TSPL">TSPL</option><option value="ZPL">ZPL</option><option value="ESC/POS">ESC/POS</option></Select></Field>}
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {tab === 'barcode' && (
        <Card className="field-wide">
          <SectionLabel>Barcode labels</SectionLabel>
          <div style={{ fontSize: 12.5, color: 'var(--muted-3)', marginBottom: 14 }}>Print machine-readable labels for inventory products with a barcode. Connect a compatible label printer under Hardware first.</div>
          <div className="text-muted">{(products || []).filter((product) => product.barcode).length} products with barcodes available.</div>
          <Button className="mt-2" variant="primary" icon="printer" disabled={!!hardwareBusy} onClick={() => runHardwareAction('label', () => printBarcodeLabels((products || []).filter((product) => product.barcode), labelProtocol), 'Barcode labels sent to label printer')}>Print product labels</Button>
        </Card>
      )}

      {tab === 'receipt' && (
        <div className="sub-grid-2">
          {canManage ? (
            <Card>
              <SectionLabel>Receipt template</SectionLabel>
              <div className="lock-note ok">
                <Icon name="edit" size={15} />
                 You&apos;re the business owner — changes here apply to every receipt printed across your branches.
              </div>

              <div className="settings-subhead">Business details</div>
              <Field label="Business name" htmlFor="biz-name">
                <Input id="biz-name" value={bizView.name} onChange={(e) => setBizField('name', e.target.value)} />
              </Field>
              <Field label="Address" htmlFor="biz-addr">
                <Input id="biz-addr" value={bizView.address} onChange={(e) => setBizField('address', e.target.value)} placeholder="Branch address" />
              </Field>
              <Field label="Phone" htmlFor="biz-phone">
                <Input id="biz-phone" value={bizView.phone} onChange={(e) => setBizField('phone', e.target.value)} placeholder="+234…" />
              </Field>
              <Field label="Merchant email" htmlFor="biz-email" hint="Printed on the receipt so customers can reach you.">
                <Input id="biz-email" type="email" value={bizView.email} onChange={(e) => setBizField('email', e.target.value)} placeholder="hello@yourhospital.ng" />
              </Field>

              <div className="settings-subhead">Show on receipt</div>
              <div className="toggle-row">
                <div><div className="tname">Hospital name</div><div className="tsub">Prints your hospital name at the top</div></div>
                <Switch checked={receipt.logo} onChange={(v) => setReceipt((r) => ({ ...r, logo: v }))} />
              </div>
              <div className="toggle-row">
                <div><div className="tname">Address</div><div className="tsub">Branch address line under the name</div></div>
                <Switch checked={receipt.address} onChange={(v) => setReceipt((r) => ({ ...r, address: v }))} />
              </div>
              <div className="toggle-row">
                <div><div className="tname">Phone & email</div><div className="tsub">Your contact details for the customer</div></div>
                <Switch checked={receipt.contact} onChange={(v) => setReceipt((r) => ({ ...r, contact: v }))} />
              </div>
              <div className="toggle-row">
                <div><div className="tname">Receipt no., date &amp; time, cashier</div><div className="tsub">Records exactly when payment was taken and by whom</div></div>
                <Switch checked={receipt.meta} onChange={(v) => setReceipt((r) => ({ ...r, meta: v }))} />
              </div>
              <div className="toggle-row">
                <div><div className="tname">Payment method</div><div className="tsub">Cash, transfer or credit — detected from the sale</div></div>
                <Switch checked={receipt.method} onChange={(v) => setReceipt((r) => ({ ...r, method: v }))} />
              </div>
              <div className="toggle-row">
                <div><div className="tname">Amount tendered &amp; change</div><div className="tsub">Shown on cash sales</div></div>
                <Switch checked={receipt.tendered} onChange={(v) => setReceipt((r) => ({ ...r, tendered: v }))} />
              </div>
              <div className="toggle-row">
                <div><div className="tname">VAT breakdown</div><div className="tsub">Itemises tax on the receipt</div></div>
                <Switch checked={receipt.vat} onChange={(v) => setReceipt((r) => ({ ...r, vat: v }))} />
              </div>
              <div className="toggle-row">
                <div><div className="tname">Auto-print after each sale</div><div className="tsub">Skips the print prompt at checkout</div></div>
                <Switch checked={receipt.autoPrint} onChange={(v) => setReceipt((r) => ({ ...r, autoPrint: v }))} />
              </div>

              <Field className="mt-2" label="VAT rate (%)" htmlFor="vat" hint="Nigeria standard rate is 7.5%.">
                <Input id="vat" type="number" min="0" step="0.5" value={vatRate} onChange={(e) => setVatRate(e.target.value)} style={{ maxWidth: 140 }} />
              </Field>
              <Field label="Footer message" htmlFor="rc-footer">
                <Input id="rc-footer" value={footer} onChange={(e) => setFooter(e.target.value)} placeholder="Thank you for your patronage" />
              </Field>
              <Button className="mt-2" variant="primary" onClick={() => toast.success('Receipt template saved')}>Save template</Button>
            </Card>
          ) : (
            <Card>
              <SectionLabel>Receipt template</SectionLabel>
              <div className="lock-note">
                <Icon name="alert" size={15} />
                Only the business owner (CEO) can edit the receipt template. You can still print receipts and pair your devices.
              </div>
              <Button className="mt-2" variant="ghost" icon="printer" onClick={printTest}>Print test receipt</Button>
            </Card>
          )}

          <Card>
            <SectionLabel>Receipt preview</SectionLabel>
            <div className="pay-preview-row">
              <span className="r-sub">Preview payment as:</span>
              <div className="filter-chips">
                {METHODS.filter((m) => pay[m.key]).map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    className={`filter-chip ${activeMethod === m.key ? 'active' : ''}`}
                    onClick={() => setSampleMethod(m.key)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="receipt-preview" id="receipt-print">
              {receipt.logo && <div className="rc" style={{ fontWeight: 700 }}>{bizView.name || 'Your Hospital'}</div>}
              {receipt.address && bizView.address && <div className="rc">{bizView.address}</div>}
              {receipt.contact && (bizView.phone || bizView.email) && (
                <div className="rc">{[bizView.phone, bizView.email].filter(Boolean).join(' · ')}</div>
              )}
              <hr />
              {receipt.meta && (
                <>
                  <div className="rl"><span>Receipt</span><span>SALE-7F3K9</span></div>
                  <div className="rl"><span>Date</span><span>{formatDateTime(now)}</span></div>
                  <div className="rl"><span>Served by</span><span>{user?.name || 'Cashier'}</span></div>
                  <hr />
                </>
              )}
              {SAMPLE_ITEMS.map((it) => (
                <div key={it.name}>
                  <div className="ri-name">{it.name}</div>
                  <div className="rl"><span>{it.qty} × {naira(it.price)}</span><span>{naira(it.qty * it.price)}</span></div>
                </div>
              ))}
              <hr />
              <div className="rl"><span>Subtotal</span><span>{naira(subtotal)}</span></div>
              {receipt.vat && <div className="rl"><span>VAT ({rate}%)</span><span>{naira(vatAmt)}</span></div>}
              <div className="rl" style={{ fontWeight: 700 }}><span>Total</span><span>{naira(total)}</span></div>
              {receipt.method && (
                <>
                  <hr />
                  <div className="rl"><span>Payment</span><span>{METHOD_LABEL[activeMethod]}</span></div>
                  {activeMethod === 'cash' && receipt.tendered && (
                    <>
                      <div className="rl"><span>Tendered</span><span>{naira(tendered)}</span></div>
                      <div className="rl"><span>Change</span><span>{naira(change)}</span></div>
                    </>
                  )}
                  {activeMethod === 'transfer' && <div className="rl"><span>Txn ref</span><span>TRF-88213</span></div>}
                  {activeMethod === 'credit' && (
                    <>
                      <div className="rl"><span>Customer</span><span>Grace Okafor</span></div>
                      <div className="rl"><span>Balance</span><span>{naira(19381)}</span></div>
                    </>
                  )}
                </>
              )}
              <hr />
              {footer && <div className="rc">{footer}</div>}
              <div className="rc" style={{ marginTop: 4, opacity: 0.7 }}>Powered by Dibia</div>
            </div>

            <Button className="mt-2" variant="ghost" icon="printer" onClick={printTest}>Print test receipt</Button>
          </Card>
        </div>
      )}

      {tab === 'catpay' && (
        <div className="sub-grid-2">
          <Card>
            <SectionLabel>Product categories</SectionLabel>
            <div style={{ fontSize: 12.5, color: 'var(--muted-3)', marginBottom: 14 }}>
              Categories in use across your inventory. Add new ones when creating a product.
            </div>
            <div className="cat-pills">
              {categories.length === 0 ? (
                <span className="text-muted">No categories yet.</span>
              ) : (
                categories.map((c) => <span key={c} className="cat-badge">{c}</span>)
              )}
            </div>
          </Card>

          <Card>
            <SectionLabel>Accepted payment methods</SectionLabel>
            {!canManage && (
              <div className="lock-note">
                <Icon name="alert" size={15} />
                Only the business owner can change accepted payment methods.
              </div>
            )}
            <div className="toggle-row">
              <div><div className="tname">Cash</div><div className="tsub">Physical cash at the till</div></div>
              <Switch checked={pay.cash} disabled={!canManage} onChange={(v) => setPay((p) => ({ ...p, cash: v }))} />
            </div>
            <div className="toggle-row">
              <div><div className="tname">Bank transfer</div><div className="tsub">Instant transfer / POS</div></div>
              <Switch checked={pay.transfer} disabled={!canManage} onChange={(v) => setPay((p) => ({ ...p, transfer: v }))} />
            </div>
            <div className="toggle-row">
              <div><div className="tname">Credit</div><div className="tsub">Registered credit customers only</div></div>
              <Switch checked={pay.credit} disabled={!canManage} onChange={(v) => setPay((p) => ({ ...p, credit: v }))} />
            </div>
            {canManage && (
              <Button className="mt-2" variant="primary" onClick={() => toast.success('Payment methods saved')}>Save</Button>
            )}
          </Card>
        </div>
      )}
    </>
  )
}
