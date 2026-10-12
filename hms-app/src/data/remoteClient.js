// RemoteApiClient — the network seam (backend contract: FRONTEND_SPEC §7).
// The ONE file to change when the real API lands: replace the stub bodies below
// with fetch()/axios calls. Correctness depends on server-side idempotency —
// each op carries an opId the server must apply at most once (§6).

export class RemoteApiClient {
  constructor({ latencyMs = 400 } = {}) {
    this.latencyMs = latencyMs
    this.baseUrl = String(import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')
    this.configured = Boolean(this.baseUrl) && import.meta.env.VITE_ENABLE_SYNC === 'true'
  }

  // Push a batch of outbox ops. Returns { acked: [opId], rejected: [{opId,reason}] }.
  //
  // REAL IMPLEMENTATION (later):
  //   const res = await fetch(`${BASE}/sync`, {
  //     method: 'POST',
  //     headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  //     body: JSON.stringify({ ops }),
  //   })
  //   if (!res.ok) throw new NetworkError(res.status)
  //   return res.json()  // server dedupes on opId and returns which it accepted
  async pushOps(ops) {
    await this._delay()
    if (!navigator.onLine) {
      // Mirror a real network failure so the sync engine keeps ops queued.
      throw new Error('offline')
    }
    // This app has no configured API endpoint. Keep writes queued until a real
    // server confirms durable receipt; never report a simulated acknowledgement.
    if (!this.configured) throw new Error('Sync server is not configured; local changes remain on this device')
    const response = await fetch(`${this.baseUrl}/sync`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops }),
    })
    if (!response.ok) throw new Error(`Sync failed (${response.status})`)
    return response.json()
  }

  // Placeholder for the eventual server→client direction (initial hydrate,
  // deltas since a cursor). Returns nothing until the backend defines it.
  async pull() {
    await this._delay()
    return { changes: [], cursor: null }
  }

  _delay() {
    // Fixed simulated latency (no Math.random — keeps behaviour deterministic).
    return new Promise((r) => setTimeout(r, this.latencyMs))
  }
}
