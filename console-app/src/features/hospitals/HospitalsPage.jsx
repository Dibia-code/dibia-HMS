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
const MODULES = ['Reception', 'Queue', 'Cashier', 'Pharmacy', 'Inventory', 'Reports']
export default function HospitalsPage() {
  const repo = useRepo()
  const toast = useToast()
  usePageHeader({ title: 'Hospitals', subtitle: 'Every hospital registered on Dibia' }, [])

  const { data: hospitals } = useLiveQuery(() => repo.list('hospitals'), [repo])
  const list = hospitals || []
  const [messageHospital, setMessageHospital] = useState('')
  const [messageText, setMessageText] = useState('')

  async function changeTier(p, tier) {
    await repo.update('hospitals', p.id, { plan: tier })
    toast.success(`${p.name} moved to ${tier}`)
  }
  async function toggleModule(hospital, module) {
    const current = Array.isArray(hospital.modules) ? hospital.modules : []
    const modules = current.includes(module) ? current.filter((item) => item !== module) : [...current, module]
    await repo.update('hospitals', hospital.id, { modules })
    toast.success(`${module} ${modules.includes(module) ? 'enabled for' : 'disabled for'} ${hospital.name}`)
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
      <DataTable
        columns={[
          {
            key: 'name', header: 'Hospital',
            render: (p) => (
              <>
                <div className="tenant-name">{p.name}</div>
                <div className="tenant-sub">{p.location}</div>
              </>
            ),
          },
          { key: 'branches', header: 'Branches' },
          { key: 'staff', header: 'Staff' },
          {
            key: 'modules', header: 'Enabled modules',
            render: (p) => <div className="module-checks">{MODULES.map((module) => <label key={module}><input type="checkbox" checked={(Array.isArray(p.modules) ? p.modules : []).includes(module)} onChange={() => toggleModule(p, module)} />{module}</label>)}</div>,
          },
          {
            key: 'usage', header: 'Usage-days this month',
            render: (p) => {
              const u = usageLevel(p)
              return (
                <span className="row" style={{ gap: 8 }}>
                  <span className="tabular">{number(u.days)}{u.tier.max === Infinity ? '' : ` of ${number(u.tier.max)}`}</span>
                  {u.level !== 'ok' && <Pill tone={u.level === 'crit' ? 'failed' : 'pending'}>{u.level === 'crit' ? 'Over ceiling' : 'Near ceiling'}</Pill>}
                </span>
              )
            },
          },
          {
            key: 'plan', header: 'Tier',
            render: (p) => (
              <select className="tier-select" aria-label={`Tier for ${p.name}`} value={normalisePlan(p.plan)} onChange={(e) => changeTier(p, e.target.value)}>
                {TIERS.map((t) => <option key={t.key} value={t.key}>{t.key}</option>)}
              </select>
            ),
          },
          {
            key: 'status', header: 'Status',
            render: (p) => {
              const s = hospitalStatusPill(p.status)
              return <Pill tone={s.tone}>{s.label}</Pill>
            },
          },
          {
            header: 'Actions',
            render: (p) => (
              <div className="action-btns">
                <Button variant="secondary" onClick={() => toggleSuspend(p)}>
                  {p.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                </Button>
              </div>
            ),
          },
        ]}
        rows={registered}
        getRowKey={(p) => p.id}
        empty="No hospitals registered yet"
      />
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
