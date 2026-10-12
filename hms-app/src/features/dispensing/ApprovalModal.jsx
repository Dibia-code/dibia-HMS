import { useState } from 'react'
import { useRepo } from '@/data/RepositoryContext'
import { Modal, Button, Field, Input } from '@/components'

export function ApprovalModal({ title, items, needReason, onApproved, onCancel }) {
  const repo = useRepo()
  const [pin, setPin] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function confirm() {
    if (needReason && reason.trim().length < 3) return setError('A reason is required')
    setBusy(true)
    setError('')
    try {
      const approver = await repo.verifyApprover(pin.trim())
      if (!approver) {
        setError('That PIN does not belong to a pharmacist on this hospital')
        return
      }
      onApproved({ approver, reason: reason.trim() })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={title}
      onClose={onCancel}
      labelledBy="approval-title"
      actions={
        <>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={confirm} disabled={busy || pin.length < 4}>Approve</Button>
        </>
      }
    >
      <ul className="approval-list">
        {items.map((it, i) => (
          <li key={i} className={it.kind === 'interaction' || it.kind === 'allergy' ? 'magenta' : it.kind === 'expired' ? 'red' : 'amber'}>
            {it.text}
          </li>
        ))}
      </ul>
      <div className="stack-gap mt-2">
        {needReason && (
          <Field label="Reason for going ahead" htmlFor="ap-reason" required>
            <Input id="ap-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
        <Field label="Pharmacist PIN" htmlFor="ap-pin" error={error} required>
          <Input
            id="ap-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setError('') }}
            onKeyDown={(e) => e.key === 'Enter' && pin.length >= 4 && confirm()}
          />
        </Field>
      </div>
    </Modal>
  )
}
