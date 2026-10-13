// Proxy local backend requests through the app's own origin. Refresh cookies
// use SameSite=Lax, so calling 127.0.0.1 from a localhost page can lose them.
export function apiBase() {
  const configured = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://127.0.0.1:4000' : '/api')
  const base = String(configured).replace(/\/+$/, '')
  if (!import.meta.env.DEV) return base
  try {
    const url = new URL(base, 'http://localhost')
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return '/api'
  } catch { /* Preserve relative or otherwise valid deployment URLs. */ }
  return base
}
