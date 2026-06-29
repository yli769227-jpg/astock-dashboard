import { ref } from 'vue'
import { getJson } from './api.js'

export function usePolling(path, intervalMs) {
  const data = ref(null)
  const updatedAt = ref(null)
  const stale = ref(false)
  const error = ref(false)
  let timer = null
  let fails = 0
  let stopped = true

  async function tick() {
    try {
      const env = await getJson(path)
      data.value = env.data
      updatedAt.value = env.updatedAt
      stale.value = env.stale
      fails = 0
      error.value = false
    } catch {
      fails += 1
      if (fails >= 3) error.value = true
    } finally {
      if (!stopped) timer = setTimeout(tick, intervalMs)
    }
  }

  function onVisibility() {
    if (document.hidden) { if (timer) clearTimeout(timer); timer = null }
    else if (!stopped) tick()
  }

  return {
    data, updatedAt, stale, error,
    start() {
      stopped = false
      document.addEventListener('visibilitychange', onVisibility)
      tick()
    },
    stop() {
      stopped = true
      if (timer) clearTimeout(timer); timer = null
      document.removeEventListener('visibilitychange', onVisibility)
    },
  }
}
