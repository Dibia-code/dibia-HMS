import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import './pwa-update.css'

function waitForInstall(registration) {
  if (registration.waiting) return Promise.resolve(true)
  const worker = registration.installing
  if (!worker) return Promise.resolve(false)
  return new Promise((resolve) => {
    const finish = (ready) => {
      window.clearTimeout(timeout)
      worker.removeEventListener('statechange', onStateChange)
      resolve(ready)
    }
    const onStateChange = () => {
      if (registration.waiting || worker.state === 'installed' || worker.state === 'activated') finish(true)
      else if (worker.state === 'redundant') finish(false)
    }
    const timeout = window.setTimeout(() => finish(Boolean(registration.waiting)), 12_000)
    worker.addEventListener('statechange', onStateChange)
    onStateChange()
  })
}

export default function PwaUpdatePrompt() {
  const [registration, setRegistration] = useState(null)
  const [updating, setUpdating] = useState(false)
  const [buildUpdate, setBuildUpdate] = useState(false)
  const [error, setError] = useState('')
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW: (_url, currentRegistration) => setRegistration(currentRegistration),
  })

  useEffect(() => {
    let active = true
    let checking = false
    const check = async () => {
      if (!navigator.onLine || document.visibilityState !== 'visible' || checking) return
      checking = true
      try {
        const url = new URL(`${import.meta.env.BASE_URL}build-info.json`, window.location.origin)
        url.searchParams.set('check', String(Date.now()))
        const response = await fetch(url, { cache: 'no-store' })
        const latest = response.ok ? await response.json() : null
        if (active && latest?.buildId && latest.buildId !== __BUILD_ID__) setBuildUpdate(true)
        if (registration) await registration.update()
      } catch {
      } finally {
        checking = false
      }
    }
    check()
    const interval = window.setInterval(check, 30_000)
    window.addEventListener('focus', check)
    window.addEventListener('online', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      active = false
      window.clearInterval(interval)
      window.removeEventListener('focus', check)
      window.removeEventListener('online', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [registration])

  async function update() {
    setUpdating(true)
    setError('')
    try {
      if (!navigator.onLine) throw new Error('offline')
      if (registration) {
        await registration.update()
        if (await waitForInstall(registration) && registration.waiting) {
          await updateServiceWorker(true)
          return
        }
      }
      if (needRefresh) {
        await updateServiceWorker(true)
        return
      }
      window.location.reload()
    } catch {
      setError(navigator.onLine ? 'The update is not ready yet. Try again in a moment.' : 'Connect to the internet before updating.')
      setUpdating(false)
    }
  }

  if (!needRefresh && !buildUpdate) return null

  return (
    <aside className="pwa-update-prompt" role="status" aria-live="polite">
      <div className="pwa-update-copy">
        <strong>A new Dibia update is ready</strong>
        <span>Update now to load the latest version.</span>
        {error && <span className="pwa-update-error">{error}</span>}
      </div>
      <button type="button" onClick={update} disabled={updating}>
        {updating ? 'Updating…' : 'Update'}
      </button>
    </aside>
  )
}
