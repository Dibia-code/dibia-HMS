import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { LocalRepository } from './repository'
import { RemoteApiClient } from './remoteClient'
import { SyncEngine } from './sync'
import { clearHospitalDemoData, ensureHospitalSeed, ensureHospitalPharmacySeed } from './seed'

// Wires the local-first data layer into React. Provider order matters: this sits
// ABOVE AuthProvider so auth can resolve staff through the repo after login.

const Ctx = createContext(null)

export function RepositoryProvider({ children }) {
  const [ready, setReady] = useState(false)
  const [scope, setScopeState] = useState({ hospitalId: null, branchId: null })

  // Base (unscoped) repo + sync engine are created once and never recreated.
  const engineRef = useRef(null)
  const baseRepoRef = useRef(null)
  if (!baseRepoRef.current) baseRepoRef.current = new LocalRepository()
  if (!engineRef.current) engineRef.current = new SyncEngine(new RemoteApiClient())

  useEffect(() => {
    let cancelled = false
    const engine = engineRef.current
    ;(async () => {
      // Demo patients, staff and inventory are development-only. A production
      // build must hydrate from the backend and must never synthesize stock.
      const backendAuthEnabled = import.meta.env.PROD || import.meta.env.VITE_HMS_BACKEND_AUTH === 'true'
      if (backendAuthEnabled) {
        await clearHospitalDemoData()
      } else if (import.meta.env.DEV) {
        await ensureHospitalSeed()
        await ensureHospitalPharmacySeed()
        await new LocalRepository().ensureBatches()
      }
      if (cancelled) return
      engine.start()
      setReady(true)
    })()
    return () => {
      cancelled = true
      engine.stop()
    }
  }, [])

  const setScope = useMemo(
    () => (next) => setScopeState((prev) => ({ ...prev, ...next })),
    [],
  )

  const value = useMemo(
    () => ({
      baseRepo: baseRepoRef.current,
      sync: engineRef.current,
      scope,
      setScope,
      ready,
    }),
    [scope, setScope, ready],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

function useRepositoryCtx() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useRepository* must be used within <RepositoryProvider>')
  return ctx
}

export function useDataReady() {
  return useRepositoryCtx().ready
}

// Tenant/branch scope controls — auth sets hospitalId, branch picker sets branchId.
export function useScope() {
  const { scope, setScope } = useRepositoryCtx()
  return [scope, setScope]
}

// The repository pages should use: automatically scoped to the active tenant.
export function useRepo() {
  const { baseRepo, scope } = useRepositoryCtx()
  return useMemo(
    () => baseRepo.withScope(scope),
    [baseRepo, scope.hospitalId, scope.branchId], // eslint-disable-line react-hooks/exhaustive-deps
  )
}

// Unscoped repo — for cross-tenant lookups before a scope exists (e.g. login).
export function useBaseRepo() {
  return useRepositoryCtx().baseRepo
}

// The raw engine, for manual triggers (e.g. a "Sync now" button).
export function useSyncEngine() {
  return useRepositoryCtx().sync
}

// Live sync state for the header chip and pending badges.
export function useSync() {
  const { sync } = useRepositoryCtx()
  const [state, setState] = useState(() => sync.getState())
  useEffect(() => sync.subscribe(setState), [sync])
  return state
}
