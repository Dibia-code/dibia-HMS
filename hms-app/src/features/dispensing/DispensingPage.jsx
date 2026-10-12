import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { PERM } from '@/auth/permissions'
import { useRepo } from '@/data/RepositoryContext'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import { useNow } from '@/hooks/useNow'
import { useToast, usePageHeader, Button, Card, DataTable, Pill, Modal, Field, Input, Select, Textarea, EmptyState, Icon } from '@/components'
import { checkFlags } from '@/lib/interactions'
import { searchPatients } from '@/lib/patients'
import { formatDateTime, relativeTime } from '@/lib/format'

const emptyLine = () => ({ drugName: '', dose: '', frequency: '', duration: '', qty: '' })

function NewPrescription({ onClose, onCreated }) {
  const { user } = useAuth()
  const repo = useRepo()
  const toast = useToast()
  const { data: patients } = useLiveQuery(() => repo.list('patients'), [repo])
  const { data: visits } = useLiveQuery(() => repo.list('visits'), [repo])
  const { data: products } = useLiveQuery(() => repo.list('products'), [repo])
  const { data: staff } = useLiveQuery(() => repo.list('staff'), [repo])
  const doctors = (staff || []).filter((s) => s.active !== false && (s.profession === 'doctor' || s.title?.toLowerCase().includes('doctor') || s.title?.toLowerCase().includes('dr')))
  const [query, setQuery] = useState('')
  const [patient, setPatient] = useState(null)
  const [quick, setQuick] = useState({ on: false, name: '', phone: '' })
  const [prescriber, setPrescriber] = useState('')
  const [customPrescriber, setCustomPrescriber] = useState('')
  const [lines, setLines] = useState([emptyLine()])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const results = useMemo(() => searchPatients(patients || [], query, 4), [patients, query])
  const set = (i, k, v) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)))

  async function save() {
    const filled = lines.filter((l) => l.drugName.trim())
    if (!patient && !(quick.on && quick.name.trim() && quick.phone.trim())) return setError('Choose a patient, or add a name and phone number')
    if (!filled.length) return setError('Add at least one drug')
    if (filled.some((l) => !(Number(l.qty) > 0))) return setError('Every drug needs a quantity')
    setBusy(true)
    try {
      let visit
      let who = patient
      const open = who && (visits || []).filter((v) => v.patientId === who.id && v.status !== 'closed').sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt))[0]
      if (open) visit = open
      else {
        const made = await repo.registerPatient({
          patient: who || { fullName: quick.name.trim(), phone: quick.phone.trim() },
          visit: { status: 'at_pharmacy', route: { departmentId: null, department: 'Pharmacy walk-in', doctor: '' } },
          actorId: user.userId,
        })
        who = made.patient
        visit = made.visit
      }
      const lookup = new Map((products || []).map((p) => [p.name.toLowerCase(), p]))
      const rx = await repo.createPrescription({
        visit,
        patient: who,
        source: 'external',
        prescriber: (prescriber === '__other' ? customPrescriber : prescriber).trim(),
        lines: filled.map((l) => ({ ...l, dose: l.doseAmount ? `${l.doseAmount} ${l.doseUnit || 'mg'}` : l.dose, drugName: l.drugName.trim(), qty: Number(l.qty), productId: lookup.get(l.drugName.trim().toLowerCase())?.id ?? null })),
        actor: { id: user.userId, name: user.name },
      })
      toast.success('Prescription logged')
      onCreated(rx)
    } catch (err) {
      setError(err.message || 'Could not log the prescription')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      wide
      title="Log an outside prescription"
      onClose={onClose}
      labelledBy="newrx-title"
      actions={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={busy}>Add to queue</Button></>}
    >
      {!patient ? (
        <div className="stack-gap">
          <Field label="Patient" htmlFor="rx-pt" hint="Search by name, phone or Dibia ID">
            <Input id="rx-pt" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          </Field>
          {results.map((p) => (
            <button key={p.id} type="button" className="result-row" onClick={() => setPatient(p)}>
              <span className="grow"><span className="r-title">{p.fullName}</span><span className="r-sub">{p.dibiaId} · {p.phone || 'No phone'}</span></span>
            </button>
          ))}
          {!quick.on ? (
            <div><Button variant="quiet" onClick={() => setQuick({ ...quick, on: true })}>Patient is not registered yet</Button></div>
          ) : (
            <div className="form-grid">
              <Field label="First name" htmlFor="q-first" required><Input id="q-first" value={quick.firstName || ''} onChange={(e) => setQuick({ ...quick, firstName: e.target.value, name: [e.target.value, quick.surname, quick.otherNames].filter(Boolean).join(' ') })} /></Field>
              <Field label="Surname" htmlFor="q-surname" required><Input id="q-surname" value={quick.surname || ''} onChange={(e) => setQuick({ ...quick, surname: e.target.value, name: [quick.firstName, e.target.value, quick.otherNames].filter(Boolean).join(' ') })} /></Field>
              <Field label="Other names" htmlFor="q-other"><Input id="q-other" value={quick.otherNames || ''} onChange={(e) => setQuick({ ...quick, otherNames: e.target.value, name: [quick.firstName, quick.surname, e.target.value].filter(Boolean).join(' ') })} /></Field>
              <Field label="Phone number" htmlFor="q-p" required><Input id="q-p" value={quick.phone} onChange={(e) => setQuick({ ...quick, phone: e.target.value })} /></Field>
            </div>
          )}
        </div>
      ) : (
        <div className="row mb-2"><span className="fw-600">{patient.fullName}</span><span className="text-muted">{patient.dibiaId}</span><Button variant="quiet" size="sm" onClick={() => setPatient(null)}>Change</Button></div>
      )}

      <div className="mt-2">
        <Field label="Prescriber" htmlFor="rx-doc" hint="Choose a registered doctor or enter an outside prescriber's name"><Select id="rx-doc" value={prescriber} onChange={(e) => setPrescriber(e.target.value)}><option value="">Choose doctor…</option>{doctors.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}<option value="__other">Other / outside doctor</option></Select>{prescriber === '__other' && <Input className="mt-1" aria-label="Outside prescriber name" value={customPrescriber} onChange={(e) => setCustomPrescriber(e.target.value)} placeholder="Enter doctor's name" />}</Field>
      </div>
      <div className="section-label">Drugs</div>
      <datalist id="drug-names">{(products || []).filter((p) => !p.archived).map((p) => <option key={p.id} value={p.name} />)}</datalist>
      {lines.map((l, i) => (
        <div key={i} className="rx-edit">
          <Input aria-label="Drug" list="drug-names" placeholder="Drug name" value={l.drugName} onChange={(e) => set(i, 'drugName', e.target.value)} />
          <div className="dose-input"><Input aria-label="Dose amount" type="number" min="0" step="any" placeholder="Dose" value={l.doseAmount || ''} onChange={(e) => set(i, 'doseAmount', e.target.value)} /><Select aria-label="Dose unit" value={l.doseUnit || 'mg'} onChange={(e) => set(i, 'doseUnit', e.target.value)}>{['mg','mcg','g','mL','tablet(s)','capsule(s)','drop(s)','puff(s)','sachet(s)'].map((unit) => <option key={unit}>{unit}</option>)}</Select></div>
          <Input aria-label="Frequency" placeholder="How often" value={l.frequency} onChange={(e) => set(i, 'frequency', e.target.value)} />
          <Input aria-label="Duration" placeholder="For how long" value={l.duration} onChange={(e) => set(i, 'duration', e.target.value)} />
          <Input aria-label="Quantity to dispense" type="number" min="1" placeholder="Total qty" value={l.qty} onChange={(e) => set(i, 'qty', e.target.value)} />
          {lines.length > 1 && <Button variant="quiet" size="sm" aria-label="Remove drug" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Icon name="trash" /></Button>}
        </div>
      ))}
      <Button variant="quiet" icon="plus" onClick={() => setLines([...lines, emptyLine()])}>Add another drug</Button>
      {error && <div className="pay-problem">{error}</div>}
    </Modal>
  )
}

