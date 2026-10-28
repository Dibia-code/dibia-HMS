import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useBaseRepo, useScope, useSyncEngine } from '@/data/RepositoryContext'
import { dataBus } from '@/data/repository'
import { hashPin } from '@/lib/pin'
import { apiBase } from '@/lib/apiBase'
import { activeDeviceHeaders } from '@/lib/deviceCredential'
import { permissionsFor, can as canDo, landingPath } from './permissions'

// Production and backend-enabled development authenticate against the API.
// Local demo mode resolves seeded staff from IndexedDB.

const SESSION_KEY = 'dibia.session'
const Ctx = createContext(null)
const backendAuthEnabled = () => import.meta.env.PROD || import.meta.env.VITE_HMS_BACKEND_AUTH === 'true'
function fromBackend(result) {
  const user = result?.user || {}
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    roles: Array.isArray(user.roles) ? user.roles : [],
    hospitalId: user.hospitalId || result?.tenant?.id,
    hospitalSlug: user.hospitalSlug || result?.tenant?.slug,
    hospitalName: user.hospitalName || result?.tenant?.name,
    branchId: user.branchId || result?.branch?.id || null,
    backendBranchId: user.branchId || result?.branch?.id || null,
    permGrants: Array.isArray(user.permGrants) ? user.permGrants : [],
    permDenies: Array.isArray(user.permDenies) ? user.permDenies : [],
    mustChangePassword: user.mustChangePassword === true,
  }
}

async function loadBackendModules(remote) {
  if (!remote?.configured) return null
  try {
    const response = await remote.request(`${apiBase()}/tenant/modules`, { credentials: 'include', headers: {} })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) return null
    return (result.modules || []).filter((module) => module.entitlementStatus === 'entitled' && module.activationStatus === 'enabled').map((module) => module.code)
  } catch { return null }
}

