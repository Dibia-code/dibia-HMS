import { useLocation } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { MODULES, moduleForRoute } from './nav'

export function useModule() {
  const { pathname } = useLocation()
  const { can } = useAuth()
  const segment = pathname.split('/').filter(Boolean)[1]
  const key = moduleForRoute(segment, can)
  return { key, ...MODULES[key] }
}
