import { createContext, useContext, useMemo, useState } from 'react'

// Lets each page set the topbar title/subtitle/actions without prop-drilling.
// AppShell provides it; pages call usePageHeader({ title, subtitle, actions }).

const Ctx = createContext(null)

export function PageHeaderProvider({ children }) {
  const [header, setHeader] = useState({ title: '', subtitle: '', actions: null })
  const value = useMemo(() => ({ header, setHeader }), [header])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useHeaderState() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useHeaderState must be used within <PageHeaderProvider>')
  return ctx
}
