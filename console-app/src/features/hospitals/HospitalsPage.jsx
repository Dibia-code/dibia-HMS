import { useMemo, useState } from 'react'
import { useRepo } from '@/data/RepositoryContext'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import { usePageHeader, useToast, SectionLabel, DataTable, Pill, Button, Card } from '@/components'
import { number } from '@/lib/format'
import { TIERS, normalisePlan, usageLevel } from '@/lib/plans'
import { hospitalStatusPill } from '@/lib/status'

// Hospitals — the tenant registry: a pending-approval queue (Approve / Reject)
// and all registered hospitals (Suspend / Reactivate). Actions write through the
// repository, so these tables and the overview stats update live.
const DEMO_MODULES = ['Reception', 'Queue', 'Cashier', 'Pharmacy', 'Inventory', 'Reports'].map((name) => ({ code: name.toLowerCase(), name }))
export default function HospitalsPage() {
  const repo = useRepo()
  const toast = useToast()
  usePageHeader({ title: 'Hospitals', subtitle: 'Every hospital registered on Dibia' }, [])

  const { data: hospitals } = useLiveQuery(() => repo.list('hospitals'), [repo])
  const list = hospitals || []
  const moduleCatalog = list.find((hospital) => hospital.moduleCatalog?.length)?.moduleCatalog || DEMO_MODULES
  const [messageHospital, setMessageHospital] = useState('')
  const [messageText, setMessageText] = useState('')
  const [expandedHospitals, setExpandedHospitals] = useState(() => new Set())

  function toggleHospitalExpanded(id) {
    setExpandedHospitals((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function changeTier(p, tier) {
    await repo.update('hospitals', p.id, { plan: tier })
    toast.success(`${p.name} moved to ${tier}`)
  }
  async function toggleModule(hospital, module) {
    const current = Array.isArray(hospital.modules) ? hospital.modules : []
    const modules = current.includes(module.code) ? current.filter((item) => item !== module.code) : [...current, module.code]
    await repo.update('hospitals', hospital.id, { modules })
    toast.success(`${module.name} ${modules.includes(module.code) ? 'enabled for' : 'disabled for'} ${hospital.name}`)
  }
  async function toggleAllModules(hospital) {
    const allGranted = moduleCatalog.length > 0 && moduleCatalog.every((module) => hospital.modules?.includes(module.code))
    await repo.update('hospitals', hospital.id, { modules: allGranted ? [] : moduleCatalog.map((module) => module.code) })
    toast.success(allGranted ? `All modules locked for ${hospital.name}` : `Pro access enabled for ${hospital.name}`)
  }
  async function sendMessage(event) {
    event.preventDefault()
    const hospital = list.find((item) => item.id === messageHospital)
    const body = messageText.trim()
    if (!hospital || !body) return
    await repo.create('messages', { hospitalId: hospital.id, hospitalName: hospital.name, body, sentAt: new Date().toISOString(), direction: 'outgoing' })
    setMessageText('')
    toast.success(`Message sent to ${hospital.name}`)
  }

  const pending = useMemo(
    () => list.filter((p) => p.status === 'pending')
      .sort((a, b) => new Date(b.registeredAt) - new Date(a.registeredAt)),
    [list],
  )
  const registered = useMemo(
    () => list.filter((p) => p.status !== 'pending' && p.status !== 'rejected')
      .sort((a, b) => a.name.localeCompare(b.name)),
    [list],
  )

  async function approve(p) {
    await repo.update('hospitals', p.id, { status: 'active' })
    toast.success(`${p.name} approved and activated`)
  }
  async function reject(p) {
    await repo.update('hospitals', p.id, { status: 'rejected', rejectedAt: new Date().toISOString() })
    toast.info(`${p.name} registration rejected. The record is kept.`)
  }
  async function toggleSuspend(p) {
    if (p.status === 'suspended') {
      await repo.update('hospitals', p.id, { status: 'active' })
      toast.success('Hospital reactivated')
    } else {
      await repo.update('hospitals', p.id, { status: 'suspended' })
      toast.info('Hospital suspended')
    }
  }

  return (
    <>
      <SectionLabel>Pending approval ({number(pending.length)})</SectionLabel>
      <div className="mb-3">
        <DataTable
          columns={[
            { key: 'name', header: 'Hospital', render: (p) => <span className="tenant-name">{p.name}</span> },
            { key: 'location', header: 'Location' },
            { key: 'plan', header: 'Requested plan' },
            {
              header: 'Actions',
              render: (p) => (
                <div className="action-btns">
                  <Button variant="primary" onClick={() => approve(p)}>Approve</Button>
                  <Button variant="danger" onClick={() => reject(p)}>Reject</Button>
                </div>
              ),
            },
          ]}
          rows={pending}
          getRowKey={(p) => p.id}
          empty="No registrations awaiting approval"
        />
      </div>

      <SectionLabel>All registered hospitals ({number(registered.length)})</SectionLabel>
      <div className="hospital-accordion">
        {registered.length === 0 ? <div className="empty-row">No hospitals registered yet</div> : registered.map((p) => {
          const expanded = expandedHospitals.has(p.id)
          const usage = usageLevel(p)
          const status = hospitalStatusPill(p.status)
          const allGranted = moduleCatalog.length > 0 && moduleCatalog.every((module) => p.modules?.includes(module.code))
          return (
            <section className="hospital-accordion-item" key={p.id}>
              <div className="hospital-accordion-heading">
                <button
                  type="button"
                  className="hospital-expand-toggle"
                  aria-label={`${expanded ? 'Collapse' : 'Expand'} ${p.name}`}
                  aria-expanded={expanded}
                  onClick={() => toggleHospitalExpanded(p.id)}
                >{expanded ? '⌃' : '⌄'}</button>
                <div className="hospital-accordion-name">
                  <div className="tenant-name">{p.name}</div>
                  {expanded && <div className="tenant-sub">{p.location}</div>}
                </div>
              </div>
              {expanded && (
                <div className="hospital-accordion-details">
                  <div className="hospital-detail"><span>Branches</span><strong>{p.branches ?? 0}</strong></div>
                  <div className="hospital-detail"><span>Staff</span><strong>{p.staff ?? 0}</strong></div>
                  <div className="hospital-detail"><span>Usage-days this month</span><strong>{number(usage.days)}{usage.tier.max === Infinity ? '' : ` of ${number(usage.tier.max)}`}</strong>{usage.level !== 'ok' && <Pill tone={usage.level === 'crit' ? 'failed' : 'pending'}>{usage.level === 'crit' ? 'Over ceiling' : 'Near ceiling'}</Pill>}</div>
                  <div className="hospital-detail"><span>Status</span><Pill tone={status.tone}>{status.label}</Pill></div>
                  <div className="hospital-detail"><span>Tier</span><select className="tier-select" aria-label={`Tier for ${p.name}`} value={normalisePlan(p.plan)} onChange={(e) => changeTier(p, e.target.value)}>{TIERS.map((t) => <option key={t.key} value={t.key}>{t.key}</option>)}</select></div>
                  <div className="hospital-detail hospital-detail-action"><span>Account action</span><Button variant="secondary" onClick={() => toggleSuspend(p)}>{p.status === 'suspended' ? 'Reactivate' : 'Suspend'}</Button></div>
                  <div className="hospital-modules-section">
                    <div className="hospital-modules-heading"><strong>Enabled modules</strong><Button variant="secondary" onClick={() => toggleAllModules(p)}>{allGranted ? 'Lock all' : 'Grant Pro access'}</Button></div>
                    <div className="hospital-module-checks">{moduleCatalog.map((module) => <label key={module.code}><input type="checkbox" checked={(Array.isArray(p.modules) ? p.modules : []).includes(module.code)} onChange={() => toggleModule(p, module)} />{module.name}</label>)}</div>
                  </div>
                </div>
              )}
            </section>
          )
        })}
      </div>
      <Card className="mt-3">
        <SectionLabel>Send a message to a facility</SectionLabel>
        <form onSubmit={sendMessage} className="facility-message">
          <select className="tier-select" aria-label="Choose facility" value={messageHospital} onChange={(event) => setMessageHospital(event.target.value)} required>
            <option value="">Choose a hospital</option>
            {list.filter((p) => p.status !== 'rejected').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <textarea aria-label="Message" value={messageText} onChange={(event) => setMessageText(event.target.value)} placeholder="Write a message for the facility…" required rows={3} />
          <Button type="submit" variant="primary" disabled={!messageHospital || !messageText.trim()}>Send message</Button>
        </form>
      </Card>
    </>
  )
}
