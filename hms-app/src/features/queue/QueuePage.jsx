import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { PERM } from '@/auth/permissions'
import { useRepo } from '@/data/RepositoryContext'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import { useNow } from '@/hooks/useNow'
import { useHospital } from '@/hooks/useHospital'
import { useToast, usePageHeader, Button, Card, Pill, Select, Input, Modal, EmptyState, Field } from '@/components'
import { QUEUE_STATUSES, CLOSE_REASONS } from '@/lib/hospital'
import { relativeTime } from '@/lib/format'

export default function QueuePage() {
  const { user, can } = useAuth()
  const repo = useRepo()
  const toast = useToast()
  const now = useNow()
  const { config } = useHospital()
  const departments = Array.isArray(config?.departments) ? config.departments : []
  const canManage = can(PERM.QUEUE_MANAGE)

  const { data: visits } = useLiveQuery(() => repo.list('visits'), [repo])
  const [admitting, setAdmitting] = useState(null)
  const [ward, setWard] = useState('')
  const [closing, setClosing] = useState(null)
  const [reason, setReason] = useState('discharged')

  const open = useMemo(
    () =>
      (visits || [])
        .filter((v) => v.status !== 'closed')
        .sort((a, b) => new Date(a.openedAt) - new Date(b.openedAt)),
    [visits],
  )

  usePageHeader(
    {
      title: 'Queue',
      subtitle: `${open.length} open visit${open.length === 1 ? '' : 's'}`,
      actions: can(PERM.PATIENTS_MANAGE) ? (
        <Link to={`/${user.hospitalSlug}/reception`} className="btn btn-primary">
          Register patient
        </Link>
      ) : null,
    },
    [open.length, user.hospitalSlug],
  )

  async function setStatus(v, status) {
    try {
      await repo.updateVisit(v.id, { status }, { actorId: user.userId, action: 'visit.status' })
    } catch (err) {
      toast.error(err.message || 'Could not update the visit')
    }
  }

  async function setDepartment(v, departmentId) {
    const dept = departments.find((d) => d.id === departmentId)
    try {
      await repo.updateVisit(
        v.id,
        {
          route: {
            ...v.route,
            departmentId: dept?.id || null,
            department: dept?.name || '',
            emergency: dept ? dept.name.toLowerCase() === 'emergency' : false,
          },
        },
        { actorId: user.userId, action: 'visit.reassigned' },
      )
    } catch (err) {
      toast.error(err.message || 'Could not reassign the patient')
    }
  }

  async function admit() {
    try {
      await repo.updateVisit(
        admitting.id,
        { type: 'inpatient', admission: { admittedAt: new Date().toISOString(), ward: ward.trim() } },
        { actorId: user.userId, action: 'visit.admitted' },
      )
      toast.success(`${admitting.patientName} admitted`)
      setAdmitting(null)
      setWard('')
    } catch (err) {
      toast.error(err.message || 'Could not admit the patient')
    }
  }

  async function closeVisit() {
    try {
      await repo.updateVisit(
        closing.id,
        {
          status: 'closed', closedReason: reason, closedAt: new Date().toISOString(),
          ...(closing.type === 'inpatient' ? { admission: { ...closing.admission, dischargedAt: new Date().toISOString() } } : {}),
        },
        { actorId: user.userId, action: 'visit.closed' },
      )
      toast.success('Visit closed')
      setClosing(null)
    } catch (err) {
      toast.error(err.message || 'Could not close the visit')
    }
  }

  if (visits && open.length === 0) {
    return <EmptyState icon="queue" title="No open visits" hint="Patients appear here as soon as reception opens a visit." />
  }

  return (
    <>
      {QUEUE_STATUSES.map((s) => {
        const rows = open.filter((v) => v.status === s.key)
        if (!rows.length && s.key !== 'waiting') return null
        return (
          <section key={s.key} className="queue-group">
            <div className="section-label row">
              <span>{s.label}</span>
              <span className="count-badge">{rows.length}</span>
            </div>
            {rows.length === 0 ? (
              <Card className="status-none"><span className="text-muted">Nobody waiting.</span></Card>
            ) : (
              rows.map((v) => (
                <Card key={v.id} className={`queue-card status-${s.row || 'none'}`}>
                  <div className="q-main">
                    <div className="q-name">{v.patientName}</div>
                    <div className="r-sub">
                      {v.dibiaId} · opened {relativeTime(v.openedAt, now)}{v.route?.doctor ? ` · ${v.route.doctor}` : ''}
                    </div>
                  </div>
                  <div className="q-chips">
                    {v.route?.emergency && <Pill tone="critical">Emergency</Pill>}
                    {v.type === 'inpatient' && <Pill tone="info" dot={false}>Admitted{v.admission?.ward ? `: ${v.admission.ward}` : ''}</Pill>}
                    {v.hmo && <Pill tone="info" dot={false}>{v.hmo.scheme || 'HMO'}</Pill>}
                    {!canManage && <Pill tone={s.tone}>{s.label}</Pill>}
                  </div>
                  <div className="q-route">
                    {canManage ? (
                      <Select
                        aria-label={`Department for ${v.patientName}`}
                        value={v.route?.departmentId || ''}
                        onChange={(e) => setDepartment(v, e.target.value)}
                      >
                        <option value="">Not assigned</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </Select>
                    ) : (
                      <span>{v.route?.department || 'Not assigned'}{v.route?.doctor ? `, ${v.route.doctor}` : ''}</span>
                    )}
                  </div>
                  {canManage && (
                    <div className="q-actions">
                      <Select aria-label={`Status for ${v.patientName}`} value={v.status} onChange={(e) => setStatus(v, e.target.value)}>
                        {QUEUE_STATUSES.map((o) => (
                          <option key={o.key} value={o.key}>{o.label}</option>
                        ))}
                      </Select>
                      {v.type !== 'inpatient' && <Button size="sm" variant="ghost" onClick={() => { setAdmitting(v); setWard('') }}>Admit</Button>}
                      <Button size="sm" variant="ghost" onClick={() => { setClosing(v); setReason('discharged') }}>
                        Close visit
                      </Button>
                    </div>
                  )}
                </Card>
              ))
            )}
          </section>
        )
      })}

      {admitting && (
        <Modal title={`Admit ${admitting.patientName}?`} onClose={() => setAdmitting(null)} labelledBy="admit-title" actions={<><Button variant="ghost" onClick={() => setAdmitting(null)}>Cancel</Button><Button variant="primary" onClick={admit}>Admit patient</Button></>}>
          <p className="mb-2">The admission fee, the bed for each day of stay and the daily levy are added to the bill automatically.</p>
          <Field label="Ward or bed" htmlFor="ward"><Input id="ward" value={ward} onChange={(e) => setWard(e.target.value)} placeholder="e.g. Male ward, bed 4" /></Field>
        </Modal>
      )}

      {closing && (
        <Modal
          title={`Close visit for ${closing.patientName}?`}
          onClose={() => setClosing(null)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setClosing(null)}>Cancel</Button>
              <Button variant="primary" onClick={closeVisit}>Close visit</Button>
            </>
          }
        >
          <p className="mb-2">The patient leaves the queue. Their bill stays available to the cashier.</p>
          <Field label="Reason" htmlFor="reason">
            <Select id="reason" value={reason} onChange={(e) => setReason(e.target.value)}>
              {CLOSE_REASONS.map((r) => (
                <option key={r.key} value={r.key}>{r.label}</option>
              ))}
            </Select>
          </Field>
        </Modal>
      )}
    </>
  )
}
