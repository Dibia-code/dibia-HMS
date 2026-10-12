import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { useRepo } from '@/data/RepositoryContext'

const KEY = 'dibia.appearance'
const CHOICES = ['system', 'light', 'dark']
const Ctx = createContext(null)

function readStored() {
  try {
    const v = localStorage.getItem(KEY)
    return CHOICES.includes(v) ? v : 'system'
  } catch {
    return 'system'
  }
}

function systemPrefersDark() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

function applyTheme(pref) {
  const dark = pref === 'dark' || (pref === 'system' && systemPrefersDark())
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', dark ? '#141918' : '#0B6E6E')
  return dark ? 'dark' : 'light'
}

export function ThemeProvider({ children }) {
  const { user, updateSession } = useAuth()
  const repo = useRepo()
  const [preference, setPreference] = useState(readStored)
  const [resolved, setResolved] = useState(() => applyTheme(readStored()))

  useEffect(() => {
    const fromAccount = user?.appearance
    if (fromAccount && CHOICES.includes(fromAccount)) setPreference(fromAccount)
  }, [user?.userId, user?.appearance])

  useEffect(() => {
    setResolved(applyTheme(preference))
    try {
      localStorage.setItem(KEY, preference)
    } catch {
      return undefined
    }
    if (preference !== 'system') return undefined
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setResolved(applyTheme('system'))
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [preference])

  const choose = useCallback(
    async (next) => {
      if (!CHOICES.includes(next)) return
      setPreference(next)
      if (user?.userId) {
        updateSession({ appearance: next })
        try {
          await repo.update('staff', user.userId, { appearance: next })
        } catch {
          return
        }
      }
    },
    [repo, user?.userId, updateSession],
  )

  const value = useMemo(() => ({ preference, resolved, choose }), [preference, resolved, choose])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useTheme() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>')
  return ctx
}
