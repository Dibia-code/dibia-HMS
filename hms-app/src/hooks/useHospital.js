import { useMemo } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { useRepo } from '@/data/RepositoryContext'
import { useLiveQuery } from './useLiveQuery'
import { hospitalConfig } from '@/lib/hospital'

export function useHospital() {
  const { user } = useAuth()
  const repo = useRepo()
  const { data: hospital } = useLiveQuery(() => repo.get('hospitals', user.hospitalId), [repo, user.hospitalId])
  const config = useMemo(() => hospitalConfig(hospital), [hospital])
  return { hospital, config }
}
