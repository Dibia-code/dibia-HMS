import { useEffect, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { PERM } from '@/auth/permissions'
import { useRepo, useSyncEngine } from '@/data/RepositoryContext'
import { useHospital } from '@/hooks/useHospital'
import { useToast, Card, CardHead, Button, Field, Input, Switch } from '@/components'

const METHODS = [['cash', 'Cash'], ['pos', 'POS / card'], ['transfer', 'Bank transfer'], ['hmo', 'HMO / insurance']]

export default function HospitalSettings() {
  const { user, can } = useAuth()
  const repo = useRepo()
  const sync = useSyncEngine()
  const toast = useToast()
  const { hospital, config } = useHospital()
  const canManage = can(PERM.SETTINGS_MANAGE)
  const [f, setF] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!hospital || f) return
    setF({
      footer: config.receipt.footer,
      showAddress: config.receipt.showAddress,
      showPhone: config.receipt.showPhone,
      paymentMethods: config.paymentMethods,
      pharmacyCollectPayments: config.pharmacyCollectPayments,
      windows: config.expiryWindows.join(', '),
      notifyLowStock: config.notifyLowStock,
      syncIntervalSec: String(config.offline.syncIntervalSec),
      requireDeviceApproval: !!hospital.requireDeviceApproval,
    })
  }, [hospital, config, f])

  useEffect(() => {
    setF((current) => current ? { ...current, pharmacyCollectPayments: config.pharmacyCollectPayments } : current)
  }, [config.pharmacyCollectPayments])

  if (!f) return null
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))

  async function save() {
    const windows = f.windows.split(',').map((x) => Number(x.trim())).filter((x) => x > 0)
    if (!windows.length) return toast.error('Enter at least one expiry window in days')
    if (!Object.values(f.paymentMethods).some(Boolean)) return toast.error('Keep at least one payment method on')
    setBusy(true)
    try {
      let savedSettings = { pharmacyCollectPayments: f.pharmacyCollectPayments }
      if (sync.remote?.configured) {
        const response = await sync.remote.request(`${sync.remote.baseUrl}/settings/hospital`, {
          method: 'PATCH', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(savedSettings),
        })
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(result.message || 'Could not save pharmacy payment settings')
        savedSettings = result.settings || savedSettings
      }
      await repo.update('hospitals', user.hospitalId, {
        receipt: { footer: f.footer, showAddress: f.showAddress, showPhone: f.showPhone },
        paymentMethods: f.paymentMethods,
        pharmacyCollectPayments: f.pharmacyCollectPayments,
        expiryWindows: windows.sort((a, b) => a - b),
        notifyLowStock: f.notifyLowStock,
        offline: { syncIntervalSec: Math.max(5, Number(f.syncIntervalSec) || 15) },
        requireDeviceApproval: f.requireDeviceApproval,
      })
      window.dispatchEvent(new CustomEvent('dibia:hospital-settings-updated', { detail: savedSettings }))
      localStorage.setItem('dibia.syncIntervalSec', String(Math.max(5, Number(f.syncIntervalSec) || 15)))
      toast.success('Hospital settings saved')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack-gap">
      {!canManage && <div className="lock-note">Only the hospital admin can change these settings.</div>}
      <Card>
        <CardHead title="Receipts" />
        <div className="stack-gap">
          <Field label="Message at the bottom of every receipt" htmlFor="fs-foot"><Input id="fs-foot" disabled={!canManage} value={f.footer} onChange={(e) => set('footer', e.target.value)} /></Field>
          <div className="toggle-row"><div className="tname">Show hospital address</div><Switch checked={f.showAddress} disabled={!canManage} onChange={(v) => set('showAddress', v)} /></div>
          <div className="toggle-row"><div className="tname">Show hospital phone number</div><Switch checked={f.showPhone} disabled={!canManage} onChange={(v) => set('showPhone', v)} /></div>
        </div>
      </Card>
      <Card>
        <CardHead title="Payment methods the cashier can use" />
        {METHODS.map(([k, label]) => (
          <div key={k} className="toggle-row"><div className="tname">{label}</div><Switch checked={f.paymentMethods[k]} disabled={!canManage} onChange={(v) => set('paymentMethods', { ...f.paymentMethods, [k]: v })} /></div>
        ))}
      </Card>
      <Card>
        <CardHead title="Pharmacy payment collection" />
        <div className="toggle-row">
          <div><div className="tname">Allow pharmacy staff to collect payment for drug sales</div><div className="tsub">Turn this off to keep pharmacy work to inventory and dispensing. The hospital Cashier can still collect patient bills.</div></div>
          <Switch checked={f.pharmacyCollectPayments} disabled={!canManage} onChange={(value) => set('pharmacyCollectPayments', value)} />
        </div>
      </Card>
      <Card>
        <CardHead title="Pharmacy alerts" />
        <Field label="Expiry warning windows, in days" htmlFor="fs-win" hint="For example 30, 60, 90, 180, 365. Stock inside a window is flagged.">
          <Input id="fs-win" disabled={!canManage} value={f.windows} onChange={(e) => set('windows', e.target.value)} />
        </Field>
        <div className="toggle-row"><div><div className="tname">Tell the admin when a drug runs low</div><div className="tsub">Low-stock drugs show in an alert on the admin dashboard.</div></div><Switch checked={f.notifyLowStock} disabled={!canManage} onChange={(v) => set('notifyLowStock', v)} /></div>
      </Card>
      <Card>
        <CardHead title="Offline and devices" />
        <Field label="How often to sync saved changes, in seconds" htmlFor="fs-sync" hint="Applies to devices when they next reload. Minimum 5.">
          <Input id="fs-sync" type="number" min="5" disabled={!canManage} value={f.syncIntervalSec} onChange={(e) => set('syncIntervalSec', e.target.value)} />
        </Field>
        <div className="toggle-row"><div><div className="tname">Require approval for devices</div><div className="tsub">Only devices approved on the Devices page can sign in.</div></div><Switch checked={f.requireDeviceApproval} disabled={!canManage} onChange={(v) => set('requireDeviceApproval', v)} /></div>
      </Card>
      {canManage && <div><Button variant="primary" className={busy ? 'loading' : undefined} disabled={busy} onClick={save}>{busy ? '' : 'Save hospital settings'}</Button></div>}
    </div>
  )
}
