import { createContext, useContext, useMemo, useRef } from 'react'
import { LocalConsoleRepository } from './repository'
import { RemoteConsoleClient } from './remoteClient'

// Provides the single repository instance to the tree. Today it's the in-memory
// LocalConsoleRepository; to go live, construct a RemoteConsoleClient here
// instead (same interface — see remoteClient.js) and nothing else changes.

const Ctx = createContext(null)

export function RepositoryProvider({ children }) {
  // Created once and kept for the app's lifetime so in-memory edits persist
  // across navigation (approvals, suspensions, etc.).
  const repoRef = useRef(null)
  if (!repoRef.current) {
    repoRef.current = import.meta.env.PROD || import.meta.env.VITE_CONSOLE_BACKEND_AUTH === 'true'
      ? new RemoteConsoleClient()
      : new LocalConsoleRepository()
  }

  const value = useMemo(() => ({ repo: repoRef.current }), [])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useRepo() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useRepo must be used within <RepositoryProvider>')
  return ctx.repo
}
