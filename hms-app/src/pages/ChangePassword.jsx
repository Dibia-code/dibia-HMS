import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { Button, Field, Input, useToast } from '@/components'
import { apiBase } from '@/lib/apiBase'
import { useSyncEngine } from '@/data/RepositoryContext'

export default function ChangePassword() {
  const { user, isAuthed, restoring, updateSession, landingPath } = useAuth()
  const sync = useSyncEngine()
  const navigate = useNavigate()
  const toast = useToast()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const home = `/${user?.hospitalSlug || ''}/${landingPath()}`

  useEffect(() => {
    if (!restoring && !isAuthed) navigate('/login', { replace: true })
    if (isAuthed && !user?.mustChangePassword) navigate(home, { replace: true })
  }, [home, isAuthed, navigate, restoring, user?.mustChangePassword])

  async function submit(event) {
    event.preventDefault()
    setError('')
    if (password.length < 12) return setError('Use at least 12 characters for your new password.')
    if (password !== confirm) return setError('The passwords do not match.')
    setBusy(true)
    try {
      const response = await sync.remote.request(`${apiBase()}/auth/password/change`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message || 'Could not change your password.')
      let moduleCodes = user?.moduleCodes || []
      const modulesResponse = await sync.remote.request(`${apiBase()}/tenant/modules`, { credentials: 'include', headers: {} })
      const modules = await modulesResponse.json().catch(() => ({}))
      if (modulesResponse.ok) moduleCodes = (modules.modules || []).filter((module) => module.entitlementStatus === 'entitled' && module.activationStatus === 'enabled').map((module) => module.code)
      updateSession({ mustChangePassword: false, passwordChangeSkipped: false, moduleCodes })
      toast.success('Your new password is active. The temporary password no longer works.')
      navigate(home, { replace: true })
    } catch (cause) {
      setError(cause.message || 'Could not change your password.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand"><span className="name">Dibia</span></div>
        <h1>Set your own password</h1>
        <div className="sub">Your administrator gave you a temporary password. Choose a new one now; the temporary password will stop working.</div>
        <form onSubmit={submit}>
          <Field label="New password" htmlFor="staff-new-password"><Input id="staff-new-password" type="password" autoComplete="new-password" required minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
          <Field label="Confirm new password" htmlFor="staff-confirm-password"><Input id="staff-confirm-password" type="password" autoComplete="new-password" required minLength={12} value={confirm} onChange={(event) => setConfirm(event.target.value)} /></Field>
          {error && <div role="alert" style={{ color: 'var(--critical)', fontSize: 13, marginBottom: 12 }}>{error}</div>}
          <Button type="submit" variant="primary" size="lg" block disabled={busy}>{busy ? 'Saving...' : 'Change password'}</Button>
        </form>
        <Button variant="quiet" block onClick={() => { updateSession({ passwordChangeSkipped: true }); navigate(home, { replace: true }) }}>Change later</Button>
      </div>
    </div>
  )
}
