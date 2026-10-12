import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

const KEY = 'dibia.appearance'
const CHOICES = ['system', 'light', 'dark']
const Ctx = createContext(null)

const readStored = () => {
  try {
    const v = localStorage.getItem(KEY)
    return CHOICES.includes(v) ? v : 'system'
  } catch {
    return 'system'
  }
}

function apply(pref) {
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
}

export function ThemeProvider({ children }) {
  const [preference, setPreference] = useState(readStored)

  useEffect(() => {
    apply(preference)
    try {
      localStorage.setItem(KEY, preference)
    } catch {
      return undefined
    }
    if (preference !== 'system') return undefined
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => apply('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [preference])

  const choose = useCallback((next) => CHOICES.includes(next) && setPreference(next), [])
  const value = useMemo(() => ({ preference, choose }), [preference, choose])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useTheme() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>')
  return ctx
}
