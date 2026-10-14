export function apiBase() {
  if (import.meta.env.PROD) return '/api'
  return String(import.meta.env.VITE_API_URL || 'http://127.0.0.1:4000').replace(/\/+$/, '')
}
