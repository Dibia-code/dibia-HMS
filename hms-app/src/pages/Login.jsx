import { useEffect, useState } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { permissionsFor, landingPath } from '@/auth/permissions'
import { Button, Field, Input, Modal, useToast } from '@/components'
import { Icon } from '@/components/Icon'
import LegalFooter from '@/components/LegalFooter'
import { apiBase } from '@/lib/apiBase'

const DEMO = [
  { email: 'admin@demohospital.ng', name: 'Ifeoma Nwachukwu', note: 'Demo Hospital, Hospital Admin' },
  { email: 'reception@demohospital.ng', name: 'Amaka Obi', note: 'Demo Hospital, Receptionist' },
  { email: 'cashier@demohospital.ng', name: 'Bola Adeyemi', note: 'Demo Hospital, Cashier' },
  { email: 'pharmacy@demohospital.ng', name: 'Chuka Eze', note: 'Demo Hospital, Pharmacist' },
]
const backendAuthEnabled = () => import.meta.env.PROD || import.meta.env.VITE_HMS_BACKEND_AUTH === 'true'

export default function Login() {
  const { login, isAuthed, user, landingPath: currentLanding } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [forgot, setForgot] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetError, setResetError] = useState('')
  const [resetNotice, setResetNotice] = useState('')
  const [resetBusy, setResetBusy] = useState(false)
  const hospital = (() => {
    try { return JSON.parse(localStorage.getItem('dibia.hospital') || localStorage.getItem('dibia.facility') || 'null') } catch { return null }
  })()

  // Already signed in? Skip the form.
  useEffect(() => {
    if (isAuthed && user?.hospitalSlug) {
      if (user.mustChangePassword && !user.passwordChangeSkipped) {
        navigate('/change-password', { replace: true })
        return
      }
      navigate(`/${user.hospitalSlug}/${currentLanding()}`, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthed])

  async function submit(nextEmail) {
    const em = (nextEmail ?? email).trim().toLowerCase()
    if (!em) {
      setError('Enter your phone number or email')
      return
    }
    setBusy(true)
    setError('')
    try {
      const session = await login(em, password)
      if (session.mustChangePassword) {
        navigate('/change-password', { replace: true })
        return
      }
      const perms = permissionsFor(session.roles)
      const landing = landingPath(perms)
      const from = location.state?.from?.pathname
      const dest =
        from && from.startsWith(`/${session.hospitalSlug}`)
          ? from
          : `/${session.hospitalSlug}/${landing}`
      toast.success(`Welcome back, ${session.name.split(' ')[0]}`)
      navigate(dest, { replace: true })
    } catch (err) {
      if (err.code === 'REGISTRATION_PENDING') {
        navigate('/approval-pending', { replace: true, state: { email: em } })
        return
      }
      setError(err.message || 'Could not sign in')
    } finally {
      setBusy(false)
    }
  }

  async function sendPasswordReset() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resetEmail.trim())) {
      setResetError('Enter the email address on your staff account.')
      return
    }
    setResetBusy(true)
    setResetError('')
    setResetNotice('')
    try {
      const response = await fetch(`${apiBase()}/auth/forgot-password`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail.trim().toLowerCase() }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message || 'Password reset is temporarily unavailable.')
      setResetNotice(result.message || 'If an account exists for that email, a password reset link will be sent.')
    } catch (err) {
      setResetError(err.message || 'Password reset is temporarily unavailable.')
    } finally {
      setResetBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand">
          <span className="mark">
            <Icon name="activity" size={20} />
          </span>
          <span className="name">Dibia</span>
        </div>
        <h1>Sign in</h1>
        <div className="sub">{hospital?.name ? hospital.name : 'Hospital management that keeps working offline.'}</div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <Field label="Phone number or email" htmlFor="email" error={error}>
            <Input
              id="email"
              type="text"
              inputMode="email"
              autoComplete="username"
              placeholder="0803 000 0000 or you@hospital.ng"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label={backendAuthEnabled() ? 'Access code or password' : 'Password or PIN'} htmlFor="password" hint={backendAuthEnabled() ? 'New staff use the temporary access code from their admin. Change it with Forgot password.' : 'Use any password or PIN in this preview.'}>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder={backendAuthEnabled() ? 'Access code or password' : 'Password or PIN'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <div style={{ textAlign: 'right', marginTop: -6, marginBottom: 12 }}>
            <Button type="button" variant="quiet" size="sm" onClick={() => { setResetEmail(email.includes('@') ? email.trim() : ''); setResetError(''); setResetNotice(''); setForgot(true) }}>Forgot your password or PIN?</Button>
          </div>
          <Button variant="primary" size="lg" type="submit" block disabled={busy}>
            {busy ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>

        {hospital && (
          <div className="addr">
            <b>{hospital.name}</b>{hospital.address ? <><br />{hospital.address}</> : null}
          </div>
        )}
        {forgot && (
          <Modal title="Reset your password" onClose={() => setForgot(false)} labelledBy="forgot-title" actions={<><Button variant="quiet" onClick={() => setForgot(false)}>Close</Button><Button variant="primary" disabled={resetBusy || !resetEmail.trim()} onClick={sendPasswordReset}>{resetBusy ? 'Sending...' : 'Send reset link'}</Button></>}>
            <p>Enter the email address on your staff account. We will email a secure link to reset its password. The same reset works for hospital admins and staff.</p>
            <Field label="Account email" htmlFor="reset-email"><Input id="reset-email" type="email" autoComplete="email" value={resetEmail} onChange={(event) => setResetEmail(event.target.value)} placeholder="you@hospital.ng" /></Field>
            {resetError && <div role="alert" style={{ color: 'var(--critical)', fontSize: 13 }}>{resetError}</div>}
            {resetNotice && <div role="status" className="text-muted">{resetNotice}</div>}
          </Modal>
        )}
        <div className="foot">
          New hospital? <Link to="/register">Create an account</Link>
        </div>
        <LegalFooter />

        {!backendAuthEnabled() && import.meta.env.DEV && <div className="mt-3">
          <div className="section-label" style={{ margin: '0 0 8px' }}>Demo accounts</div>
          <div className="grid" style={{ gap: 8 }}>
            {DEMO.map((d) => (
              <button
                key={d.email}
                type="button"
                className="row-line"
                style={{ padding: '8px 14px', minHeight: 56, border: '1px solid var(--hairline)', borderRadius: 'var(--r-btn)', background: 'var(--surface)', cursor: 'pointer', textAlign: 'left', color: 'inherit' }}
                onClick={() => {
                  setEmail(d.email)
                  submit(d.email)
                }}
                disabled={busy}
              >
                <span className="grow">
                  <span className="r-title">{d.name}</span>
                  <span className="r-sub">{d.note}</span>
                </span>
                <Icon name="arrowRight" />
              </button>
            ))}
          </div>
        </div>}
      </div>
    </div>
  )
}
