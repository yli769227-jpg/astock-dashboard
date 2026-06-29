import { ref, watch } from 'vue'
import { getJson } from './api.js'

export function usePolling(path, intervalMs) {
  const getUrl = typeof path === 'function' ? path : () => path
  const data = ref(null)
  const updatedAt = ref(null)
  const stale = ref(false)
  const error = ref(false)
  let timer = null
  let fails = 0
  let stopped = true
  let paused = false

  async function tick() {
    try {
      const env = await getJson(getUrl())
      data.value = env.data
      updatedAt.value = env.updatedAt
      stale.value = env.stale
      fails = 0
      error.value = false
    } catch {
      fails += 1
      if (fails >= 3) error.value = true
    } finally {
      if (!stopped && !paused) timer = setTimeout(tick, intervalMs)
    }
  }

  function onVisibility() {
    if (document.hidden) {
      paused = true
      if (timer) clearTimeout(timer)
      timer = null
    } else {
      paused = false
      if (!stopped) tick()
    }
  }

  // 响应式 URL（getter 形式）变化时立即重拉一次，无需重建 poll 实例
  if (typeof path === 'function') {
    watch(path, () => {
      if (stopped || paused) return
      if (timer) clearTimeout(timer)
      tick()
    })
  }

  return {
    data, updatedAt, stale, error,
    start() {
      paused = false
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
