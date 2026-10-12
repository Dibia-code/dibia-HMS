import { initialData } from './seed'

// Console data layer — always-online, so no IndexedDB/outbox. Pages talk to a
// `repository` with a small async CRUD surface and read via useLiveQuery + dataBus.
// Today it's LocalConsoleRepository (in-memory, seeded); swap in RemoteConsoleClient
// (see remoteClient.js) to go live and every page is untouched.

// Change bus — repository mutations emit 'change'; useLiveQuery re-runs on it.
export const dataBus = new EventTarget()
const emitChange = () => dataBus.dispatchEvent(new Event('change'))

const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)))
const nowIso = () => new Date().toISOString()
const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id_${Math.random().toString(36).slice(2)}`
const STORAGE_KEY = 'dibia-console-demo-data-v1'

function readDemoData() {
  if (typeof localStorage === 'undefined') return initialData()
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) : initialData()
  } catch {
    return initialData()
  }
}

export class LocalConsoleRepository {
  constructor(data = readDemoData()) {
    // entity -> Map<id, record>
    this.stores = {}
    for (const [entity, rows] of Object.entries(data)) {
      const map = new Map()
      for (const row of rows) map.set(row.id, clone(row))
      this.stores[entity] = map
    }
  }

  _store(entity) {
    if (!this.stores[entity]) this.stores[entity] = new Map()
    return this.stores[entity]
  }

  _persist() {
    if (typeof localStorage === 'undefined') return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(
        Object.entries(this.stores).map(([entity, rows]) => [entity, [...rows.values()]]),
      )))
    } catch { /* Demo actions still work in memory if browser storage is unavailable. */ }
  }

  // Read a list, optionally filtered and sorted. `filter` is a predicate;
  // `sort` is a comparator. Returns cloned records so callers can't mutate state.
  async list(entity, { filter, sort } = {}) {
    let rows = [...this._store(entity).values()].map(clone)
    if (filter) rows = rows.filter(filter)
    if (sort) rows.sort(sort)
    return rows
  }

  async get(entity, id) {
    const row = this._store(entity).get(id)
    return row ? clone(row) : null
  }

  async create(entity, data) {
    const id = data.id || newId()
    const record = { id, createdAt: nowIso(), updatedAt: nowIso(), ...data }
    this._store(entity).set(id, clone(record))
    this._persist()
    emitChange()
    return clone(record)
  }

  async update(entity, id, patch) {
    const store = this._store(entity)
    const current = store.get(id)
    if (!current) throw new Error(`${entity} ${id} not found`)
    const next = { ...current, ...patch, updatedAt: nowIso() }
    store.set(id, clone(next))
    this._persist()
    emitChange()
    return clone(next)
  }

  async remove(entity, id) {
    this._store(entity).delete(id)
    this._persist()
    emitChange()
  }
}
