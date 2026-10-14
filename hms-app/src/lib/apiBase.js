// Proxy local backend requests through the app's own origin. Refresh cookies
// use SameSite=Lax, so calling 127.0.0.1 from a localhost page can lose them.
export function apiBase() {
  // Production traffic goes through the Vercel same-origin rewrite so browser
  // requests and HttpOnly refresh cookies do not depend on cross-origin CORS.
  if (import.meta.env.PROD) return '/api'
  const configured = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://127.0.0.1:4000' : '/api')
  const base = String(configured).replace(/\/+$/, '')
  try {
    const url = new URL(base, 'http://localhost')
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return '/api'
  } catch { /* Preserve relative or otherwise valid deployment URLs. */ }
  return base
}