function ReturnModal({ record, onClose }) {
  const { user } = useAuth()
  const repo = useRepo()
  const toast = useToast()
  const max = record.qty - (record.returnedQty || 0)
  const [qty, setQty] = useState(String(max))
  const [reason, setReason] = useState('')
  const [disposition, setDisposition] = useState('restock')
  const [error, setError] = useState('')

  async function save() {
    const n = Number(qty)
    if (!(n > 0) || n > max) return setError(`Enter a quantity from 1 to ${max}`)
    if (reason.trim().length < 3) return setError('A reason is required')
    try {
      await repo.returnDispensing({ dispensingId: record.id, qty: n, reason: reason.trim(), disposition, actor: { id: user.userId, name: user.name } })
      toast.success('Return recorded')
      onClose()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <Modal title={`Return ${record.drugName}`} onClose={onClose} labelledBy="return-title" actions={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Record return</Button></>}>
      <div className="stack-gap">
        <Field label="Quantity returned" htmlFor="rt-q" hint={`Up to ${max}`}><Input id="rt-q" type="number" min="1" max={max} value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <Field label="What happens to the stock" htmlFor="rt-d">
          <Select id="rt-d" value={disposition} onChange={(e) => setDisposition(e.target.value)}>
            <option value="restock">Return to stock (batch {record.batchNo})</option>
            <option value="damaged">Damaged, do not restock</option>
            <option value="expired">Expired, do not restock</option>
          </Select>
        </Field>
        <Field label="Reason" htmlFor="rt-r" required error={error}><Textarea id="rt-r" value={reason} onChange={(e) => { setReason(e.target.value); setError('') }} /></Field>
      </div>
    </Modal>
  )
}

export default function DispensingPage() {
  const { user, can } = useAuth()
  const repo = useRepo()
  const navigate = useNavigate()
  const now = useNow()
  const [tab, setTab] = useState('queue')
  const [creating, setCreating] = useState(false)
  const [returning, setReturning] = useState(null)

  const { data: prescriptions } = useLiveQuery(() => repo.list('prescriptions'), [repo])
  const { data: dispensings } = useLiveQuery(() => repo.list('dispensings'), [repo])
  const { data: patients } = useLiveQuery(() => repo.list('patients'), [repo])
  const { data: products } = useLiveQuery(() => repo.list('products'), [repo])

  usePageHeader(
    {
      title: 'Dispensing',
      subtitle: 'Prescriptions waiting at the pharmacy',
      actions: can(PERM.DISPENSE) ? <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Log outside prescription</Button> : null,
    },
    [],
  )

  const queue = useMemo(() => {
    const pmap = new Map((patients || []).map((p) => [p.id, p]))
    const gmap = new Map((products || []).map((p) => [p.name.toLowerCase(), p.genericName || p.name]))
    return (prescriptions || [])
      .filter((r) => r.status === 'pending' || r.status === 'partial')
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .map((r) => {
        const flags = checkFlags({
          allergies: pmap.get(r.patientId)?.allergies,
          drugs: r.lines.map((l) => ({ name: l.drugName, generic: gmap.get(l.drugName.toLowerCase()) || l.drugName })),
        })
        return { ...r, flags }
      })
  }, [prescriptions, patients, products])

  const history = useMemo(() => (dispensings || []).slice().sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 40), [dispensings])

  return (
    <>
      <div className="filter-chips mb-2">
        <button type="button" className={`filter-chip ${tab === 'queue' ? 'active' : ''}`} onClick={() => setTab('queue')}>Queue · {queue.length}</button>
        <button type="button" className={`filter-chip ${tab === 'done' ? 'active' : ''}`} onClick={() => setTab('done')}>Dispensed</button>
      </div>

      {tab === 'queue' && (
        queue.length === 0 ? (
          <EmptyState icon="pill" title="No prescriptions waiting" hint="Prescriptions appear here when a patient is sent to the pharmacy." />
        ) : (
          <Card>
            <DataTable
              rowStatus={(r) => (r.flags.length ? 'interaction' : r.status === 'partial' ? 'warn' : 'warn')}
              onRowClick={(r) => navigate(`/${user.hospitalSlug}/dispensing/${r.id}`)}
              columns={[
                { key: 'p', header: 'Patient', render: (r) => (<div><div className="cell-strong">{r.patientName}</div><div className="cell-sub">{r.dibiaId} · {r.source === 'external' ? 'Outside prescription' : r.prescriber}</div></div>) },
                { key: 'l', header: 'Drug lines', align: 'num', render: (r) => r.lines.length },
                { key: 't', header: 'Waiting', render: (r) => relativeTime(r.createdAt, now) },
                { key: 's', header: 'Status', render: (r) => (<span className="row" style={{ gap: 6 }}><Pill tone={r.status === 'partial' ? 'pending' : 'inactive'}>{r.status === 'partial' ? 'Partly dispensed' : 'Waiting'}</Pill>{r.flags.length > 0 && <Pill tone="interaction">Check needed</Pill>}</span>) },
              ]}
              rows={queue}
            />
          </Card>
        )
      )}

      {tab === 'done' && (
        <Card>
          <DataTable
            columns={[
              { key: 'd', header: 'Drug', render: (r) => (<div><div className="cell-strong">{r.drugName}</div><div className="cell-sub">{r.substituted ? `Substituted for ${r.prescribedName}` : `Batch ${r.batchNo}`}</div></div>) },
              { key: 'p', header: 'Patient', render: (r) => r.patientName },
              { key: 'q', header: 'Qty', align: 'num', render: (r) => `${r.qty}${r.returnedQty ? ` (${r.returnedQty} back)` : ''}` },
              { key: 'w', header: 'When', render: (r) => formatDateTime(r.at) },
              { key: 's', header: 'By', render: (r) => r.staffName },
              { key: 'a', header: '', render: (r) => r.qty - (r.returnedQty || 0) > 0 && can(PERM.DISPENSE) ? <Button size="sm" variant="ghost" onClick={() => setReturning(r)}>Return</Button> : null },
            ]}
            rows={history}
            empty={<div className="empty-row">Nothing dispensed yet.</div>}
          />
        </Card>
      )}

      {creating && <NewPrescription onClose={() => setCreating(false)} onCreated={(rx) => { setCreating(false); navigate(`/${user.hospitalSlug}/dispensing/${rx.id}`) }} />}
      {returning && <ReturnModal record={returning} onClose={() => setReturning(null)} />}
    </>
  )
}
