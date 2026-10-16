import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiBase } from '@/lib/apiBase'

export default function PasswordReset() {
  const navigate = useNavigate()
  const link = useMemo(() => {
    const params = new URLSearchParams(window.location.hash.slice(1))
    return { token: params.get('type') === 'recovery' ? params.get('access_token') || '' : '', error: params.get('error_description') || '' }
  }, [])
  const { token, error: linkError } = link
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(linkError || (!token ? 'This reset link is missing or expired. Request a new one.' : ''))
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setError('')
    if (!token) return setError('This reset link is invalid or expired. Request a new one.')
    if (password.length < 12) return setError('Choose a password with at least 12 characters.')
    if (password !== confirm) return setError('The passwords do not match.')
    setBusy(true)
    try {
      const response = await fetch(`${apiBase()}/auth/password/update`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ password }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message || 'Password could not be updated.')
      window.history.replaceState({}, document.title, `${window.location.pathname}`)
      setNotice('Your password has been updated. Sign in with your new password.')
      window.setTimeout(() => navigate('/login', { replace: true }), 1800)
    } catch (cause) {
      setError(cause.message || 'Password could not be updated. Request a new reset link.')
    } finally { setBusy(false) }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-title">Choose a new password</div>
        <div className="login-sub">Set a new password for your Dibia console account.</div>
        <div className="field"><label htmlFor="new-password">New password</label><input id="new-password" type="password" autoComplete="new-password" required minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} /></div>
        <div className="field"><label htmlFor="confirm-password">Confirm new password</label><input id="confirm-password" type="password" autoComplete="new-password" required minLength={12} value={confirm} onChange={(event) => setConfirm(event.target.value)} /></div>
        {error && <div className="login-error" role="alert">{error}</div>}
        {notice && <div className="login-note" role="status">{notice}</div>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy || !token}>{busy ? 'Updating…' : 'Update password'}</button>
        <div className="login-note"><Link to="/login">Back to sign in</Link></div>
      </form>
    </div>
  )
}
