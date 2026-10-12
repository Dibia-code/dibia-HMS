import { useEffect, useState } from 'react'
import { COOKIE_PREFERENCES_EVENT } from './cookiePreferences'

const STORAGE_KEY = 'dibia.cookie-preferences.v1'
const DEFAULTS = { essential: true, analytics: false }

function readSaved() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') } catch { return null }
}

export default function CookieConsent() {
  const [saved, setSaved] = useState(readSaved)
  const [open, setOpen] = useState(!readSaved())
  const [manage, setManage] = useState(false)
  const [analytics, setAnalytics] = useState(Boolean(saved?.analytics))

  useEffect(() => {
    const showPreferences = () => { setManage(true); setOpen(true) }
    window.addEventListener(COOKIE_PREFERENCES_EVENT, showPreferences)
    return () => window.removeEventListener(COOKIE_PREFERENCES_EVENT, showPreferences)
  }, [])

  function save(next) {
    const value = { ...DEFAULTS, ...next, essential: true, savedAt: new Date().toISOString() }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    setSaved(value)
    setOpen(false)
    setManage(false)
  }

  if (!open) return null
  return (
    <div className="cookie-overlay">
      <section className="cookie-consent" role="dialog" aria-modal="true" aria-labelledby="cookie-title">
        <div className="cookie-copy">
          <h2 id="cookie-title">Your cookie preferences</h2>
          <p>Essential cookies keep your sign-in secure. You can accept or decline optional cookies. No analytics cookies are active in this build.</p>
          {manage && (
            <div className="cookie-options">
              <div className="cookie-option"><span><b>Essential</b><small>Required for secure sign-in and always on.</small></span><input type="checkbox" checked readOnly aria-label="Essential cookies required" /></div>
              <label className="cookie-option"><span><b>Analytics</b><small>Optional usage measurement. Currently not active.</small></span><input type="checkbox" checked={analytics} onChange={(event) => setAnalytics(event.target.checked)} /></label>
            </div>
          )}
        </div>
        <div className="cookie-actions">
          {manage ? (
            <>
              <button type="button" className="cookie-btn cookie-secondary" onClick={() => save({ analytics: false })}>Decline optional</button>
              <button type="button" className="cookie-btn cookie-primary" onClick={() => save({ analytics })}>Save preferences</button>
            </>
          ) : (
            <>
              <button type="button" className="cookie-btn cookie-secondary" onClick={() => setManage(true)}>Manage preferences</button>
              <button type="button" className="cookie-btn cookie-secondary" onClick={() => save({ analytics: false })}>Decline optional</button>
              <button type="button" className="cookie-btn cookie-primary" onClick={() => save({ analytics: true })}>Accept all</button>
            </>
          )}
        </div>
        {saved && manage && <button type="button" className="cookie-close" onClick={() => { setOpen(false); setManage(false) }}>Close</button>}
      </section>
    </div>
  )
}
