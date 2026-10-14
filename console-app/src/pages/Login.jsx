import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { Icon } from '@/components'
import { apiBase } from '@/lib/apiBase'
import LegalFooter from '@/components/LegalFooter'

// Dibia Super Admin sign-in. Production credentials are checked by the backend.
export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = location.state?.from?.pathname || '/overview'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [resetMode, setResetMode] = useState(false)
  const [busy, setBusy] = useState(false)
  const canResetPassword = import.meta.env.PROD || import.meta.env.VITE_CONSOLE_BACKEND_AUTH === 'true'

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    setNotice('')
    setBusy(true)
    try {
      if (resetMode) {
        const response = await fetch(`${apiBase()}/auth/console/forgot-password`, {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        })
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(result.message || 'Password reset is temporarily unavailable.')
        setNotice(result.message || 'If an account exists for that email, Firebase will send a password reset link.')
      } else {
        await login(email, password)
        navigate(from, { replace: true })
      }
    } catch (err) {
      setError(err.message || 'Could not sign in')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="mark"><Icon name="star" size={22} /></div>
        <div className="login-title">Dibia HMS Super Admin</div>
        <div className="login-sub">Internal access only</div>

        <div className="field">
          <label htmlFor="email">Admin email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            placeholder="admin@dibia.app"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        {!resetMode && <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required={!resetMode}
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>}

        {error && <div className="login-error">{error}</div>}
        {notice && <div className="login-note" role="status">{notice}</div>}

        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? (resetMode ? 'Sending…' : 'Signing in…') : (resetMode ? 'Send reset link' : 'Sign in')}
        </button>
        {canResetPassword && <button type="button" className="login-reset-toggle" onClick={() => { setResetMode((value) => !value); setError(''); setNotice('') }}>
          {resetMode ? 'Back to sign in' : 'Forgot password?'}
        </button>}

        <div className="login-note">
          Manage hospital registrations, subscriptions and support for the Dibia HMS network.
        </div>
      </form>
      <LegalFooter className="login-legal-footer" />
    </div>
  )
}
