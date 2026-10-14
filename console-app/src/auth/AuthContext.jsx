import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { initials } from '@/lib/format'
import { apiBase } from '@/lib/apiBase'
import { setConsoleAccessToken } from '@/data/remoteClient'

// Console authentication is verified by the backend. The browser stores only
// the returned display profile; the API should issue an HttpOnly session cookie.

const SESSION_KEY = 'dibia.console.session'
const Ctx = createContext(null)
const demoAuthEnabled = () => import.meta.env.DEV && import.meta.env.VITE_CONSOLE_DEMO_AUTH === 'true'
const backendAuthEnabled = () => import.meta.env.PROD || import.meta.env.VITE_CONSOLE_BACKEND_AUTH === 'true'
const demoEmail = () => String(import.meta.env.VITE_CONSOLE_DEMO_EMAIL || '').trim().toLowerCase()

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => backendAuthEnabled() && !demoAuthEnabled() ? null : loadSession())
  const [restoring, setRestoring] = useState(true)

  useEffect(() => {
    if (demoAuthEnabled()) {
      setConsoleAccessToken(null)
      const stored = loadSession()
      if (stored?.demo !== true || String(stored?.email || '').toLowerCase() !== demoEmail()) {
        localStorage.removeItem(SESSION_KEY)
        setSession(null)
      }
      setRestoring(false)
      return undefined
    }
    if (!backendAuthEnabled()) {
      localStorage.removeItem(SESSION_KEY)
      setSession(null)
      setRestoring(false)
      return undefined
    }
    let cancelled = false
    fetch(`${apiBase()}/auth/console/session`, { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Session expired')
        const result = await response.json()
        if (!result.user) throw new Error('No active session')
        setConsoleAccessToken(result.accessToken)
        const next = { id: result.user.id, name: result.user.name || 'Dibia Super Admin', email: result.user.email }
        if (!cancelled) {
          localStorage.setItem(SESSION_KEY, JSON.stringify(next))
          setSession(next)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setConsoleAccessToken(null)
          localStorage.removeItem(SESSION_KEY)
          setSession(null)
        }
      })
      .finally(() => { if (!cancelled) setRestoring(false) })
    return () => { cancelled = true }
  }, []) // Verify any stored profile against the server once on startup.

  const login = useCallback(async (email, password) => {
    const cleanEmail = String(email || '').trim()
    if (!cleanEmail || !String(password || '')) {
      throw new Error('Enter your admin email and password.')
    }
    let next
    if (demoAuthEnabled()) {
      const expectedEmail = demoEmail()
      const expectedPassword = String(import.meta.env.VITE_CONSOLE_DEMO_PASSWORD || '')
      if (!expectedEmail || !expectedPassword) {
        throw new Error('Set the local console demo email and password in .env.local first.')
      }
      if (cleanEmail.toLowerCase() !== expectedEmail || password !== expectedPassword) {
        throw new Error('Incorrect demo email or password.')
      }
      next = { id: 'local-console-demo', name: 'Dibia Super Admin', email: expectedEmail, demo: true }
      setConsoleAccessToken(null)
    } else {
      if (!backendAuthEnabled()) {
        throw new Error('Backend sign-in is disabled. Use the local development demo until backend auth is ready.')
      }
      const response = await fetch(`${apiBase()}/auth/console/login`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, password }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message || 'Unable to sign in. Check your credentials.')
      if (!result.user) throw new Error('The authentication service returned no user profile.')
      setConsoleAccessToken(result.accessToken)
      next = { id: result.user.id, name: result.user.name || 'Dibia Super Admin', email: result.user.email || cleanEmail }
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(next))
    setSession(next)
    return next
  }, [])

  const logout = useCallback(() => {
    if (backendAuthEnabled() && !demoAuthEnabled()) {
      fetch(`${apiBase()}/auth/console/logout`, {
        method: 'POST', credentials: 'include',
      }).catch(() => {})
    }
    localStorage.removeItem(SESSION_KEY)
    setConsoleAccessToken(null)
    setSession(null)
  }, [])

  const value = useMemo(
    () => ({
      session,
      restoring,
      isAuthed: !!session,
      user: session,
      userInitials: initials(session?.name || 'Dibia Super Admin'),
      login,
      logout,
    }),
    [session, restoring, login, logout],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
