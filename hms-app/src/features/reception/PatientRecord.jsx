import { useEffect, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { useRepo } from '@/data/RepositoryContext'
import { Modal, Button, Input, useToast } from '@/components'
import { ageFrom } from '@/lib/patients'

const FIELDS = [
  { key: 'dob', label: 'Date of birth', type: 'date', show: (p) => (p.dob ? `${p.dob}${ageFrom(p.dob) != null ? ` (${ageFrom(p.dob)} yrs)` : ''}` : '') },
  { key: 'age', label: 'Age (years)', type: 'number', show: (p) => (p.age != null && p.age !== '' ? String(p.age) : (ageFrom(p.dob) != null ? String(ageFrom(p.dob)) : '')) },
  { key: 'sex', label: 'Sex', choice: ['male', 'female'], show: (p) => (p.sex ? (p.sex === 'male' ? 'Male' : 'Female') : '') },
  { key: 'phone', label: 'Phone number', type: 'tel' },
  { key: 'address', label: 'Address' },
  { key: 'stateOfOrigin', label: 'State of origin' },
  { key: 'tribe', label: 'Tribe' },
  { key: 'occupation', label: 'Occupation' },
  { key: 'religion', label: 'Religion' },
  { key: 'maritalStatus', label: 'Marital status' },
  { key: 'kinName', label: 'Next of kin' },
  { key: 'kinPhone', label: 'Next of kin phone', type: 'tel' },
  { key: 'allergies', label: 'Known allergies' },
]

export default function PatientRecord({ patient, onClose }) {
  const { user } = useAuth()
  const repo = useRepo()
  const toast = useToast()
  const [editing, setEditing] = useState(null)
  const [value, setValue] = useState('')

  useEffect(() => {
    if (!editing) return
    document.getElementById(`pr-${editing}`)?.focus()
  }, [editing])

  async function save(field) {
    if (field.type === 'number' && value !== '' && (!Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 130)) {
      toast.error('Enter an age between 0 and 130, or leave it blank.')
      return
    }
    const nextValue = field.type === 'number' ? (value === '' ? null : Number(value)) : value.trim()
    const before = { [field.key]: patient[field.key] ?? '' }
    await repo.update('patients', patient.id, { [field.key]: nextValue })
    await repo.create('audit_log', { action: 'patient.updated', ref: patient.fullName, actorId: user.userId, at: new Date().toISOString(), before, after: { [field.key]: nextValue } })
    toast.success('Saved')
    setEditing(null)
  }

  return (
    <Modal title={patient.fullName} onClose={onClose} labelledBy="record-title" actions={<Button variant="primary" onClick={onClose}>Close</Button>}>
      <div className="text-muted mb-2">Patient ID {patient.dibiaId}. Tap Add on a flagged line to fill it in.</div>
      {FIELDS.map((f) => {
        const shown = f.show ? f.show(patient) : patient[f.key]
        const empty = !shown
        return (
          <div key={f.key} className="row-line">
            {empty && <span className="flag" aria-label="Missing" />}
            <span className="grow">
              <span className="r-sub" style={{ fontWeight: 600 }}>{f.label}</span>
              {editing === f.key ? (
                f.choice ? (
                  <span className="row" style={{ gap: 8 }}>
                    {f.choice.map((c) => <Button key={c} size="sm" variant={value === c ? 'primary' : 'ghost'} onClick={() => setValue(c)}>{c === 'male' ? 'Male' : 'Female'}</Button>)}
                  </span>
                ) : (
                  <Input id={`pr-${f.key}`} type={f.type || 'text'} min={f.type === 'number' ? 0 : undefined} max={f.type === 'number' ? 130 : undefined} step={f.type === 'number' ? 1 : undefined} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save(f)} />
                )
              ) : (
                <span className="r-title" style={{ fontWeight: 500 }}>{empty ? 'Not recorded' : shown}</span>
              )}
            </span>
            {editing === f.key ? (
              <>
                <Button size="sm" variant="primary" onClick={() => save(f)}>Save</Button>
                <Button size="sm" variant="quiet" onClick={() => setEditing(null)}>Cancel</Button>
              </>
            ) : (
              <Button size="sm" variant={empty ? 'ghost' : 'quiet'} onClick={() => { setEditing(f.key); setValue(patient[f.key] || '') }}>{empty ? 'Add' : 'Edit'}</Button>
            )}
          </div>
        )
      })}
    </Modal>
  )
}
