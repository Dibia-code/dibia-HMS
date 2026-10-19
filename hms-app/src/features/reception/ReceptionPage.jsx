import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { useRepo } from '@/data/RepositoryContext'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import { useHospital } from '@/hooks/useHospital'
import { useToast, usePageHeader, Button, Card, CardHead, Field, Input, Select, Pill, DataTable, Icon, Switch } from '@/components'
import { searchPatients, findPossibleDuplicates, ageFrom } from '@/lib/patients'
import { STATUS_BY_KEY, routingDepartments } from '@/lib/hospital'
import { naira, relativeTime, formatDate } from '@/lib/format'
import PatientRecord from './PatientRecord'
import { uuid } from '@/lib/id'

const EMPTY = {
  firstName: '', surname: '', otherNames: '', dob: '', age: '', sex: '', phone: '', stateOfOrigin: '', tribe: '', occupation: '', religion: '', maritalStatus: '', address: '', kinName: '', kinPhone: '', photo: '', allergies: [], symptoms: [],
}
const STEPS = ['Identity', 'Contact', 'Confirm']

function TokenInput({ id, value = [], onChange }) {
  const items = Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim())
    : typeof value === 'string' && value.trim()
      ? value.split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean)
      : []
  const [draft, setDraft] = useState('')
  const add = () => {
    const next = draft.trim().replace(/,$/, '')
    if (next && !items.some((item) => item.toLowerCase() === next.toLowerCase())) onChange([...items, next])
    setDraft('')
  }
  return <div className="token-input" onClick={(e) => e.currentTarget.querySelector('input')?.focus()}>
    {items.map((item) => <span className="token" key={item}>{item}<button type="button" aria-label={`Remove ${item}`} onClick={() => onChange(items.filter((v) => v !== item))}>×</button></span>)}
    <input id={id} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add() } if (e.key === 'Backspace' && !draft && items.length) onChange(items.slice(0, -1)) }} onBlur={add} placeholder="Add item…" />
  </div>
}

function downscale(file, max = 160) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.7))
      }
      img.onerror = () => resolve('')
      img.src = reader.result
    }
    reader.onerror = () => resolve('')
    reader.readAsDataURL(file)
  })
}

function Steps({ step, onJump }) {
  return (
    <ol className="steps" aria-label="Registration steps">
      {STEPS.map((label, i) => (
        <li key={label} className={i + 1 === step ? 'current' : i + 1 < step ? 'done' : ''}>
          <button type="button" disabled={i + 1 > step} onClick={() => onJump(i + 1)}>
            <span className="n">{i + 1 < step ? <Icon name="check" size={14} /> : i + 1}</span>
            <span className="l">{label}</span>
          </button>
        </li>
      ))}
    </ol>
  )
}

