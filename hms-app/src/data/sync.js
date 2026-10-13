import { getDB } from './db'
import { STORES } from './schema'
import { dataBus } from './repository'

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
    this.otherPending = 0
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
      otherPending: this.otherPending,
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
    const queue = await db.getAll('outbox')
    const tenantId = this.remote.configured ? this.remote.hospitalId : null
    if (!tenantId) {
      this.pending = queue.length
      this.otherPending = 0
    } else {
      const staffIds = new Set((await db.getAll('staff')).filter((staff) => staff.hospitalId === tenantId).map((staff) => staff.id))
      const belongsToTenant = (entry) => {
        const payload = entry.payload || {}
        return payload.hospitalId === tenantId || entry.tenantId === tenantId ||
          (entry.entity === 'hospitals' && entry.recordId === tenantId) ||
          (entry.entity === 'staff_roles' && staffIds.has(payload.staffId))
      }
      this.pending = queue.filter(belongsToTenant).length
      this.otherPending = queue.length - this.pending
    }
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
      const tenantId = this.remote.hospitalId
      if (tenantId && typeof this.remote.snapshot === 'function') {
        const snapshotKey = `dibia.snapshot.${tenantId}`
        let pageCursor = localStorage.getItem(snapshotKey)
        let restartedSnapshot = false
        if (pageCursor !== 'done') {
          while (true) {
            let page
            try {
              page = await this.remote.snapshot(pageCursor || null)
            } catch (error) {
              if (!restartedSnapshot && /restart the snapshot/i.test(error?.message || '')) {
                restartedSnapshot = true
                pageCursor = null
                localStorage.removeItem(snapshotKey)
                continue
              }
              throw error
            }
            const pendingOps = await db.getAll('outbox')
            const pendingRecords = new Set(pendingOps.map((op) => `${op.entity}:${op.recordId}`))
            const pageEntities = [...new Set((page.records || []).map((row) => row.entity).filter((entity) => STORES[entity]))]
            const changed = new Set()
            if (pageEntities.length) {
              const transaction = db.transaction(pageEntities, 'readwrite')
              for (const row of page.records || []) {
                if (!STORES[row.entity] || !row.payload?.id || pendingRecords.has(`${row.entity}:${row.recordId}`)) continue
                await transaction.objectStore(row.entity).put(row.payload)
                changed.add(row.entity)
              }
              await transaction.done
            }
            if (changed.size) dataBus.dispatchEvent(new CustomEvent('change', { detail: { entities: [...changed] } }))
            pageCursor = page.nextCursor || null
            if (pageCursor) {
              localStorage.setItem(snapshotKey, pageCursor)
            } else {
              localStorage.setItem(snapshotKey, 'done')
              localStorage.setItem(this.remote.cursorKey || `dibia.syncCursor.${tenantId}`, String(page.deltaCursor || 0))
              break
            }
          }
        }
      }
      // Ordered read: getAll on an autoIncrement keyPath returns seq order.
      let queue = await db.getAll('outbox')
      const staffIds = new Set((await db.getAll('staff')).filter((staff) => staff.hospitalId === tenantId).map((staff) => staff.id))

      while (queue.length && tenantId) {
        const eligible = queue.filter((entry) => {
          const payload = entry.payload || {}
          if (payload.hospitalId === tenantId || entry.tenantId === tenantId) return true
          if (entry.entity === 'hospitals' && entry.recordId === tenantId) return true
          return entry.entity === 'staff_roles' && staffIds.has(payload.staffId)
        })
        // The IndexedDB outbox is shared by accounts used on this computer.
        // Keep other-tenant or unassigned entries intact for their owner, but
        // never let them block sync for the currently signed-in hospital.
        if (!eligible.length) break
        const batch = eligible.slice(0, BATCH_SIZE)
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

        const processed = new Set(batch.map((entry) => entry.opId))
        queue = queue.filter((entry) => !processed.has(entry.opId))
        await this.refreshPending()
        this._emit()
      }

      if (this.remote.configured && typeof this.remote.pull === 'function') {
        const cursorKey = this.remote.cursorKey || 'dibia.syncCursor'
        const cursor = Number(localStorage.getItem(cursorKey) || 0)
        const delta = await this.remote.pull(cursor)
        if (Array.isArray(delta.changes) && delta.changes.length) {
          const names = [...new Set(delta.changes.map((change) => change.entity).filter((entity) => STORES[entity]))]
          if (names.length) {
            const pendingOps = await db.getAll('outbox')
            const pendingRecords = new Set(pendingOps.map((op) => `${op.entity}:${op.recordId}`))
            const transaction = db.transaction(names, 'readwrite')
            const changed = new Set()
            for (const change of delta.changes) {
              if (!STORES[change.entity] || pendingRecords.has(`${change.entity}:${change.recordId}`)) continue
              const store = transaction.objectStore(change.entity)
              if (change.op === 'delete') await store.delete(change.recordId)
              else if (change.payload?.id) await store.put(change.payload)
              changed.add(change.entity)
            }
            await transaction.done
            if (changed.size) dataBus.dispatchEvent(new CustomEvent('change', { detail: { entities: [...changed] } }))
          }
        }
        if (Number.isFinite(Number(delta.cursor))) localStorage.setItem(cursorKey, String(delta.cursor))
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
