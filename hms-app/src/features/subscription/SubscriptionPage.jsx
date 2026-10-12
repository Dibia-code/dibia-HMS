import { useAuth } from '@/auth/AuthContext'
import { useRepo } from '@/data/RepositoryContext'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import { useUsageDays } from '@/hooks/useUsageDays'
import { usePageHeader, Card, CardHead, Pill, DataTable } from '@/components'
import { TIERS } from '@/lib/hospital'
import { naira, number } from '@/lib/format'

export default function SubscriptionPage() {
  const { user } = useAuth()
  const repo = useRepo()
  const u = useUsageDays()
  const { data: hospital } = useLiveQuery(() => repo.get('hospitals', user.hospitalId), [repo, user.hospitalId])
  usePageHeader({ title: 'Usage and billing', subtitle: 'Usage-days this month and your current tier' }, [])

  const remaining = u.tier.max === Infinity ? null : Math.max(0, u.tier.max - u.days)

  return (
    <>
      {u.level !== 'ok' && (
        <div className={`banner ${u.level === 'crit' ? 'fail' : ''}`} style={{ position: 'static', marginBottom: 16, borderRadius: 'var(--r-card)', borderWidth: 1, borderStyle: 'solid' }} role="status">
          <div className="msg">
            {u.level === 'crit'
              ? `You have reached the ${u.tier.name} tier limit. Usage above it moves this hospital to the next tier${u.upcoming ? `, ${u.upcoming.name}` : ''}.`
              : `You are at ${u.pct}% of the ${u.tier.name} tier. ${remaining} usage-days left before the next tier.`}
          </div>
        </div>
      )}

      <Card className="mb-3">
        <CardHead title="This month">
          <div className="spacer" />
          <Pill tone="active">{u.tier.name} tier</Pill>
        </CardHead>
        <div className="big-num">{number(u.days)} <small className="text-muted" style={{ fontSize: 15, fontWeight: 500 }}>usage-days</small></div>
        <div className="meter" role="progressbar" aria-valuenow={u.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Usage-day meter" style={{ height: 32 }}>
          <div className={`meter-fill ${u.level}`} style={{ width: `${Math.max(u.pct, 8)}%` }}><span>{u.pct}%</span></div>
        </div>
        <div className="row-between mt-1 text-muted">
          <span>{u.tier.max === Infinity ? 'No upper limit on this tier' : `${number(u.tier.max)} usage-days is the top of the ${u.tier.name} tier`}</span>
          <span>{u.upcoming ? `Next tier: ${u.upcoming.name} from ${number(u.upcoming.min)}` : 'Highest tier'}</span>
        </div>
        <div className="text-muted mt-2">A usage-day is one patient seen or documented on one calendar day. An admitted patient counts once for each day of the stay. Payment is due at the end of the month.</div>
      </Card>

      <Card>
        <CardHead title="Tiers" />
        <DataTable
          rowStatus={(t) => (t.key === u.tier.key ? 'ok' : null)}
          columns={[
            { key: 'name', header: 'Tier', render: (t) => <span className="cell-strong">{t.name}{t.key === u.tier.key ? ' (current)' : ''}</span> },
            { key: 'range', header: 'Usage-days a month', render: (t) => (t.max === Infinity ? `${number(t.min)} and above` : `${number(t.min)} to ${number(t.max)}`) },
            { key: 'fee', header: 'Monthly fee', align: 'num', render: (t) => (t.fee === 0 ? 'Free' : naira(t.fee)) },
          ]}
          rows={TIERS}
          getRowKey={(t) => t.key}
        />
        <div className="text-muted mt-2">Account status: {hospital?.subscriptionStatus === 'failed' ? 'payment failed' : 'active'}. Onboarding is free.</div>
      </Card>
    </>
  )
}
