import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { useRepo, useSyncEngine } from '@/data/RepositoryContext'
import { useLiveQuery } from './useLiveQuery'
import { hospitalConfig } from '@/lib/hospital'

export function useHospital() {
  const { user } = useAuth()
  const repo = useRepo()
  const sync = useSyncEngine()
  const [remoteSettings, setRemoteSettings] = useState(null)
  const { data: hospital } = useLiveQuery(() => repo.get('hospitals', user.hospitalId), [repo, user.hospitalId])
  useEffect(() => {
    let active = true
    if (!user?.hospitalId || !sync.remote?.configured) {
      setRemoteSettings(null)
      return () => { active = false }
    }
    const load = async () => {
      try {
        const response = await sync.remote.request(`${sync.remote.baseUrl}/settings/hospital`, { credentials: 'include', headers: {} })
        const result = await response.json().catch(() => ({}))
        if (active && response.ok) setRemoteSettings(result.settings || {})
      } catch {
        return
      }
    }
    const onUpdate = (event) => setRemoteSettings(event.detail || {})
    window.addEventListener('dibia:hospital-settings-updated', onUpdate)
    load()
    const timer = window.setInterval(load, 15000)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('dibia:hospital-settings-updated', onUpdate)
    }
  }, [user?.hospitalId, sync])
  const config = useMemo(() => hospitalConfig(hospital, remoteSettings), [hospital, remoteSettings])
  return { hospital, config }
}
