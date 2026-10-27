// What the phone keeps, in IndexedDB: the settings, the encrypted file (a
// copy of the one on GitHub, so the app works offline), the GitHub token
// (sealed with the data key) and, while it is remembered, the data key as a
// CryptoKey that cannot be read back out (only used to seal and open).

const NAME = "todo-lists"
const STORE = "kv"

let opening = null

function db() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return opening
}

async function run(mode, fn) {
  const d = await db()
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode)
    const req = fn(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(req ? req.result : undefined)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export const get = key => run("readonly", s => s.get(key))
export const set = (key, value) => run("readwrite", s => s.put(value, key))
export const del = key => run("readwrite", s => s.delete(key))
export const clear = () => run("readwrite", s => s.clear())
