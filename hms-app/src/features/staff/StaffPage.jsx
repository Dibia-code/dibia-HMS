import { useMemo, useState } from 'react'
import { useRepo, useSyncEngine } from '@/data/RepositoryContext'
import { useAuth } from '@/auth/AuthContext'
import { permissionsFor, PERM } from '@/auth/permissions'
import { ROLE, ROLES } from '@/auth/roles'
import { PERM_GROUPS } from '@/auth/permLabels'
import { formatDateTime } from '@/lib/format'
import { apiBase } from '@/lib/apiBase'
import { useToast, Modal, ConfirmDialog, OnlineButton } from '@/components'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import {
  usePageHeader, Card, CardHead, Button, StatRow, StatCard, DataTable,
  Avatar, RoleBadges, Pill, FormPanel, FormGrid, Field, Input, Select, Switch, RoleChipPicker,
} from '@/components'

const emptyDraft = () => ({ id: null, firstName: '', surname: '', otherNames: '', profession: '', email: '', phone: '', branchId: '', active: true, roleSlugs: [], permGrants: [], permDenies: [], pin: '', accessCode: '', needsAccount: false, createDeviceLink: false, deviceName: '' })
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const backendAuthEnabled = () => import.meta.env.PROD || import.meta.env.VITE_HMS_BACKEND_AUTH === 'true'
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
  const sync = useSyncEngine()
  const toast = useToast()
  const { user } = useAuth()
  const canAssignAdminRoles = (user?.roles || []).some((role) => [ROLE.SUPER_ADMIN, ROLE.FACILITY_ADMIN, ROLE.CEO_OWNER].includes(role))
  const assignableRoles = canAssignAdminRoles
    ? ROLES
    : ROLES.filter((role) => ![ROLE.SUPER_ADMIN, ROLE.FACILITY_ADMIN, ROLE.CEO_OWNER].includes(role.slug))
  const [history, setHistory] = useState(null)
  const [newDeviceLink, setNewDeviceLink] = useState('')
  const [suspending, setSuspending] = useState(null)
  const [deletingStaff, setDeletingStaff] = useState(null)
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
    const needsAccount = backendAuthEnabled() && (!draft.id || draft.needsAccount)
    if (!draft.firstName.trim() || !draft.surname.trim()) next.name = 'First name and surname are required'
    if (!emailRe.test(draft.email)) next.email = 'Enter a valid email'
    if (!draft.roleSlugs.length) next.roles = 'Pick at least one role'
    if (needsAccount && draft.accessCode.length < 12) next.accessCode = 'Use an access code with at least 12 characters'
    if (needsAccount && draft.createDeviceLink && !draft.deviceName.trim()) next.deviceName = 'Enter a name for this computer'
    // Email must be unique across staff (skip the row being edited).
    if (!next.email) {
      const clash = await repo.findByIndex('staff', 'by_email', draft.email.trim().toLowerCase())
      if (clash && clash.id !== draft.id) next.email = 'Another staff member uses this email'
    }
    setErrors(next)
    if (Object.keys(next).length) return

    let savedStaff
    try {
      savedStaff = await repo.saveStaff({
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
      if (needsAccount) {
        const roles = await repo.listByIndex('staff_roles', 'by_staff', savedStaff.id)
        const response = await sync.remote.request(`${apiBase()}/staff/${encodeURIComponent(savedStaff.id)}/access-code`, {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessCode: draft.accessCode, staff: savedStaff, roles, createDeviceLink: draft.createDeviceLink, deviceName: draft.deviceName }),
        })
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(result.message || 'Could not create the staff sign-in account')
        if (result.deviceInvitation?.token) {
          const origin = String(import.meta.env.VITE_HMS_PUBLIC_URL || window.location.origin).replace(/\/$/, '')
          setNewDeviceLink(`${origin}/device/join?token=${encodeURIComponent(result.deviceInvitation.token)}`)
        }
      } else if (draft.id && backendAuthEnabled() && savedStaff.authUserId) {
        const roles = await repo.listByIndex('staff_roles', 'by_staff', savedStaff.id)
        const response = await sync.remote.request(`${apiBase()}/staff/${encodeURIComponent(savedStaff.id)}/access`, {
          method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roles, permGrants: savedStaff.permGrants || [], permDenies: savedStaff.permDenies || [] }),
        })
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(result.message || 'Could not update staff access')
      }
      if (draft.pin) {
        if (!/^\d{4,6}$/.test(draft.pin)) throw new Error('The approval PIN must be 4 to 6 digits')
        const saved = draft.id || (await repo.findByIndex('staff', 'by_email', draft.email.trim().toLowerCase()))?.id
        if (saved) await repo.setStaffPin(saved, draft.pin)
      }
      toast.success(draft.id ? 'Staff member updated' : 'Staff member added')
      setDraft(null)
    } catch (err) {
      if (savedStaff && needsAccount) setDraft((current) => ({ ...current, id: savedStaff.id, needsAccount: true }))
      toast.error(err.message || 'Could not save staff member')
    }
  }

  async function toggleSuspend() {
    const row = suspending
    await repo.saveStaff({ id: row.id, roleSlugs: row.roles, active: row.active === false, actorId: user.userId, statusChange: row.active === false ? 'reactivated' : 'suspended' })
    toast.success(row.active === false ? `${row.name} can sign in again` : `${row.name} is suspended`)
    setSuspending(null)
  }

  async function deleteStaff() {
    const row = deletingStaff
    if (!row) return
    try {
      await repo.removeStaff(row.id, user.userId)
      toast.success(`${row.name} removed from staff`)
      setDeletingStaff(null)
    } catch (error) {
      toast.error(error.message || 'Could not remove this staff member')
    }
  }

  async function resetPassword(row) {
    if (!backendAuthEnabled()) {
      toast.info('Password reset is unavailable right now. No password was changed.')
      return
    }
    try {
      const response = await sync.remote.request(`${apiBase()}/staff/${encodeURIComponent(row.id)}/password-reset`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message || 'Could not send the password reset email')
      toast.success(result.message || `Password reset email sent to ${row.email}`)
    } catch (err) {
      toast.error(err.message || 'Could not send the password reset email')
    }
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
              {backendAuthEnabled() && (!draft.id || draft.needsAccount) && (
                <Field label="Temporary access code" htmlFor="s-access-code" span2 error={errors.accessCode} hint="Staff use this with their email to sign in. Use at least 12 characters; they can change it with Forgot password.">
                  <Input id="s-access-code" type="password" autoComplete="new-password" value={draft.accessCode} onChange={(e) => set('accessCode', e.target.value)} />
                </Field>
              )}
              {backendAuthEnabled() && !draft.id && (
                <Field label="Device access" span2 hint="Create a link that is bound to the first computer that requests access. The staff member can sign in only from that approved computer.">
                  <Switch checked={draft.createDeviceLink} onChange={(checked) => set('createDeviceLink', checked)} label="Require an approved computer for this staff account" />
                </Field>
              )}
              {backendAuthEnabled() && !draft.id && draft.createDeviceLink && (
                <Field label="Computer name" htmlFor="s-device-name" span2 error={errors.deviceName}>
                  <Input id="s-device-name" value={draft.deviceName} onChange={(event) => set('deviceName', event.target.value)} placeholder="For example, Nurse Ada's workstation" />
                </Field>
              )}
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
                    onClick={() => { setErrors({}); setDraft({ id: r.id, firstName: r.firstName || r.name?.split(' ')[0] || '', surname: r.surname || r.name?.split(' ').slice(1, 2).join('') || '', otherNames: r.otherNames || r.name?.split(' ').slice(2).join(' ') || '', profession: r.profession || '', email: r.email, phone: r.phone || '', branchId: r.branchId || '', active: r.active !== false, roleSlugs: r.roles, permGrants: r.permGrants || [], permDenies: r.permDenies || [], pin: '', accessCode: '', needsAccount: false }) }}
                  />
                  {r.id !== user.userId && (
                    <>
                      <Button variant={r.active === false ? 'ghost' : 'danger'} size="sm" onClick={() => setSuspending(r)}>{r.active === false ? 'Reactivate' : 'Suspend'}</Button>
                      <Button variant="danger" size="sm" onClick={() => setDeletingStaff(r)}>Delete</Button>
                    </>
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

      {newDeviceLink && (
        <Modal title="Staff device link" onClose={() => setNewDeviceLink('')} labelledBy="staff-device-link-title" actions={
          <>
            <Button variant="quiet" onClick={() => setNewDeviceLink('')}>Close</Button>
            <Button variant="primary" onClick={async () => { try { await navigator.clipboard.writeText(newDeviceLink); toast.success('Device link copied') } catch { toast.info(newDeviceLink) } }}>Copy link</Button>
          </>
        }>
          <p>Send this link to the staff member. They must open it on the computer they will use, then wait for you to approve it in Devices.</p>
          <Input aria-label="Staff device link" readOnly value={newDeviceLink} onFocus={(event) => event.target.select()} />
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
      {deletingStaff && (
        <ConfirmDialog
          destructive
          title={`Delete ${deletingStaff.name}?`}
          message="This removes them from the staff list and disables their hospital sign-in. Their past clinical and payment records are retained. This cannot be undone."
          confirmLabel="Delete staff"
          onConfirm={deleteStaff}
          onCancel={() => setDeletingStaff(null)}
        />
      )}
    </>
  )
}
