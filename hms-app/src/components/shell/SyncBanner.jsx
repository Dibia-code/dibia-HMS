import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useSync, useSyncEngine } from '@/data/RepositoryContext'
import { useToast } from '../feedback/Toast'
import { Icon } from '../Icon'
import { syncStatus } from './SyncChip'

const OFFLINE_TEXT =
  "You're offline. Data is saved locally and will sync automatically when your connection returns. Some features may be unavailable."

export function SyncBanner() {
  const state = useSync()
  const engine = useSyncEngine()
  const toast = useToast()
  const { pathname } = useLocation()
  const status = syncStatus(state)

  const [dismissed, setDismissed] = useState(false)
  const [reconnected, setReconnected] = useState(false)
  const wasOffline = useRef(false)

  useEffect(() => setDismissed(false), [pathname])

  useEffect(() => {
    if (status === 'offline') {
      wasOffline.current = true
      setReconnected(false)
      return undefined
    }
    if (!wasOffline.current) return undefined
    setReconnected(true)
    const t = setTimeout(() => setReconnected(false), 3000)
    return () => clearTimeout(t)
  }, [status === 'offline']) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (status === 'online' && wasOffline.current) {
      wasOffline.current = false
      toast.success('All data synced.', { duration: 3000 })
    }
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  if (status === 'failed') {
    return (
      <div className="banner fail" role="alert">
        <Icon name="alert" />
        {state.lastError && <div className="msg">{state.lastError}</div>}
        <button type="button" className="retry" onClick={() => engine.drain()}>
          Sync failed — tap to retry.
        </button>
      </div>
    )
  }

  if (status === 'offline' && !dismissed) {
    return (
      <div className="banner" role="status">
        <Icon name="wifiOff" />
        <div className="msg">{OFFLINE_TEXT}</div>
        <button type="button" className="dismiss" onClick={() => setDismissed(true)} aria-label="Dismiss">
          <Icon name="x" />
        </button>
      </div>
    )
  }

  if (reconnected && status !== 'offline') {
    return (
      <div className="banner ok" role="status">
        <Icon name="sync" />
        <div className="msg">Back online. Syncing your saved changes.</div>
      </div>
    )
  }

  return null
}
