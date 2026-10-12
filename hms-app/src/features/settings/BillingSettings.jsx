import { useEffect, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { PERM } from '@/auth/permissions'
import { useRepo } from '@/data/RepositoryContext'
import { useHospital } from '@/hooks/useHospital'
import { useToast, Card, CardHead, Button, Field, Input, Select, Switch } from '@/components'
import { uuid } from '@/lib/id'

export default function BillingSettings() {
  const { user, can } = useAuth()
  const repo = useRepo()
  const toast = useToast()
  const { hospital, config } = useHospital()
  const canManage = can(PERM.SETTINGS_MANAGE)

  const [departments, setDepartments] = useState(null)
  const [levy, setLevy] = useState(null)
  const [vat, setVat] = useState(null)
  const [adm, setAdm] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!hospital || departments) return
    setDepartments((Array.isArray(config.departments) ? config.departments : []).map((d) => ({ ...d, fee: String(d.fee ?? 0) })))
    setLevy({ ...config.levy, amount: String(config.levy.amount) })
    setVat({ ...config.vat, rate: String(config.vat.rate) })
    setAdm({ fee: String(config.admission.fee), bedPerDay: String(config.admission.bedPerDay) })
  }, [hospital, config, departments])

  if (!departments || !adm) return null

  const num = (v) => {
    const n = Number(String(v).replace(/,/g, ''))
    return Number.isFinite(n) && n >= 0 ? n : 0
  }

  async function save() {
    setBusy(true)
    try {
      await repo.update('hospitals', user.hospitalId, {
        departments: departments
          .filter((d) => d.name.trim())
          .map((d) => ({ id: d.id, name: d.name.trim(), fee: num(d.fee) })),
        levy: { enabled: levy.enabled, name: levy.name.trim() || 'Hospital levy', amount: num(levy.amount), showOnBill: levy.showOnBill, appliesTo: levy.appliesTo },
        vat: { enabled: vat.enabled, rate: num(vat.rate), mode: vat.mode },
        admission: { fee: num(adm.fee), bedPerDay: num(adm.bedPerDay) },
      })
      toast.success('Billing settings saved')
    } catch (err) {
      toast.error(err.message || 'Could not save billing settings')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack-gap">
      {!canManage && <div className="lock-note">Only the hospital admin can change billing settings.</div>}

      <Card>
        <CardHead title="Consultation fees by department" />
        <div className="stack-gap">
          {departments.map((d, i) => (
            <div key={d.id} className="form-grid">
              <Field label={i === 0 ? 'Department' : undefined} htmlFor={`dn-${d.id}`}>
                <Input id={`dn-${d.id}`} disabled={!canManage} value={d.name} onChange={(e) => setDepartments(departments.map((x) => (x.id === d.id ? { ...x, name: e.target.value } : x)))} />
              </Field>
              <Field label={i === 0 ? 'Fee (naira)' : undefined} htmlFor={`df-${d.id}`}>
                <Input id={`df-${d.id}`} disabled={!canManage} inputMode="decimal" value={d.fee} onChange={(e) => setDepartments(departments.map((x) => (x.id === d.id ? { ...x, fee: e.target.value } : x)))} />
              </Field>
            </div>
          ))}
          {canManage && (
            <div>
              <Button variant="quiet" icon="plus" onClick={() => setDepartments([...departments, { id: `dept_${uuid().slice(0, 8)}`, name: '', fee: '0' }])}>
                Add department
              </Button>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHead title="Admission and bed fees" />
        <div className="form-grid">
          <Field label="Admission fee (naira, once)" htmlFor="adm-fee"><Input id="adm-fee" disabled={!canManage} inputMode="decimal" value={adm.fee} onChange={(e) => setAdm({ ...adm, fee: e.target.value })} /></Field>
          <Field label="Bed fee per day (naira)" htmlFor="adm-bed" hint="The daily levy is added for each day of stay."><Input id="adm-bed" disabled={!canManage} inputMode="decimal" value={adm.bedPerDay} onChange={(e) => setAdm({ ...adm, bedPerDay: e.target.value })} /></Field>
        </div>
      </Card>

      <Card>
        <CardHead title="Levy" />
        <div className="toggle-row">
          <div>
            <div className="tname">Charge a levy on outpatient visits</div>
            <div className="tsub">Added once per visit alongside the consultation fee.</div>
          </div>
          <Switch checked={levy.enabled} disabled={!canManage} onChange={(enabled) => setLevy({ ...levy, enabled })} />
        </div>
        {levy.enabled && (
          <>
            <div className="form-grid mt-2">
              <Field label="Levy name" htmlFor="levy-name">
                <Input id="levy-name" disabled={!canManage} value={levy.name} onChange={(e) => setLevy({ ...levy, name: e.target.value })} />
              </Field>
              <Field label="Applies to" htmlFor="levy-scope" hint="Outpatients pay it once a visit. Inpatients pay it for each day of stay.">
                <Select id="levy-scope" disabled={!canManage} value={levy.appliesTo || 'both'} onChange={(e) => setLevy({ ...levy, appliesTo: e.target.value })}>
                  <option value="both">Outpatients and inpatients</option>
                  <option value="outpatient">Outpatients only</option>
                  <option value="inpatient">Inpatients only</option>
                </Select>
              </Field>
              <Field label="Amount (naira)" htmlFor="levy-amount">
                <Input id="levy-amount" disabled={!canManage} inputMode="decimal" value={levy.amount} onChange={(e) => setLevy({ ...levy, amount: e.target.value })} />
              </Field>
            </div>
            <div className="toggle-row">
              <div>
                <div className="tname">Show the levy as its own line on bills</div>
                <div className="tsub">When off, the levy is included in the consultation fee.</div>
              </div>
              <Switch checked={levy.showOnBill} disabled={!canManage} onChange={(showOnBill) => setLevy({ ...levy, showOnBill })} />
            </div>
          </>
        )}
      </Card>

      <Card>
        <CardHead title="VAT" />
        <div className="toggle-row">
          <div>
            <div className="tname">Apply VAT to bills</div>
            <div className="tsub">Confirm the correct rate and scope for your hospital with your accountant.</div>
          </div>
          <Switch checked={vat.enabled} disabled={!canManage} onChange={(enabled) => setVat({ ...vat, enabled })} />
        </div>
        {vat.enabled && (
          <div className="form-grid mt-2">
            <Field label="VAT rate (%)" htmlFor="vat-rate">
              <Input id="vat-rate" disabled={!canManage} inputMode="decimal" value={vat.rate} onChange={(e) => setVat({ ...vat, rate: e.target.value })} />
            </Field>
            <Field label="How VAT shows on the bill" htmlFor="vat-mode">
              <Select id="vat-mode" disabled={!canManage} value={vat.mode || 'exclusive'} onChange={(e) => setVat({ ...vat, mode: e.target.value })}>
                <option value="exclusive">Added on top, as its own line</option>
                <option value="inclusive">Already inside the prices, shown as a note</option>
              </Select>
            </Field>
          </div>
        )}
      </Card>

      {canManage && (
        <div>
          <Button variant="primary" className={busy ? 'loading' : undefined} disabled={busy} onClick={save}>{busy ? '' : 'Save billing settings'}</Button>
        </div>
      )}
    </div>
  )
}
