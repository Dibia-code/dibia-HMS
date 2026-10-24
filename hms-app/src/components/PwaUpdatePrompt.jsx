import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import './pwa-update.css'

export default function PwaUpdatePrompt() {
  const [registration, setRegistration] = useState(null)
  const [updating, setUpdating] = useState(false)
  const [error, setError] = useState('')
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW: (_url, currentRegistration) => setRegistration(currentRegistration),
  })

  useEffect(() => {
    if (!registration) return undefined
    const check = () => {
      if (navigator.onLine && document.visibilityState === 'visible') registration.update().catch(() => {})
    }
    const interval = window.setInterval(check, 60_000)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [registration])

  async function refresh() {
    setUpdating(true)
    setError('')
    try {
      await updateServiceWorker(true)
    } catch {
      setError('Could not refresh yet. Check your connection and try again.')
      setUpdating(false)
    }
  }

  if (!needRefresh) return null

  return (
    <aside className="pwa-update-prompt" role="status" aria-live="polite">
      <div className="pwa-update-copy">
        <strong>A new Dibia update is ready</strong>
        <span>Refresh to load the latest version.</span>
        {error && <span className="pwa-update-error">{error}</span>}
      </div>
      <button type="button" onClick={refresh} disabled={updating}>
        {updating ? 'Refreshing…' : 'Refresh now'}
      </button>
    </aside>
  )
}
