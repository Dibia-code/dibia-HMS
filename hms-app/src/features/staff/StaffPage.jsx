import { useMemo, useState } from 'react'
import { useRepo } from '@/data/RepositoryContext'
import { useAuth } from '@/auth/AuthContext'
import { permissionsFor, PERM } from '@/auth/permissions'
import { ROLE, ROLES } from '@/auth/roles'
import { PERM_GROUPS } from '@/auth/permLabels'
import { formatDateTime } from '@/lib/format'
import { useToast, Modal, ConfirmDialog, OnlineButton } from '@/components'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import {
  usePageHeader, Card, CardHead, Button, StatRow, StatCard, DataTable,
  Avatar, RoleBadges, Pill, FormPanel, FormGrid, Field, Input, Select, Switch, RoleChipPicker,
} from '@/components'

const emptyDraft = () => ({ id: null, firstName: '', surname: '', otherNames: '', profession: '', email: '', phone: '', branchId: '', active: true, roleSlugs: [], permGrants: [], permDenies: [], pin: '' })
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ADMIN_ONLY_PERMS = new Set([
  PERM.DASHBOARD_ADMIN, PERM.STAFF_MANAGE, PERM.SETTINGS_MANAGE,
  PERM.SUBSCRIPTION_MANAGE, PERM.CEO_VIEW,
])