function RoutingFields({ config = {}, route = {}, setRoute, hmo = {}, setHmo, doctors = [] }) {
  const departments = routingDepartments(config)
  const doctorList = Array.isArray(doctors) ? doctors : []
  return (
    <div className="stack-gap">
      <div className="form-grid">
        <Field label="Send patient to" htmlFor="route">
          <Select id="route" value={route.departmentId || ''} onChange={(e) => setRoute({ ...route, departmentId: e.target.value })}>
            <option value="">Not assigned yet</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({naira(d.fee)})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Doctor" htmlFor="doctor" hint="Optional">
          <Select id="doctor" value={route.doctor || ''} onChange={(e) => setRoute({ ...route, doctor: e.target.value })}>
            <option value="">Select doctor</option>
            {doctorList.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
            <option value="__other">Other (enter name)</option>
          </Select>
          {route.doctor === '__other' && <Input className="mt-1" aria-label="Doctor name" value={route.otherDoctor || ''} onChange={(e) => setRoute({ ...route, otherDoctor: e.target.value })} placeholder="Enter doctor's name" />}
        </Field>
      </div>
      <div className="toggle-row">
        <div>
          <div className="tname">Patient has HMO or insurance cover</div>
          <div className="tsub">The cashier will see the scheme and can bill it as a receivable.</div>
        </div>
        <Switch checked={!!hmo.on} onChange={(on) => setHmo({ ...hmo, on })} />
      </div>
      {hmo.on && (
        <div className="form-grid">
          <Field label="HMO scheme" htmlFor="scheme">
            <Input id="scheme" value={hmo.scheme} onChange={(e) => setHmo({ ...hmo, scheme: e.target.value })} placeholder="Scheme name" />
          </Field>
          <Field label="Member ID" htmlFor="memberId">
            <Input id="memberId" value={hmo.memberId} onChange={(e) => setHmo({ ...hmo, memberId: e.target.value })} />
          </Field>
        </div>
      )}
    </div>
  )
}

export default function ReceptionPage() {
  const { user } = useAuth()
  const repo = useRepo()
  const toast = useToast()
  const navigate = useNavigate()
  const { config } = useHospital()

  const { data: patients } = useLiveQuery(() => repo.list('patients'), [repo])
  const { data: visits } = useLiveQuery(() => repo.list('visits'), [repo])
  const { data: staff } = useLiveQuery(() => repo.list('staff'), [repo])
  const doctors = (Array.isArray(staff) ? staff : []).filter((s) => (s.active !== false) && (s.profession === 'doctor' || s.title?.toLowerCase().includes('doctor') || s.title?.toLowerCase().includes('dr')))

  usePageHeader({ title: 'Register patient', subtitle: 'Find a returning patient or register a new one' }, [])

  const [query, setQuery] = useState('')
  const [existing, setExisting] = useState(null)
  const [registering, setRegistering] = useState(false)
  const [step, setStep] = useState(1)
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [dupDismissed, setDupDismissed] = useState(false)
  const [route, setRoute] = useState({ departmentId: '', doctor: '' })
  const [hmo, setHmo] = useState({ on: false, scheme: '', memberId: '' })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [record, setRecord] = useState(null)
  const [focusId, setFocusId] = useState(null)
  const photoRef = useRef(null)

  const results = useMemo(() => searchPatients(patients || [], query), [patients, query])
  const candidates = useMemo(
    () => (registering ? findPossibleDuplicates(patients || [], form) : []),
    [patients, form.firstName, form.surname, form.phone, registering], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const duplicates = step < 3 ? candidates : []

  useEffect(() => {
    if (!focusId) return
    const el = document.getElementById(focusId)
    if (el) el.focus()
    setFocusId(null)
  }, [focusId, step])

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }))
    setErrors((er) => ({ ...er, [k]: undefined, contact: undefined }))
  }

  const lastVisit = (patientId) =>
    (visits || []).filter((v) => v.patientId === patientId).sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt))[0]

  const todays = useMemo(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return (visits || [])
      .filter((v) => new Date(v.openedAt) >= start)
      .sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt))
      .slice(0, 8)
  }, [visits])

  function reset() {
    setQuery('')
    setExisting(null)
    setRegistering(false)
    setStep(1)
    setForm(EMPTY)
    setErrors({})
    setDupDismissed(false)
    setRoute({ departmentId: '', doctor: '' })
    setHmo({ on: false, scheme: '', memberId: '' })
    setDone(null)
  }

  function startNew() {
    setExisting(null)
    setRegistering(true)
    setStep(1)
    setDone(null)
    setFocusId('firstName')
  }

  function next() {
    const er = {}
    if (step === 1 && (!form.firstName.trim() || !form.surname.trim())) er.firstName = 'Enter first name and surname'
    if (step === 2 && !form.phone.trim() && !form.kinPhone.trim()) {
      er.contact = 'Add a phone number for the patient or their next of kin'
    }
    setErrors(er)
    if (Object.keys(er).length) return
    setStep((s) => s + 1)
    setFocusId(step === 1 ? 'phone' : null)
  }

  function jump(toStep, field) {
    setStep(toStep)
    if (field) setFocusId(field)
  }

  async function onPhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const photo = await downscale(file)
    setForm((f) => ({ ...f, photo }))
  }

  const allergyItems = Array.isArray(form.allergies)
    ? form.allergies
    : typeof form.allergies === 'string' && form.allergies.trim()
      ? form.allergies.split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean)
      : []
  const missing = [
    !form.dob && !form.age && { label: 'Age', step: 1, field: 'age' },
    !form.sex && { label: 'Sex', step: 1, field: 'sex-male' },
    !form.address.trim() && { label: 'Address', step: 2, field: 'address' },
    !form.kinName.trim() && { label: 'Next of kin', step: 2, field: 'kinName' },
  ].filter(Boolean)

  async function openVisit() {
    if (form.age !== '' && (!Number.isInteger(Number(form.age)) || Number(form.age) < 0 || Number(form.age) > 130)) {
      toast.error('Enter an age between 0 and 130, or leave it blank.')
      jump(1, 'age')
      return
    }
    const dept = config.departments.find((d) => d.id === route.departmentId)
    const destination = routingDepartments(config).find((d) => d.id === route.departmentId)
    const visit = {
      symptoms: existing ? [] : form.symptoms,
      route: {
        departmentId: destination?.id || null,
        department: destination?.name || '',
        doctor: (route.doctor === '__other' ? route.otherDoctor : route.doctor || '').trim(),
        emergency: destination ? destination.name.toLowerCase() === 'emergency' : false,
      },
      hmo: hmo.on ? { scheme: hmo.scheme.trim(), memberId: hmo.memberId.trim() } : null,
      charges:
        dept && dept.fee > 0
          ? [{ id: uuid(), type: 'consultation', label: `Consultation, ${dept.name}`, qty: 1, unitPrice: dept.fee, at: new Date().toISOString() }]
          : [],
    }
    setBusy(true)
    try {
      const patient = existing || {
        firstName: form.firstName.trim(), surname: form.surname.trim(), otherNames: form.otherNames.trim(),
        fullName: [form.firstName, form.surname, form.otherNames].filter(Boolean).join(' '),
        dob: form.dob,
        age: form.age ? Number(form.age) : null,
        sex: form.sex,
        phone: form.phone.trim(),
        stateOfOrigin: form.stateOfOrigin.trim(),
        tribe: form.tribe.trim(),
        occupation: form.occupation.trim(),
        religion: form.religion.trim(),
        maritalStatus: form.maritalStatus,
        address: form.address.trim(),
        kinName: form.kinName.trim(),
        kinPhone: form.kinPhone.trim(),
        allergies: allergyItems, symptoms: form.symptoms,
        photo: form.photo,
        ...(candidates.length ? { possibleDuplicateOf: candidates.map((d) => d.id), duplicateReview: 'open' } : {}),
      }
      const result = await repo.registerPatient({ patient, visit, actorId: user.userId })
      toast.success(`Visit opened for ${result.patient.fullName}`)
      setDone(result)
      setRegistering(false)
      setExisting(null)
    } catch (err) {
      toast.error(err.message || 'Could not open the visit')
    } finally {
      setBusy(false)
    }
  }

  const confirmBlock = (
    <>
      <Card className="mb-2">
        <CardHead title="Send to">
          <div className="spacer" />
        </CardHead>
        <RoutingFields config={config} route={route} setRoute={setRoute} hmo={hmo} setHmo={setHmo} doctors={doctors} />
      </Card>
    </>
  )

  if (done) {
    return (
      <Card className="status-ok success-card">
        <div className="row">
          <span className="success-mark">
            <Icon name="check" size={22} />
          </span>
          <div>
            <div className="fw-600" style={{ fontSize: 18 }}>Visit opened for {done.patient.fullName}</div>
            <div className="text-muted">Patient ID {done.patient.dibiaId} · Visit {done.visit.visitNo}</div>
          </div>
        </div>
        <div className="row wrap mt-3">
          <Button variant="primary" icon="userPlus" onClick={reset}>Register another patient</Button>
          <Button variant="ghost" icon="queue" onClick={() => navigate(`/${user.hospitalSlug}/queue`)}>View queue</Button>
        </div>
      </Card>
    )
  }

  return (
    <>
      <Card className="mb-3">
        <CardHead title="Returning patient" />
        <div className="search-box">
          <Icon name="search" />
          <input
            aria-label="Search patients"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setExisting(null)
            }}
            placeholder="Search by name, phone number or Dibia ID"
            autoFocus
          />
        </div>

        {query.trim().length >= 2 && !existing && (
          <div className="mt-2">
            {results.length === 0 ? (
              <div className="empty-row">No matching patient found.</div>
            ) : (
              results.map((p) => {
                const lv = lastVisit(p.id)
                return (
                  <button key={p.id} type="button" className="result-row" onClick={() => setExisting(p)}>
                    <span className="grow">
                      <span className="r-title">{p.fullName}</span>
                      <span className="r-sub">
                        {p.dibiaId} · {p.phone || 'No phone'}
                        {ageFrom(p.dob, p.age) != null ? ` · ${ageFrom(p.dob, p.age)} yrs` : ''}
                        {lv ? ` · last visit ${formatDate(lv.openedAt)}` : ''}
                      </span>
                    </span>
                    <Icon name="chevronRight" />
                  </button>
                )
              })
            )}
          </div>
        )}

        {!registering && !existing && (
          <div className="mt-2">
            <Button variant="primary" icon="userPlus" onClick={startNew}>
              Register new patient
            </Button>
          </div>
        )}
      </Card>

      {existing && (
        <>
          <Card className="mb-2 status-info">
            <div className="row">
              <span className="patient-photo">{existing.photo ? <img src={existing.photo} alt="" /> : <Icon name="user" size={26} />}</span>
              <div className="grow">
                <div className="fw-600" style={{ fontSize: 17 }}>{existing.fullName}</div>
                <div className="text-muted">
                  {existing.dibiaId} · {existing.phone || 'No phone'}
                  {ageFrom(existing.dob, existing.age) != null ? ` · ${ageFrom(existing.dob, existing.age)} yrs` : ''}
                </div>
              </div>
              <Button variant="quiet" onClick={() => setRecord(existing)}>View record</Button>
              <Button variant="quiet" onClick={() => setExisting(null)}>Change</Button>
            </div>
          </Card>
          {confirmBlock}
          <Button variant="primary" size="lg" className={busy ? 'loading' : undefined} disabled={busy} onClick={openVisit}>
            {busy ? '' : 'Confirm and open visit'}
          </Button>
        </>
      )}

      {registering && (
        <Card padLg>
          <Steps step={step} onJump={setStep} />

          {duplicates.length > 0 && !dupDismissed && (
            <div className="dup-card status-expiry">
              <div className="fw-600">This patient may already be registered</div>
              {duplicates.slice(0, 3).map((p) => (
                <div key={p.id} className="row-line">
                  <span className="grow">
                    <span className="r-title">{p.fullName}</span>
                    <span className="r-sub">{p.dibiaId} · {p.phone || 'No phone'}</span>
                  </span>
                  <Button size="sm" variant="primary" onClick={() => { setExisting(p); setRegistering(false); setQuery(p.fullName) }}>
                    Use this patient
                  </Button>
                </div>
              ))}
              <Button size="sm" variant="quiet" onClick={() => setDupDismissed(true)}>Register as a new patient</Button>
            </div>
          )}

          {step === 1 && (
            <div className="form-grid">
              <Field label="First name" htmlFor="firstName" error={errors.firstName} required><Input id="firstName" value={form.firstName} onChange={set('firstName')} autoComplete="given-name" /></Field>
              <Field label="Surname" htmlFor="surname" required><Input id="surname" value={form.surname} onChange={set('surname')} autoComplete="family-name" /></Field>
              <Field label="Other names" htmlFor="otherNames" span2><Input id="otherNames" value={form.otherNames} onChange={set('otherNames')} autoComplete="additional-name" /></Field>
              <Field label="Date of birth" htmlFor="dob" hint="Optional. Enter an approximate date if unsure.">
                <Input id="dob" type="date" value={form.dob} max={new Date().toISOString().slice(0, 10)} onChange={set('dob')} />
              </Field>
              <Field label="Age (years)" htmlFor="age" hint="Optional if date of birth is known">
                <Input id="age" type="number" min="0" max="130" step="1" value={form.age} onChange={set('age')} />
              </Field>
              <Field label="Sex">
                <div className="seg two" role="radiogroup" aria-label="Sex">
                  {[['male', 'Male'], ['female', 'Female']].map(([v, l]) => (
                    <button
                      key={v}
                      id={`sex-${v}`}
                      type="button"
                      role="radio"
                      aria-checked={form.sex === v}
                      onClick={() => setForm((f) => ({ ...f, sex: v }))}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Photo" span2 hint="Optional. Helps confirm identity at the desk.">
                <div className="row">
                  <span className="patient-photo">{form.photo ? <img src={form.photo} alt="" /> : <Icon name="user" size={26} />}</span>
                  <Button variant="ghost" icon="image" onClick={() => photoRef.current?.click()}>
                    {form.photo ? 'Retake photo' : 'Take photo'}
                  </Button>
                  <input ref={photoRef} type="file" accept="image/*" capture="user" hidden onChange={onPhoto} />
                </div>
              </Field>
            </div>
          )}

          {step === 2 && (
            <div className="form-grid">
              <Field label="Phone number" htmlFor="phone" error={errors.contact}>
                <Input id="phone" type="tel" inputMode="tel" value={form.phone} onChange={set('phone')} placeholder="0803 000 0000" />
              </Field>
              <Field label="Address" htmlFor="address" hint="Optional">
                <Input id="address" value={form.address} onChange={set('address')} />
              </Field>
              <Field label="State of origin" htmlFor="stateOfOrigin" hint="Optional">
                <Input id="stateOfOrigin" value={form.stateOfOrigin} onChange={set('stateOfOrigin')} />
              </Field>
              <Field label="Tribe" htmlFor="tribe" hint="Optional">
                <Input id="tribe" value={form.tribe} onChange={set('tribe')} />
              </Field>
              <Field label="Occupation" htmlFor="occupation" hint="Optional">
                <Input id="occupation" value={form.occupation} onChange={set('occupation')} />
              </Field>
              <Field label="Religion" htmlFor="religion" hint="Optional">
                <Input id="religion" value={form.religion} onChange={set('religion')} />
              </Field>
              <Field label="Marital status" htmlFor="maritalStatus" hint="Optional">
                <Select id="maritalStatus" value={form.maritalStatus} onChange={set('maritalStatus')}>
                  <option value="">Choose if provided</option>
                  <option value="single">Single</option>
                  <option value="married">Married</option>
                  <option value="divorced">Divorced</option>
                  <option value="widowed">Widowed</option>
                  <option value="separated">Separated</option>
                </Select>
              </Field>
              <Field label="Next of kin name" htmlFor="kinName">
                <Input id="kinName" value={form.kinName} onChange={set('kinName')} />
              </Field>
              <Field label="Next of kin phone" htmlFor="kinPhone">
                <Input id="kinPhone" type="tel" inputMode="tel" value={form.kinPhone} onChange={set('kinPhone')} />
              </Field>
              <Field label="Known allergies" htmlFor="allergies" span2 hint="Type an item and press Enter. The pharmacy is warned before dispensing."><TokenInput id="allergies" value={form.allergies} onChange={(value) => setForm((f) => ({ ...f, allergies: value }))} /></Field>
              <Field label="Symptoms" htmlFor="symptoms" span2 hint="Type each symptom and press Enter."><TokenInput id="symptoms" value={form.symptoms} onChange={(value) => setForm((f) => ({ ...f, symptoms: value }))} /></Field>
            </div>
          )}

          {step === 3 && (
            <>
              <div className="summary">
                <div className="sum-block">
                  <div className="sum-head">
                    <span>Identity</span>
                    <Button size="sm" variant="quiet" onClick={() => jump(1)}>Edit</Button>
                  </div>
                  <div className="row">
                    <span className="patient-photo">{form.photo ? <img src={form.photo} alt="" /> : <Icon name="user" size={26} />}</span>
                    <div>
                      <div className="fw-600" style={{ fontSize: 17 }}>{[form.firstName, form.surname, form.otherNames].filter(Boolean).join(' ')}</div>
                      <div className="text-muted">
                        {[form.sex && (form.sex === 'male' ? 'Male' : 'Female'), ageFrom(form.dob, form.age) != null && `${ageFrom(form.dob, form.age)} yrs`].filter(Boolean).join(' · ') || 'Age and sex not recorded'}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="sum-block">
                  <div className="sum-head">
                    <span>Contact</span>
                    <Button size="sm" variant="quiet" onClick={() => jump(2)}>Edit</Button>
                  </div>
                  <div>{form.phone || 'No phone number'}</div>
                  <div className="text-muted">{form.address || 'No address'}</div>
                  <div className="text-muted">{[form.stateOfOrigin && `State of origin: ${form.stateOfOrigin}`, form.tribe && `Tribe: ${form.tribe}`, form.occupation && `Occupation: ${form.occupation}`, form.religion && `Religion: ${form.religion}`, form.maritalStatus && `Marital status: ${form.maritalStatus}`].filter(Boolean).join(' · ') || 'No additional demographics recorded'}</div>
                  {allergyItems.length > 0 && <div className="fw-600" style={{ color: 'var(--pill-interaction-fg)' }}>Allergies: {allergyItems.join(', ')}</div>}
                  <div className="text-muted">
                    {form.kinName ? `Next of kin: ${form.kinName}${form.kinPhone ? `, ${form.kinPhone}` : ''}` : form.kinPhone ? `Next of kin phone: ${form.kinPhone}` : 'No next of kin'}
                  </div>
                </div>
              </div>

              {missing.length > 0 && (
                <div className="missing">
                  <div className="fw-600">Details still missing</div>
                  <div className="text-muted mb-1">You can open the visit now and complete these later.</div>
                  {missing.map((m) => (
                    <div key={m.label} className="row-line">
                      <span className="flag" aria-hidden="true" />
                      <span className="grow">{m.label}</span>
                      <Button size="sm" variant="ghost" onClick={() => jump(m.step, m.field)}>Add</Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-2">
                <RoutingFields config={config} route={route} setRoute={setRoute} hmo={hmo} setHmo={setHmo} />
              </div>
            </>
          )}

          <div className="fp-actions">
            <Button variant="quiet" onClick={reset}>Cancel</Button>
            {step > 1 && <Button variant="ghost" onClick={() => setStep(step - 1)}>Back</Button>}
            {step < 3 ? (
              <Button variant="primary" iconRight="arrowRight" onClick={next}>Next</Button>
            ) : (
              <Button variant="primary" className={busy ? 'loading' : undefined} disabled={busy} onClick={openVisit}>
                {busy ? '' : 'Confirm and open visit'}
              </Button>
            )}
          </div>
        </Card>
      )}

      {record && <PatientRecord patient={patients.find((p) => p.id === record.id) || record} onClose={() => setRecord(null)} />}

      <div className="section-label">Opened today</div>
      <Card>
        <DataTable
          columns={[
            { key: 'patient', header: 'Patient', render: (v) => (<div><div className="cell-strong">{v.patientName}</div><div className="cell-sub">{v.dibiaId}</div></div>) },
            { key: 'route', header: 'Sent to', render: (v) => v.route?.department || 'Not assigned' },
            { key: 'time', header: 'Opened', render: (v) => relativeTime(v.openedAt) },
            {
              key: 'status',
              header: 'Status',
              render: (v) => {
                const s = STATUS_BY_KEY[v.status]
                return <Pill tone={s?.tone || 'inactive'}>{s?.label || 'Closed'}</Pill>
              },
            },
          ]}
          rows={todays}
          empty={<div className="empty-row">No visits opened today yet.</div>}
        />
      </Card>
    </>
  )
}
