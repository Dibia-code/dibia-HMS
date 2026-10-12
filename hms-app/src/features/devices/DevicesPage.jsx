import { useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { useRepo } from '@/data/RepositoryContext'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import { useToast, usePageHeader, Card, CardHead, DataTable, Field, Input, Pill, ConfirmDialog, OnlineButton } from '@/components'
import { newToken } from '@/lib/ids'
import { formatDateTime } from '@/lib/format'

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
  const toast = useToast()
  const { data: devices } = useLiveQuery(() => repo.list('devices'), [repo])
  const [name, setName] = useState('')
  const [revoking, setRevoking] = useState(null)

  usePageHeader({ title: 'Devices', subtitle: 'Approve which phones and computers can use this hospital account' }, [])

  const link = (d) => `${window.location.origin}/device/join?token=${d.token}`

  async function invite() {
    if (!name.trim()) return
    await repo.create('devices', { name: name.trim(), token: newToken(), status: 'invited', createdBy: user.userId })
    await repo.create('audit_log', { action: 'device.invited', ref: name.trim(), actorId: user.userId, at: new Date().toISOString() })
    setName('')
    toast.success('Access link created')
  }

  async function setStatus(d, status, action) {
    await repo.update('devices', d.id, { status, decidedBy: user.userId, decidedAt: new Date().toISOString() })
    await repo.create('audit_log', { action, ref: d.name, actorId: user.userId, at: new Date().toISOString(), before: { status: d.status }, after: { status } })
  }

  async function copy(d) {
    try {
      await navigator.clipboard.writeText(link(d))
      toast.success('Link copied')
    } catch {
      toast.info(link(d))
    }
  }

  return (
    <>
      <Card className="mb-3">
        <CardHead title="Create a device access link" />
        <div className="row wrap" style={{ alignItems: 'flex-end' }}>
          <Field label="Device name" htmlFor="dv-name" hint="For example Front desk tablet">
            <Input id="dv-name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && invite()} />
          </Field>
          <OnlineButton variant="primary" onClick={invite} disabled={!name.trim()}>Create link</OnlineButton>
        </div>
        <div className="text-muted mt-2">Send the link to the person setting up the device. They ask for access, and you approve it here. Turn on Require approval for devices in Settings to enforce it at sign in.</div>
      </Card>

      <Card>
        <DataTable
          columns={[
            { key: 'n', header: 'Device', render: (d) => (<div><div className="cell-strong">{d.name}</div><div className="cell-sub">{d.requestedName ? `Requested as ${d.requestedName}` : `Created ${formatDateTime(d.createdAt)}`}</div></div>) },
            { key: 's', header: 'Status', render: (d) => <Pill tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Pill> },
            {
              key: 'a', header: '',
              render: (d) => (
                <span className="row" style={{ gap: 6 }}>
                  {d.status === 'invited' && <OnlineButton size="sm" variant="ghost" onClick={() => copy(d)}>Copy link</OnlineButton>}
                  {d.status === 'pending' && <><OnlineButton size="sm" variant="primary" onClick={() => setStatus(d, 'approved', 'device.approved')}>Approve</OnlineButton><OnlineButton size="sm" variant="danger" onClick={() => setStatus(d, 'rejected', 'device.rejected')}>Reject</OnlineButton></>}
                  {d.status === 'approved' && <OnlineButton size="sm" variant="danger" onClick={() => setRevoking(d)}>Revoke</OnlineButton>}
                </span>
              ),
            },
          ]}
          rows={(devices || []).slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))}
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
    </>
  )
}
