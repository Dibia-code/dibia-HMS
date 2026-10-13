// Backend API client for tenant-scoped sync and snapshot hydration.
import { apiBase } from '@/lib/apiBase'

export class RemoteApiClient {
  constructor() {
    this.baseUrl = apiBase()
    this.hasEndpoint = Boolean(this.baseUrl) && (import.meta.env.PROD || import.meta.env.VITE_ENABLE_SYNC === 'true' || import.meta.env.VITE_HMS_BACKEND_AUTH === 'true')
    this.accessToken = null
    this.hospitalId = null
    this.backendBranchId = null
    this.cursorKey = 'dibia.syncCursor'
    this.refreshPromise = null
  }

  get configured() { return this.hasEndpoint && !!this.accessToken }
  setAccessToken(token, hospitalId, backendBranchId) {
    this.accessToken = token || null
    this.hospitalId = hospitalId || null
    this.backendBranchId = backendBranchId || null
    if (hospitalId) this.cursorKey = `dibia.syncCursor.${hospitalId}`
  }

  async request(url, options) {
    const send = () => fetch(url, { ...options, headers: { ...options.headers, ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}) } })
    let response = await send()
    if (response.status === 401 && this.hasEndpoint) {
      if (!this.refreshPromise) {
        this.refreshPromise = fetch(`${this.baseUrl}/auth/refresh`, { method: 'POST', credentials: 'include' })
          .then(async (refresh) => ({ ok: refresh.ok, session: await refresh.json().catch(() => ({})) }))
          .finally(() => { this.refreshPromise = null })
      }
      const { ok, session } = await this.refreshPromise
      if (ok && session.accessToken) {
        this.setAccessToken(session.accessToken, this.hospitalId, this.backendBranchId)
        response = await send()
      }
      if (response.status === 401) window.dispatchEvent(new CustomEvent('dibia:session-expired'))
    }
    return response
  }

  // Push a batch of outbox ops. Returns { acked: [opId], rejected: [{opId,reason}] }.
  async pushOps(ops) {
    if (!navigator.onLine) {
      // Mirror a real network failure so the sync engine keeps ops queued.
      throw new Error('offline')
    }
    if (!this.configured) throw new Error('Sync server is not configured; local changes remain on this device')
    const response = await this.request(`${this.baseUrl}/sync`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ops }),
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.message || `Sync failed (${response.status})`)
    if (Array.isArray(result.rejected) && result.rejected.length) {
      const reason = result.rejected[0]?.message || 'The server rejected a local change'
      throw new Error(`Sync needs attention: ${reason}`)
    }
    return result
  }

  async pull(cursor = 0) {
    if (!this.configured) return { changes: [], cursor: null }
    const response = await this.request(`${this.baseUrl}/sync?cursor=${Number(cursor || 0)}`, {
      credentials: 'include', headers: {},
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.message || `Sync pull failed (${response.status})`)
    return result
  }

  async snapshot(cursor = null) {
    if (!this.configured) throw new Error('Hospital data server is not configured')
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
    const response = await this.request(`${this.baseUrl}/sync/snapshot${query}`, { credentials: 'include', headers: {} })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.message || `Hospital snapshot failed (${response.status})`)
    return result
  }
}