function loadSession() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')
    if (!session) return null
    if (!session.hospitalId && session.pharmacyId) {
      session.hospitalId = session.pharmacyId
      session.hospitalSlug = session.pharmacySlug
      session.hospitalName = session.pharmacyName
      delete session.pharmacyId
      delete session.pharmacySlug
      delete session.pharmacyName
      localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    }
    return session
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  const baseRepo = useBaseRepo()
  const [, setScope] = useScope()
  const sync = useSyncEngine()
  const [session, setSession] = useState(() => backendAuthEnabled() ? null : loadSession())
  const [restoring, setRestoring] = useState(true)

  useEffect(() => {
    const expireSession = () => {
      sync.remote?.setAccessToken?.(null)
      localStorage.removeItem(SESSION_KEY)
      setSession(null)
    }
    window.addEventListener('dibia:session-expired', expireSession)
    return () => window.removeEventListener('dibia:session-expired', expireSession)
  }, [sync])

  // Restore an existing session's tenant scope on reload.
  useEffect(() => {
    if (backendAuthEnabled()) {
      let cancelled = false
      let refreshing = false
      const restoreBackendSession = async () => {
        if (cancelled || refreshing) return
        refreshing = true
        try {
          const response = await fetch(`${apiBase()}/auth/refresh`, { method: 'POST', credentials: 'include', headers: activeDeviceHeaders() })
          const result = await response.json().catch(() => ({}))
          if (!response.ok) {
            const error = new Error(result.message || 'No active backend session')
            error.status = response.status
            throw error
          }
          if (cancelled) return
          const next = fromBackend(result)
          const cached = loadSession()
          if (cached?.userId === next.userId && cached.passwordChangeSkipped) next.passwordChangeSkipped = true
          if (!next.userId || !next.hospitalId || !next.hospitalSlug) throw new Error('The server returned an incomplete hospital session')
          sync.remote?.setAccessToken?.(result.accessToken, next.hospitalId, next.backendBranchId)
          const moduleCodes = await loadBackendModules(sync.remote)
          next.moduleCodes = moduleCodes ?? (cached?.userId === next.userId ? cached.moduleCodes || [] : [])
          localStorage.setItem(SESSION_KEY, JSON.stringify(next))
          setSession(next)
          setScope({ hospitalId: next.hospitalId, branchId: next.branchId })
          sync.drain()
        } catch (error) {
          if (!cancelled) {
            sync.remote?.setAccessToken?.(null)
            if (error.status === 401) {
              localStorage.removeItem(SESSION_KEY)
              setSession(null)
            } else {
              // Preserve the cached identity during a temporary outage. Data
              // stays local until the backend can refresh this session again.
              const cached = loadSession()
              if (cached) {
                setSession(cached)
                setScope({ hospitalId: cached.hospitalId, branchId: cached.branchId ?? null })
              } else {
                setSession(null)
              }
            }
          }
        } finally {
          refreshing = false
          if (!cancelled) setRestoring(false)
        }
      }
      window.addEventListener('online', restoreBackendSession)
      restoreBackendSession()
      return () => {
        cancelled = true
        window.removeEventListener('online', restoreBackendSession)
      }
    }
    if (session?.hospitalId) {
      setScope({ hospitalId: session.hospitalId, branchId: session.branchId ?? null })
    }
    setRestoring(false)
    // Run once on mount.
     
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(
    async (email, password) => {
      const id = String(email).trim().toLowerCase()
      if (backendAuthEnabled()) {
        const response = await fetch(`${apiBase()}/auth/login`, {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', ...activeDeviceHeaders() },
          body: JSON.stringify({ identifier: id, password }),
        })
        const result = await response.json().catch(() => ({}))
        if (!response.ok) {
          const error = new Error(result.message || 'Could not sign in')
          error.code = result.code
          throw error
        }
        const next = fromBackend(result)
        if (!next.userId || !next.hospitalId || !next.hospitalSlug) throw new Error('The server returned an incomplete hospital session')
        sync.remote?.setAccessToken?.(result.accessToken, next.hospitalId, next.backendBranchId)
        const moduleCodes = await loadBackendModules(sync.remote)
        const cached = loadSession()
        next.moduleCodes = moduleCodes ?? (cached?.userId === next.userId ? cached.moduleCodes || [] : [])
        localStorage.setItem(SESSION_KEY, JSON.stringify(next))
        setSession(next)
        setScope({ hospitalId: next.hospitalId, branchId: next.branchId })
        sync.drain()
        return next
      }
      let staff = null
      if (id.includes('@')) {
        staff = await baseRepo.findByIndex('staff', 'by_email', id)
      } else {
        const digits = id.replace(/\D/g, '').slice(-10)
        if (digits.length >= 7) {
          const all = await baseRepo.list('staff')
          staff = all.find((s) => String(s.phone || '').replace(/\D/g, '').slice(-10) === digits) || null
        }
      }
      if (!staff) throw new Error('No account found for that phone number or email')
      if (staff.active === false) throw new Error('This account is deactivated')
      if (staff.passwordHash) {
        const ok = password && (await hashPin(password, staff.id)) === staff.passwordHash
        if (!ok) throw new Error('That password is not correct')
      }

      const hospital = await baseRepo.get('hospitals', staff.hospitalId)
      if (hospital?.requireDeviceApproval) {
        const deviceId = localStorage.getItem('dibia.deviceId')
        const device = deviceId ? await baseRepo.get('devices', deviceId) : null
        if (!device || device.status !== 'approved' || device.hospitalId !== staff.hospitalId) {
          throw new Error('This device has not been approved by your hospital admin. Ask them for a device access link.')
        }
      }

      const roleRows = await baseRepo.listByIndex('staff_roles', 'by_staff', staff.id)
      const roles = roleRows.map((r) => r.role)

      const next = {
        userId: staff.id,
        name: staff.name,
        email: staff.email,
        roles,
        hospitalId: staff.hospitalId,
        hospitalSlug: hospital?.slug ?? null,
        hospitalName: hospital?.name ?? null,
        branchId: staff.branchId ?? null,
        appearance: staff.appearance ?? null,
        permGrants: staff.permGrants || [],
        permDenies: staff.permDenies || [],
      }
      localStorage.setItem(SESSION_KEY, JSON.stringify(next))
      setSession(next)
      setScope({ hospitalId: next.hospitalId, branchId: next.branchId })
      if (hospital) localStorage.setItem('dibia.hospital', JSON.stringify({ name: hospital.name, address: hospital.address || '' }))
      baseRepo
        .create('audit_log', { hospitalId: next.hospitalId, branchId: next.branchId, action: 'auth.login', ref: staff.name, actorId: staff.id, at: new Date().toISOString() })
        .catch(() => {})
      return next
    },
    [baseRepo, setScope, sync],
  )

  const logout = useCallback(() => {
    const id = (() => {
      try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')?.userId } catch { return null }
    })()
    if (id) baseRepo.update('staff', id, { lastActiveAt: null }).catch(() => {})
    if (backendAuthEnabled()) fetch(`${apiBase()}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {})
    sync.remote?.setAccessToken?.(null)
    localStorage.removeItem(SESSION_KEY)
    setSession(null)
    setScope({ hospitalId: null, branchId: null })
  }, [setScope, baseRepo, sync])

  // Presence: lets the admin see who is on shift right now.
  useEffect(() => {
    if (!session?.userId) return undefined
    const beat = () => baseRepo.update('staff', session.userId, { lastActiveAt: new Date().toISOString() }).catch(() => {})
    beat()
    const t = setInterval(beat, 120_000)
    return () => clearInterval(t)
  }, [session?.userId, baseRepo])

  // Suspension takes effect immediately, and permission changes apply live.
  useEffect(() => {
    if (!session?.userId) return undefined
    // Backend-created staff may not exist in the local IndexedDB cache yet.
    // Treating a cache miss as a deleted account would clear a valid backend
    // session immediately after login. The backend validates account status
    // during authentication; this local watcher is only for demo accounts.
    if (backendAuthEnabled()) return undefined
    let cancelled = false
    const check = async () => {
      const staff = await baseRepo.get('staff', session.userId)
      if (cancelled) return
      if (!staff || staff.active === false) {
        localStorage.removeItem(SESSION_KEY)
        setSession(null)
        setScope({ hospitalId: null, branchId: null })
        return
      }
      const roles = (await baseRepo.listByIndex('staff_roles', 'by_staff', staff.id)).map((r) => r.role)
      const grants = staff.permGrants || []
      const denies = staff.permDenies || []
      const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x))
      setSession((prev) => {
        if (!prev) return prev
        if (same(prev.roles, roles) && same(prev.permGrants || [], grants) && same(prev.permDenies || [], denies)) return prev
        const next = { ...prev, roles, permGrants: grants, permDenies: denies }
        localStorage.setItem(SESSION_KEY, JSON.stringify(next))
        return next
      })
    }
    const onChange = (e) => {
      if (e.detail.entities.some((n) => n === 'staff' || n === 'staff_roles')) check()
    }
    dataBus.addEventListener('change', onChange)
    check()
    return () => {
      cancelled = true
      dataBus.removeEventListener('change', onChange)
    }
  }, [session?.userId, baseRepo, setScope])

  useEffect(() => {
    if (!backendAuthEnabled() || !session?.userId) return undefined
    let cancelled = false
    const refreshModules = async () => {
      const moduleCodes = await loadBackendModules(sync.remote)
      if (cancelled) return
      setSession((previous) => {
        if (!previous || previous.moduleCodes?.length === moduleCodes.length && moduleCodes.every((code) => previous.moduleCodes.includes(code))) return previous
        const next = { ...previous, moduleCodes }
        localStorage.setItem(SESSION_KEY, JSON.stringify(next))
        return next
      })
    }
    refreshModules()
    const timer = setInterval(refreshModules, 60_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [session?.userId, sync])

  useEffect(() => {
    if (!backendAuthEnabled() || !session?.userId) return undefined
    let cancelled = false
    let refreshing = false
    const refreshAccess = async () => {
      if (refreshing) return
      refreshing = true
      try {
        const response = await sync.remote.request(`${apiBase()}/me`, { credentials: 'include', headers: {} })
        const result = await response.json().catch(() => ({}))
        if (!response.ok || cancelled) return
        const next = fromBackend(result)
        next.moduleCodes = await loadBackendModules(sync.remote)
        setSession((previous) => {
          if (!previous || previous.userId !== next.userId) return previous
          if (previous.passwordChangeSkipped && next.mustChangePassword) next.passwordChangeSkipped = true
          const same = (left = [], right = []) => left.length === right.length && left.every((value) => right.includes(value))
          if (
            previous.name === next.name &&
            previous.email === next.email &&
            previous.branchId === next.branchId &&
            previous.mustChangePassword === next.mustChangePassword &&
            same(previous.roles, next.roles) &&
            same(previous.permGrants, next.permGrants) &&
            same(previous.permDenies, next.permDenies) &&
            same(previous.moduleCodes, next.moduleCodes)
          ) return previous
          localStorage.setItem(SESSION_KEY, JSON.stringify(next))
          return next
        })
      } catch {
      } finally {
        refreshing = false
      }
    }
    const onChange = (event) => {
      if (event.detail.entities.some((entity) => entity === 'staff' || entity === 'staff_roles')) refreshAccess()
    }
    dataBus.addEventListener('change', onChange)
    const timer = window.setInterval(refreshAccess, 15_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      dataBus.removeEventListener('change', onChange)
    }
  }, [session?.userId, sync])

  const updateSession = useCallback((patch) => {
    setSession((prev) => {
      if (!prev) return prev
      const next = { ...prev, ...patch }
      localStorage.setItem(SESSION_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  // Permission union across all held roles — the single source for can()/guards.
  const perms = useMemo(() => {
    const set = permissionsFor(session?.roles || [])
    for (const p of session?.permGrants || []) set.add(p)
    for (const p of session?.permDenies || []) set.delete(p)
    return set
  }, [session])

  const value = useMemo(
    () => ({
      session,
      restoring,
      isAuthed: !!session,
      user: session,
      roles: session?.roles || [],
      perms,
      can: (need) => canDo(perms, need),
      // Landing path after login (no tenant prefix); router prepends the slug.
      landingPath: () => landingPath(perms),
      login,
      logout,
      updateSession,
    }),
    [session, restoring, perms, login, logout, updateSession],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
