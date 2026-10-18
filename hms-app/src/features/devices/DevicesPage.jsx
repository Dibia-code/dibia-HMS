import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { useRepo, useSyncEngine } from '@/data/RepositoryContext'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import { useToast, usePageHeader, Card, CardHead, DataTable, Field, Input, Pill, ConfirmDialog, OnlineButton } from '@/components'
import { newToken } from '@/lib/ids'
import { uuid } from '@/lib/id'
import { formatDateTime } from '@/lib/format'
import { getDB } from '@/data/db'
import { apiBase } from '@/lib/apiBase'

const backendAuthEnabled = () => import.meta.env.PROD || import.meta.env.VITE_HMS_BACKEND_AUTH === 'true'

const STATUS = {
  invited: { label: 'Invited', tone: 'inactive' },
  pending: { label: 'Waiting for approval', tone: 'pending' },
  approved: { label: 'Approved', tone: 'active' },
  rejected: { label: 'Rejected', tone: 'failed' },
  revoked: { label: 'Revoked', tone: 'failed' },
}

export default function DevicesPage() {
  const { user } = useAuth()
  const repo = useRepo()
  const sync = useSyncEngine()
  const toast = useToast()
  const { data: devices } = useLiveQuery(() => repo.list('devices'), [repo])
  const { data: staff } = useLiveQuery(() => repo.list('staff'), [repo])
  const [backendDevices, setBackendDevices] = useState(null)
  const [backendError, setBackendError] = useState('')
  const migrated = useRef(new Set())
  const [name, setName] = useState('')
  const [assignedStaffId, setAssignedStaffId] = useState('')
  const [revoking, setRevoking] = useState(null)
  const [deleting, setDeleting] = useState(null)

  usePageHeader({ title: 'Devices', subtitle: 'Approve which phones and computers can use this hospital account' }, [])

  const appOrigin = () => String(import.meta.env.VITE_HMS_PUBLIC_URL || window.location.origin).replace(/\/$/, '')
  useEffect(() => {
    if (!backendAuthEnabled()) return undefined
    let active = true
    const refresh = async () => {
      try {
        const response = await sync.remote.request(`${apiBase()}/devices`, { credentials: 'include', headers: {} })
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(result.message || 'Could not load devices')
        if (active) {
          setBackendDevices(result.devices || [])
          setBackendError('')
        }
      } catch (error) {
        if (active) setBackendError(error.message || 'Could not load devices')
      }
    }
    refresh()
    const timer = window.setInterval(refresh, 2000)
    return () => { active = false; window.clearInterval(timer) }
  }, [sync])

  useEffect(() => {
    if (!backendAuthEnabled() || !devices) return
    for (const device of devices) {
      if (device.status !== 'invited' || migrated.current.has(device.id)) continue
      migrated.current.add(device.id)
      sync.remote.request(`${apiBase()}/devices/invite`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: device.id, name: device.name, token: device.token }),
      }).then(async (response) => {
        if (!response.ok) return
        const db = await getDB()
        const queued = (await db.getAll('outbox')).filter((entry) => entry.entity === 'devices' && entry.recordId === device.id)
        if (!queued.length) return
        const tx = db.transaction('outbox', 'readwrite')
        for (const entry of queued) await tx.objectStore('outbox').delete(entry.seq)
        await tx.done
        await sync.refreshPending()
      }).catch(() => {})
    }
  }, [devices, sync])

  const deviceRows = backendAuthEnabled() ? backendDevices || [] : devices || []

  async function invite() {
    if (!name.trim()) return
    const id = uuid()
    const token = newToken()
    if (backendAuthEnabled()) {
      try {
        const response = await sync.remote.request(`${apiBase()}/devices/invite`, {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name: name.trim(), token, assignedStaffId }),
        })
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(result.message || 'Could not save the access link to the backend')
        setBackendDevices((previous) => [...(previous || []), result.device])
      } catch (error) {
        toast.error(error.message || 'Could not save the access link to the backend')
        return
      }
    } else {
      await repo.create('devices', { id, name: name.trim(), token, status: 'invited', createdBy: user.userId })
      await repo.create('audit_log', { action: 'device.invited', ref: name.trim(), actorId: user.userId, at: new Date().toISOString() })
    }
    setName('')
    setAssignedStaffId('')
    toast.success('Access link created')
  }

  async function setStatus(d, status, action) {
    if (backendAuthEnabled()) {
      try {
        const response = await sync.remote.request(`${apiBase()}/devices/${encodeURIComponent(d.id)}`, {
          method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        })
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(result.message || 'Could not update device status')
        setBackendDevices((previous) => (previous || []).map((row) => row.id === d.id ? result.device : row))
      } catch (error) {
        toast.error(error.message || 'Could not update device status')
      }
      return
    }
    await repo.update('devices', d.id, { status, decidedBy: user.userId, decidedAt: new Date().toISOString() })
    await repo.create('audit_log', { action, ref: d.name, actorId: user.userId, at: new Date().toISOString(), before: { status: d.status }, after: { status } })
  }

  async function copy(d) {
    let target = ''
    try {
      let token = d.token
      if (backendAuthEnabled()) {
        const response = await sync.remote.request(`${apiBase()}/devices/${encodeURIComponent(d.id)}/link`, {
          method: 'POST', credentials: 'include', headers: {},
        })
        const result = await response.json().catch(() => ({}))
        if (!response.ok || !result.token) throw new Error(result.message || 'Could not create a valid device link')
        token = result.token
        setBackendDevices((previous) => (previous || []).map((row) => row.id === d.id ? { ...row, ...(result.device || {}), token } : row))
      }
      if (!token) throw new Error('Could not create a valid device link')
      target = `${appOrigin()}/device/join?token=${encodeURIComponent(token)}`
      try {
        await navigator.clipboard.writeText(target)
        toast.success('Link copied')
      } catch {
        toast.info(target)
      }
    } catch (error) {
      toast.error(error.message || 'Could not copy the device link')
    }
  }

  async function deleteDevice(d) {
    if (backendAuthEnabled()) {
      try {
        const response = await sync.remote.request(`${apiBase()}/devices/${encodeURIComponent(d.id)}`, {
          method: 'DELETE', credentials: 'include', headers: {},
        })
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(result.message || 'Could not delete the device link')
        setBackendDevices((previous) => (previous || []).filter((row) => row.id !== d.id))
      } catch (error) {
        toast.error(error.message || 'Could not delete the device link')
        return
      }
    } else {
      await repo.remove('devices', d.id)
      await repo.create('audit_log', { action: 'device.deleted', ref: d.name, actorId: user.userId, at: new Date().toISOString() })
    }
    toast.success('Device link deleted')
  }

  return (
    <>
      <Card className="mb-3">
        <CardHead title="Create a device access link" />
        <div className="text-muted mb-2">Each invitation is assigned to one staff sign-in account and binds to the first computer that requests access. Only that approved computer can use the account.</div>
        <div className="row wrap" style={{ alignItems: 'flex-end' }}>
          <Field label="Device name" htmlFor="dv-name" hint="For example Front desk tablet">
            <Input id="dv-name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && invite()} />
          </Field>
          <Field label="Staff account" htmlFor="dv-staff">
            <Select id="dv-staff" value={assignedStaffId} onChange={(e) => setAssignedStaffId(e.target.value)}>
              <option value="">Choose a staff account</option>
              {(staff || []).filter((row) => row.active !== false && row.email).map((row) => <option key={row.id} value={row.id}>{row.name} ({row.email})</option>)}
            </Select>
          </Field>
          <OnlineButton variant="primary" onClick={invite} disabled={!name.trim() || !assignedStaffId}>Create link</OnlineButton>
        </div>
        <div className="text-muted mt-2">The staff member opens the link on the computer they will use. Once they request access, approve that computer here. Revoke blocks it immediately; approve can restore a revoked computer.</div>
      </Card>

      {backendError && <div className="lock-note" role="status">Device status could not refresh: {backendError}</div>}

      <Card>
        <DataTable
          columns={[
            { key: 'n', header: 'Device', render: (d) => (<div><div className="cell-strong">{d.name}</div><div className="cell-sub">{d.assignedStaffName ? `For ${d.assignedStaffName}${d.assignedStaffEmail ? ` · ${d.assignedStaffEmail}` : ''}` : 'No staff account assigned'}{d.requestedName ? ` · Requested as ${d.requestedName}` : ` · Created ${formatDateTime(d.createdAt)}`}</div></div>) },
            { key: 's', header: 'Status', render: (d) => <Pill tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Pill> },
            {
              key: 'a', header: '',
              render: (d) => (
                <span className="row" style={{ gap: 6 }}>
                  {d.status === 'invited' && <><OnlineButton size="sm" variant="ghost" onClick={() => copy(d)}>Copy link</OnlineButton><OnlineButton size="sm" variant="danger" onClick={() => setDeleting(d)}>Delete</OnlineButton></>}
                  {d.status === 'pending' && <><OnlineButton size="sm" variant="primary" onClick={() => setStatus(d, 'approved', 'device.approved')}>Approve</OnlineButton><OnlineButton size="sm" variant="danger" onClick={() => setStatus(d, 'rejected', 'device.rejected')}>Reject</OnlineButton><OnlineButton size="sm" variant="ghost" onClick={() => copy(d)}>Copy link</OnlineButton></>}
                  {d.status === 'approved' && <><OnlineButton size="sm" variant="ghost" onClick={() => copy(d)}>Copy link</OnlineButton><OnlineButton size="sm" variant="danger" onClick={() => setRevoking(d)}>Revoke</OnlineButton></>}
                  {d.status === 'revoked' && <><OnlineButton size="sm" variant="primary" onClick={() => setStatus(d, 'approved', 'device.approved')}>Approve</OnlineButton><OnlineButton size="sm" variant="ghost" onClick={() => copy(d)}>Copy link</OnlineButton></>}
                </span>
              ),
            },
          ]}
          rows={deviceRows.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))}
          empty={<div className="empty-row">No devices yet.</div>}
        />
      </Card>

      {revoking && (
        <ConfirmDialog
          destructive
          title={`Revoke ${revoking.name}?`}
          message="This device can no longer sign in to this hospital."
          confirmLabel="Revoke"
          onConfirm={async () => { await setStatus(revoking, 'revoked', 'device.revoked'); setRevoking(null) }}
          onCancel={() => setRevoking(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          destructive
          title={`Delete ${deleting.name}?`}
          message="This removes the invitation and makes its access link invalid."
          confirmLabel="Delete link"
          onConfirm={async () => { await deleteDevice(deleting); setDeleting(null) }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  )
}
