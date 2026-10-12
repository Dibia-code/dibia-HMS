import { useMemo } from 'react'
import { useRepo } from '@/data/RepositoryContext'
import { useLiveQuery } from './useLiveQuery'
import { tierFor, nextTier } from '@/lib/hospital'

const DAY = 86_400_000

export function useUsageDays() {
  const repo = useRepo()
  const { data: visits } = useLiveQuery(() => repo.list('visits'), [repo])
  const { data: payments } = useLiveQuery(() => repo.list('payments'), [repo])

  return useMemo(() => {
    const now = new Date()
    const month = `${now.getFullYear()}-${now.getMonth()}`
    const seen = new Set()
    const add = (patientId, iso) => {
      if (!patientId || !iso) return
      const d = new Date(iso)
      if (`${d.getFullYear()}-${d.getMonth()}` !== month) return
      seen.add(`${patientId}|${d.getDate()}`)
    }
    for (const v of visits || []) {
      add(v.patientId, v.openedAt)
      for (const c of v.charges || []) add(v.patientId, c.at)
      if (v.admission?.admittedAt) {
        const end = v.admission.dischargedAt ? new Date(v.admission.dischargedAt).getTime() : Date.now()
        for (let t = new Date(v.admission.admittedAt).getTime(); t <= end; t += DAY) add(v.patientId, new Date(t).toISOString())
      }
    }
    for (const p of payments || []) add(p.patientId, p.createdAt)

    const days = seen.size
    const tier = tierFor(days)
    const ceiling = tier.max === Infinity ? Math.max(days, 1) : tier.max
    const pct = Math.min(100, Math.round((days / ceiling) * 100))
    return {
      days, tier, ceiling, pct,
      level: pct >= 100 ? 'crit' : pct >= 80 ? 'warn' : 'ok',
      upcoming: nextTier(tier),
    }
  }, [visits, payments])
}
