import { getDB } from './db'

// SyncEngine — replays the outbox to the server when online (§6). Ops drain in
// insertion order and leave the outbox only after the server acks their opId;
// a single-flight guard stops overlapping triggers from double-sending.

const BATCH_SIZE = 50
const pollMs = () => Math.max(5, Number(localStorage.getItem('dibia.syncIntervalSec')) || 15) * 1000

export class SyncEngine {
  constructor(remote) {
    this.remote = remote
    this.syncing = false
    this.lastSyncAt = null
    this.lastError = null
    this.pending = 0
    this._listeners = new Set()
    this._timer = null
    this._onOnline = () => this.drain()
    this._onOffline = () => this._emit()
  }

  start() {
    window.addEventListener('online', this._onOnline)
    window.addEventListener('offline', this._onOffline)
    this._timer = setInterval(() => this.drain(), pollMs())
    this.refreshPending().then(() => this.drain())
  }

  stop() {
    window.removeEventListener('online', this._onOnline)
    window.removeEventListener('offline', this._onOffline)
    if (this._timer) clearInterval(this._timer)
    this._timer = null
  }

  get online() {
    return navigator.onLine
  }

  getState() {
    return {
      online: this.online,
      configured: this.remote.configured !== false,
      syncing: this.syncing,
      pending: this.pending,
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
    }
  }

  subscribe(listener) {
    this._listeners.add(listener)
    listener(this.getState())
    return () => this._listeners.delete(listener)
  }

  async refreshPending() {
    const db = await getDB()
    this.pending = await db.count('outbox')
    this._emit()
    return this.pending
  }

  // Nudge after a write so the chip's pending count updates immediately and we
  // attempt to flush right away when online.
  async notifyWrite() {
    await this.refreshPending()
    this.drain()
  }

  async drain() {
    if (this.remote.configured === false) {
      this.lastError = null
      this._emit()
      return
    }
    if (this.syncing || !this.online) {
      this._emit()
      return
    }
    this.syncing = true
    this.lastError = null
    this._emit()

    try {
      const db = await getDB()
      // Ordered read: getAll on an autoIncrement keyPath returns seq order.
      let queue = await db.getAll('outbox')

      while (queue.length) {
        const batch = queue.slice(0, BATCH_SIZE)
        const ops = batch.map((e) => ({
          opId: e.opId,
          entity: e.entity,
          op: e.op,
          recordId: e.recordId,
          payload: e.payload,
        }))

        // Throws when offline / network error → caught below, ops stay queued.
        const { acked } = await this.remote.pushOps(ops)

        const ackedSet = new Set(acked)
        const seqBySameOp = new Map(batch.map((e) => [e.opId, e.seq]))
        const delTx = db.transaction('outbox', 'readwrite')
        for (const opId of ackedSet) {
          const seq = seqBySameOp.get(opId)
          if (seq != null) await delTx.objectStore('outbox').delete(seq)
        }
        await delTx.done

        queue = queue.slice(batch.length)
        this.pending = await db.count('outbox')
        this._emit()
      }

      this.lastSyncAt = new Date().toISOString()
    } catch (err) {
      // Expected whenever we drop offline mid-drain; keep the queue intact.
      this.lastError = err?.message || 'sync failed'
    } finally {
      this.syncing = false
      await this.refreshPending()
    }
  }

  _emit() {
    const state = this.getState()
    for (const l of this._listeners) l(state)
  }
}
