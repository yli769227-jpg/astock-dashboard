export function createCache() {
  const store = new Map()
  return {
    set(key, data) {
      store.set(key, { data, updatedAt: Date.now(), stale: false })
    },
    get(key) {
      return store.get(key)
    },
    markStale(key) {
      const e = store.get(key)
      if (e) e.stale = true
    },
  }
}
