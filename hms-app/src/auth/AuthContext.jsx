import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useBaseRepo, useScope } from '@/data/RepositoryContext'
import { dataBus } from '@/data/repository'
import { hashPin } from '@/lib/pin'
import { permissionsFor, can as canDo, landingPath } from './permissions'

// Session/auth — no real backend yet (FRONTEND_SPEC §7). login() resolves an
// email against seeded staff and computes the permission union; the session
// SHAPE is the contract — swap the lookup for a token exchange later, unchanged.

const SESSION_KEY = 'dibia.session'
const Ctx = createContext(null)

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
  const [session, setSession] = useState(loadSession)
  const [restoring, setRestoring] = useState(true)

  // Restore an existing session's tenant scope on reload.
  useEffect(() => {
    if (session?.hospitalId) {
      setScope({ hospitalId: session.hospitalId, branchId: session.branchId ?? null })
    }
    setRestoring(false)
    // Run once on mount.
     
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(
    async (email, password) => {
      const id = String(email).trim().toLowerCase()
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
    [baseRepo, setScope],
  )

  const logout = useCallback(() => {
    const id = (() => {
      try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')?.userId } catch { return null }
    })()
    if (id) baseRepo.update('staff', id, { lastActiveAt: null }).catch(() => {})
    localStorage.removeItem(SESSION_KEY)
    setSession(null)
    setScope({ hospitalId: null, branchId: null })
  }, [setScope, baseRepo])

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