// Staff — the many-to-many role model in the UI (§4). Each person can hold
// several roles (staff_roles join); the chip picker edits that set and
// repo.saveStaff reconciles the join rows atomically. Access downstream is the
// UNION of permissions across every role shown here.
export default function StaffPage() {
  const repo = useRepo()
  const toast = useToast()
  const { user } = useAuth()
  const canAssignAdminRoles = (user?.roles || []).some((role) => [ROLE.SUPER_ADMIN, ROLE.FACILITY_ADMIN, ROLE.CEO_OWNER].includes(role))
  const assignableRoles = canAssignAdminRoles
    ? ROLES
    : ROLES.filter((role) => ![ROLE.SUPER_ADMIN, ROLE.FACILITY_ADMIN, ROLE.CEO_OWNER].includes(role.slug))
  const [history, setHistory] = useState(null)
  const [suspending, setSuspending] = useState(null)
  const [draft, setDraft] = useState(null) // null = panel closed
  const [errors, setErrors] = useState({})

  const { data: staff } = useLiveQuery(() => repo.list('staff'), [repo])
  const { data: links } = useLiveQuery(() => repo.list('staff_roles'), [repo])
  const { data: branches } = useLiveQuery(() => repo.list('branches'), [repo])
  const { data: audit } = useLiveQuery(() => repo.list('audit_log'), [repo])

  usePageHeader(
    {
      title: 'Staff',
      subtitle: 'Team members and their roles',
      actions: !draft && <Button variant="primary" icon="plus" onClick={() => { setErrors({}); setDraft(emptyDraft()) }}>Add staff</Button>,
    },
    [!!draft],
  )

  const rolesByStaff = useMemo(() => {
    const map = new Map()
    for (const l of links || []) {
      if (!map.has(l.staffId)) map.set(l.staffId, [])
      map.get(l.staffId).push(l.role)
    }
    return map
  }, [links])

  const branchName = useMemo(() => {
    const m = new Map((branches || []).map((b) => [b.id, b.name]))
    return (id) => (id ? m.get(id) || '—' : 'All branches')
  }, [branches])

  const rows = useMemo(
    () => (staff || []).map((s) => ({ ...s, roles: rolesByStaff.get(s.id) || [] })),
    [staff, rolesByStaff],
  )

  const stats = useMemo(() => {
    const active = rows.filter((r) => r.active !== false).length
    const multi = rows.filter((r) => r.roles.length > 1).length
    const distinct = new Set((links || []).map((l) => l.role)).size
    return { total: rows.length, active, multi, distinct }
  }, [rows, links])

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }))

  async function save() {
    const next = {}
    if (!draft.firstName.trim() || !draft.surname.trim()) next.name = 'First name and surname are required'
    if (!emailRe.test(draft.email)) next.email = 'Enter a valid email'
    if (!draft.roleSlugs.length) next.roles = 'Pick at least one role'
    // Email must be unique across staff (skip the row being edited).
    if (!next.email) {
      const clash = await repo.findByIndex('staff', 'by_email', draft.email.trim().toLowerCase())
      if (clash && clash.id !== draft.id) next.email = 'Another staff member uses this email'
    }
    setErrors(next)
    if (Object.keys(next).length) return

    try {
      await repo.saveStaff({
        id: draft.id || undefined,
        name: [draft.firstName, draft.surname, draft.otherNames].filter(Boolean).join(' ').trim(),
        firstName: draft.firstName.trim(), surname: draft.surname.trim(), otherNames: draft.otherNames.trim(), profession: draft.profession.trim(),
        email: draft.email.trim().toLowerCase(),
        phone: draft.phone.trim(),
        branchId: draft.branchId || null,
        active: draft.active,
        roleSlugs: draft.roleSlugs,
        permGrants: draft.permGrants,
        permDenies: draft.permDenies,
        actorId: user.userId,
      })
      if (draft.pin) {
        if (!/^\d{4,6}$/.test(draft.pin)) throw new Error('The approval PIN must be 4 to 6 digits')
        const saved = draft.id || (await repo.findByIndex('staff', 'by_email', draft.email.trim().toLowerCase()))?.id
        if (saved) await repo.setStaffPin(saved, draft.pin)
      }
      toast.success(draft.id ? 'Staff member updated' : 'Staff member added')
      setDraft(null)
    } catch (err) {
      toast.error(err.message || 'Could not save staff member')
    }
  }

  async function toggleSuspend() {
    const row = suspending
    await repo.saveStaff({ id: row.id, roleSlugs: row.roles, active: row.active === false, actorId: user.userId, statusChange: row.active === false ? 'reactivated' : 'suspended' })
    toast.success(row.active === false ? `${row.name} can sign in again` : `${row.name} is suspended`)
    setSuspending(null)
  }

  async function resetPassword(row) {
    await repo.saveStaff({ id: row.id, roleSlugs: row.roles, passwordResetAt: new Date().toISOString(), actorId: user.userId, statusChange: 'password reset' })
    toast.info('Password reset recorded. The temporary password is issued by the server once it is connected.')
  }

  const roleUnion = useMemo(() => permissionsFor(draft?.roleSlugs || []), [draft?.roleSlugs])
  const toggle = (key, perm) => setDraft((d) => ({ ...d, [key]: d[key].includes(perm) ? d[key].filter((x) => x !== perm) : [...d[key], perm] }))
  const needsPin = draft && (roleUnion.has(PERM.PHARMACY_APPROVE) || draft.permGrants.includes(PERM.PHARMACY_APPROVE))

  return (
    <>
      <StatRow>
        <StatCard label="Team members" value={stats.total} />
        <StatCard label="Active" value={stats.active} />
        <StatCard label="Hold multiple roles" value={stats.multi} delta="union of permissions" deltaDir="flat" />
        <StatCard label="Distinct roles in use" value={stats.distinct} />
      </StatRow>

      {draft && (
        <div className="mt-3">
          <FormPanel
            title={draft.id ? 'Edit staff member' : 'Add staff member'}
            submitLabel={draft.id ? 'Save changes' : 'Add staff'}
            onClose={() => setDraft(null)}
            onSubmit={save}
          >
            <FormGrid>
              <Field label="First name" htmlFor="s-first" error={errors.name}><Input id="s-first" value={draft.firstName} onChange={(e) => set('firstName', e.target.value)} /></Field>
              <Field label="Surname" htmlFor="s-surname"><Input id="s-surname" value={draft.surname} onChange={(e) => set('surname', e.target.value)} /></Field>
              <Field label="Other names" htmlFor="s-other"><Input id="s-other" value={draft.otherNames} onChange={(e) => set('otherNames', e.target.value)} /></Field>
              <Field label="Professional title" htmlFor="s-profession" hint="For example doctor, nurse, pharmacist"><Input id="s-profession" value={draft.profession} onChange={(e) => set('profession', e.target.value)} placeholder="e.g. Doctor" /></Field>
              <Field label="Email" htmlFor="s-email" error={errors.email}>
                <Input id="s-email" type="email" value={draft.email} onChange={(e) => set('email', e.target.value)} placeholder="name@hospital.ng" />
              </Field>
              <Field label="Phone" htmlFor="s-phone">
                <Input id="s-phone" value={draft.phone} onChange={(e) => set('phone', e.target.value)} placeholder="080…" />
              </Field>
              <Field label="Branch" htmlFor="s-branch">
                <Select id="s-branch" value={draft.branchId || ''} onChange={(e) => set('branchId', e.target.value)}>
                  <option value="">All branches</option>
                  {(branches || []).map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Roles" span2 error={errors.roles} hint="Staff can hold several roles — access is the union of all of them.">
                <RoleChipPicker value={draft.roleSlugs} roles={assignableRoles} onChange={(slugs) => set('roleSlugs', slugs)} />
              </Field>
              {needsPin && (
                <Field label="Approval PIN" htmlFor="s-pin" span2 hint={draft.id ? 'Leave empty to keep the current PIN. 4 to 6 digits.' : '4 to 6 digits. Used to approve controlled drugs.'}>
                  <Input id="s-pin" type="password" inputMode="numeric" autoComplete="off" value={draft.pin} onChange={(e) => set('pin', e.target.value.replace(/\D/g, '').slice(0, 6))} />
                </Field>
              )}
              <Field label="Fine-tune access" span2 hint="Give this person extra actions, or take away actions their roles would normally allow.">
                <div className="perm-grid">
                  {PERM_GROUPS.map((g) => {
                    const items = canAssignAdminRoles ? g.items : g.items.filter(([perm]) => !ADMIN_ONLY_PERMS.has(perm))
                    if (!items.length) return null
                    return <div key={g.group} className="perm-group">
                      <div className="pg-title">{g.group}</div>
                      {items.map(([perm, label]) => {
                        const fromRole = roleUnion.has(perm)
                        const on = fromRole ? !draft.permDenies.includes(perm) : draft.permGrants.includes(perm)
                        return (
                          <label key={perm} className={`perm-row ${on ? 'on' : ''}`}>
                            <input type="checkbox" checked={on} onChange={() => toggle(fromRole ? 'permDenies' : 'permGrants', perm)} />
                            <span>{label}</span>
                            {fromRole ? <em>from role</em> : on ? <em>extra</em> : null}
                          </label>
                        )
                      })}
                    </div>
                  })}
                </div>
              </Field>
              <Field label="Status" span2>
                <Switch
                  checked={draft.active}
                  onChange={(on) => set('active', on)}
                  label={draft.active ? 'Active' : 'Inactive'}
                />
              </Field>
            </FormGrid>
          </FormPanel>
        </div>
      )}

      <Card className="mt-3">
        <CardHead title="Team" />
        <DataTable
          columns={[
            {
              key: 'name',
              header: 'Name',
              render: (r) => (
                <span className="row" style={{ gap: 10 }}>
                  <Avatar name={r.name} />
                  <span className="stack-tight">
                    <span className="cell-strong">{r.name}</span>
                    <span className="r-sub">{r.email}</span>
                  </span>
                </span>
              ),
            },
            { key: 'phone', header: 'Phone', render: (r) => r.phone || '—' },
            { key: 'branchId', header: 'Branch', render: (r) => branchName(r.branchId) },
            { key: 'roles', header: 'Roles', render: (r) => <RoleBadges roles={r.roles} /> },
            {
              key: 'status',
              header: 'Status',
              render: (r) => <Pill tone={r.active !== false ? 'active' : 'muted'}>{r.active !== false ? 'Active' : 'Inactive'}</Pill>,
            },
            {
              key: 'actions',
              header: '',
              align: 'num',
              render: (r) => (
                <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                  <Button variant="quiet" size="sm" onClick={() => setHistory(r)}>Activity</Button>
                  <Button
                    variant="quiet"
                    size="sm"
                    icon="edit"
                    aria-label={`Edit ${r.name}`}
                    onClick={() => { setErrors({}); setDraft({ id: r.id, firstName: r.firstName || r.name?.split(' ')[0] || '', surname: r.surname || r.name?.split(' ').slice(1, 2).join('') || '', otherNames: r.otherNames || r.name?.split(' ').slice(2).join(' ') || '', profession: r.profession || '', email: r.email, phone: r.phone || '', branchId: r.branchId || '', active: r.active !== false, roleSlugs: r.roles, permGrants: r.permGrants || [], permDenies: r.permDenies || [], pin: '' }) }}
                  />
                  {r.id !== user.userId && (
                    <Button variant={r.active === false ? 'ghost' : 'danger'} size="sm" onClick={() => setSuspending(r)}>{r.active === false ? 'Reactivate' : 'Suspend'}</Button>
                  )}
                </span>
              ),
            },
          ]}
          rows={rows}
          empty={<div className="empty-row">No staff yet. Add your first team member.</div>}
        />
      </Card>

      {history && (
        <Modal wide title={`Activity: ${history.name}`} onClose={() => setHistory(null)} labelledBy="hist-title" actions={
          <>
            <OnlineButton variant="ghost" onClick={() => resetPassword(history)}>Reset password</OnlineButton>
            <Button variant="primary" onClick={() => setHistory(null)}>Close</Button>
          </>
        }>
          <DataTable
            columns={[
              { key: 'at', header: 'When', render: (a) => formatDateTime(a.at) },
              { key: 'action', header: 'Action', render: (a) => a.action.replace('.', ' · ') },
              { key: 'ref', header: 'Details', render: (a) => a.ref || '' },
            ]}
            rows={(audit || []).filter((a) => a.actorId === history.id).sort((x, y) => new Date(y.at) - new Date(x.at)).slice(0, 30)}
            empty={<div className="empty-row">No activity recorded yet.</div>}
          />
        </Modal>
      )}

      {suspending && (
        <ConfirmDialog
          destructive={suspending.active !== false}
          title={suspending.active === false ? `Reactivate ${suspending.name}?` : `Suspend ${suspending.name}?`}
          message={suspending.active === false ? 'They will be able to sign in again.' : 'They are signed out of new sessions straight away. Their account and records stay in place.'}
          confirmLabel={suspending.active === false ? 'Reactivate' : 'Suspend'}
          onConfirm={toggleSuspend}
          onCancel={() => setSuspending(null)}
        />
      )}
    </>
  )
}
