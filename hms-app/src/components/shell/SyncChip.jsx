import { useSync, useSyncEngine } from '@/data/RepositoryContext'
import { cx } from '@/lib/cx'

export function syncStatus({ configured = true, authenticated = true, online, syncing, pending, lastError }) {
  if (!configured) return 'local'
  if (!authenticated) return 'auth'
  if (!online) return 'offline'
  if (lastError && !syncing) return 'failed'
  if (syncing) return 'syncing'
  if (pending > 0) return 'queued'
  return 'online'
}

const LABELS = {
  online: { full: 'Online', short: 'Online' },
  local: { full: 'Saved on this device', short: 'On device' },
  auth: { full: 'Reconnect to sync', short: 'Reconnect' },
  offline: { full: 'Offline — syncing when reconnected', short: 'Offline' },
  syncing: { full: 'Syncing...', short: 'Syncing' },
  queued: { full: 'Waiting to sync', short: 'Queued' },
  failed: { full: 'Sync failed', short: 'Failed' },
}

export function SyncChip() {
  const state = useSync()
  const engine = useSyncEngine()
  const status = syncStatus(state)
  const label = LABELS[status]
  const actionable = status === 'failed' || status === 'auth'

  const title =
    status === 'offline'
      ? `${state.pending} change${state.pending === 1 ? '' : 's'} saved on this device, waiting to sync`
      : status === 'failed'
        ? state.lastError || 'Tap to retry'
        : status === 'local'
          ? `${state.pending} change${state.pending === 1 ? '' : 's'} saved on this device. They are not syncing to your other devices yet.`
          : status === 'auth'
            ? state.lastError || `${state.pending} change${state.pending === 1 ? '' : 's'} saved on this device. Reconnect or sign in again to sync them.`
        : status === 'queued'
          ? `${state.pending} change${state.pending === 1 ? '' : 's'} waiting to sync.`
        : state.otherPending > 0
          ? `${state.otherPending} saved change${state.otherPending === 1 ? '' : 's'} belong to another hospital account. They have been kept separate.`
        : undefined

  return (
    <button
      type="button"
      className={cx('sync-chip', status, actionable && 'actionable')}
      onClick={() => {
        if (status === 'auth') engine.reconnect()
        else if (status === 'failed') engine.drain()
      }}
      title={title}
      aria-live="polite"
    >
      <span className="dot" />
      <span className="lbl-full">{label.full}</span>
      <span className="lbl-short">{label.short}</span>
      {(status === 'offline' || status === 'local' || status === 'auth' || status === 'queued') && state.pending > 0 && (
        <span className="count" aria-label={`${state.pending} changes waiting to sync`}>
          {state.pending}
        </span>
      )}
    </button>
  )
}
