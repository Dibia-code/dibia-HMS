import { useEffect, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { useSyncEngine } from '@/data/RepositoryContext'
import { usePageHeader, Card, CardHead, Pill } from '@/components'
import { naira } from '@/lib/format'
import { apiBase } from '@/lib/apiBase'

export default function SubscriptionPage() {
  const { user } = useAuth()
  const sync = useSyncEngine()
  const [modules, setModules] = useState([])
  const [error, setError] = useState('')
  usePageHeader({ title: 'Modules and billing', subtitle: 'Module access is activated by Dibia after manual payment confirmation.' }, [])

  useEffect(() => {
    const baseUrl = apiBase()
    const token = sync.remote?.accessToken
    if (!token) return
    let cancelled = false
    fetch(`${baseUrl}/tenant/modules`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(result.message || 'Could not load module access')
        if (!cancelled) setModules(result.modules || [])
      })
      .catch((cause) => { if (!cancelled) setError(cause.message) })
    return () => { cancelled = true }
  }, [sync, user?.hospitalId])

  return (
    <Card>
      <CardHead title="Hospital modules" />
      <p className="text-muted">All modules start locked. Contact the Dibia team for module pricing and manual payment details. After confirming your payment, an administrator enables the modules you paid for. Special Pro access can also be granted by an administrator.</p>
      {error && <p role="alert" className="text-muted">{error}</p>}
      {modules.length > 0 ? modules.map((module) => {
        const enabled = module.entitlementStatus === 'entitled' && module.activationStatus === 'enabled'
        return <div key={module.code} className="row-between" style={{ padding: '14px 0', borderBottom: '1px solid var(--hairline)' }}>
          <div><strong>{module.name}</strong><div className="text-muted">{module.description}</div>{Number(module.priceMinor) > 0 && <div className="text-muted">{naira(module.priceMinor / 100)} per month</div>}</div>
          <Pill tone={enabled ? 'active' : 'pending'}>{enabled ? 'Enabled' : 'Locked'}</Pill>
        </div>
      }) : !error && <p className="text-muted">Module access details are available after connecting to the hospital service.</p>}
      <p className="text-muted mt-2">A manual payment confirmation does not automatically unlock every module. Each paid module is enabled separately by Dibia administration.</p>
    </Card>
  )
}
