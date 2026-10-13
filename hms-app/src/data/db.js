import { openDB } from 'idb'
import { DB_NAME, DB_VERSION, STORES } from './schema'

let dbPromise = null

// Singleton connection. idb wraps IndexedDB in promises; we build every store
// and index from the schema on upgrade so there's one source of truth.
export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, newVersion, transaction) {
        for (const [name, def] of Object.entries(STORES)) {
          const store = db.objectStoreNames.contains(name)
            ? transaction.objectStore(name)
            : db.createObjectStore(name, { keyPath: def.keyPath, autoIncrement: !!def.autoIncrement })
          for (const idx of def.indexes || []) {
            if (!store.indexNames.contains(idx.name)) store.createIndex(idx.name, idx.keyPath, { unique: !!idx.unique })
          }
        }

        if (oldVersion < 4) {
          // Move the tenant store to the HMS name and migrate tenant keys in
          // place so existing offline hospital data remains available.
          if (db.objectStoreNames.contains('pharmacies')) {
            const oldStore = transaction.objectStore('pharmacies')
            const hospitals = transaction.objectStore('hospitals')
            const cursorRequest = oldStore.openCursor()
            cursorRequest.onsuccess = () => {
              const cursor = cursorRequest.result
              if (!cursor) {
                db.deleteObjectStore('pharmacies')
                return
              }
              if (cursor.value.id !== 'ph_johncool' && cursor.value.id !== 'ph_dibia') {
                const hospital = cursor.value
                if (hospital.id === 'ph_demo_hosp') hospital.id = 'hosp_demo'
                hospitals.put(hospital)
              }
              cursor.continue()
            }
          }

          for (const name of Object.keys(STORES)) {
            const store = transaction.objectStore(name)
            if (store.indexNames.contains('by_pharmacy')) store.deleteIndex('by_pharmacy')
            const cursorRequest = store.openCursor()
            cursorRequest.onsuccess = () => {
              const cursor = cursorRequest.result
              if (!cursor) return
              const row = cursor.value
              const tenantId = row.hospitalId || row.pharmacyId
              if (tenantId === 'ph_johncool' || tenantId === 'ph_dibia') {
                cursor.delete()
              } else {
                if (Object.prototype.hasOwnProperty.call(row, 'pharmacyId')) {
                  row.hospitalId = row.pharmacyId
                  delete row.pharmacyId
                }
                if (row.hospitalId === 'ph_demo_hosp') row.hospitalId = 'hosp_demo'
                if (name === 'hospitals' && row.id === 'ph_demo_hosp') row.id = 'hosp_demo'
                if (Object.prototype.hasOwnProperty.call(row, 'hospitalId') || (name === 'hospitals' && row.id === 'hosp_demo')) {
                  cursor.update(row)
                }
              }
              cursor.continue()
            }
          }
        }

        if (oldVersion < 6) {
          // Older offline databases may contain duplicate legacy values in
          // indexes that used to be unique. Rebuild those indexes as
          // non-unique so one dirty cache cannot abort the entire upgrade.
          // The backend remains authoritative for account and tenant identity.
          for (const [name, def] of Object.entries(STORES)) {
            if (!db.objectStoreNames.contains(name)) continue
            const store = transaction.objectStore(name)
            for (const idx of def.indexes || []) {
              if (!store.indexNames.contains(idx.name)) continue
              if (store.index(idx.name).unique === !!idx.unique) continue
              store.deleteIndex(idx.name)
              store.createIndex(idx.name, idx.keyPath, { unique: !!idx.unique })
            }
          }
        }
      },
      blocked() {
        // Another tab holds an older version open. Surfaced so the UI can warn.
        console.warn('[dibia] IndexedDB upgrade blocked by another open tab')
      },
    })
  }
  return dbPromise
}

// Test/reset helper — wipes the whole database (used by "reset demo data").
export async function deleteDatabase() {
  if (dbPromise) {
    const db = await dbPromise
    db.close()
    dbPromise = null
  }
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => resolve()
  })
}
