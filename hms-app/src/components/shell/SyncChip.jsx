import { useSync, useSyncEngine } from '@/data/RepositoryContext'
import { cx } from '@/lib/cx'

export function syncStatus({ configured = true, online, syncing, pending, lastError }) {
  if (!configured) return 'local'
  if (!online) return 'offline'
  if (lastError && !syncing) return 'failed'
  if (pending > 0) return 'syncing'
  return 'online'
}

const LABELS = {
  online: { full: 'Online', short: 'Online' },
  local: { full: 'Saved locally', short: 'Local' },
  offline: { full: 'Offline — syncing when reconnected', short: 'Offline' },
  syncing: { full: 'Syncing...', short: 'Syncing' },
  failed: { full: 'Sync failed', short: 'Failed' },
}

export function SyncChip() {
  const state = useSync()
  const engine = useSyncEngine()
  const status = syncStatus(state)
  const label = LABELS[status]
  const actionable = status === 'failed'

  const title =
    status === 'offline'
      ? `${state.pending} change${state.pending === 1 ? '' : 's'} saved on this device, waiting to sync`
      : status === 'failed'
        ? 'Tap to retry'
        : status === 'local'
          ? `${state.pending} change${state.pending === 1 ? '' : 's'} saved on this device. Server sync is not configured yet.`
        : undefined

  return (
    <button
      type="button"
      className={cx('sync-chip', status, actionable && 'actionable')}
      onClick={() => actionable && engine.drain()}
      title={title}
      aria-live="polite"
    >
      <span className="dot" />
      <span className="lbl-full">{label.full}</span>
      <span className="lbl-short">{label.short}</span>
      {(status === 'offline' || status === 'local') && state.pending > 0 && (
        <span className="count" aria-label={`${state.pending} changes waiting to sync`}>
          {state.pending}
        </span>
      )}
    </button>
  )
}
