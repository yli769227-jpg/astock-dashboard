import { createPoller } from './poller.js'

export function createLazyManager({ cache, logger, makeFetcher, idleMs = 60000 }) {
  const entries = new Map() // key -> { poller, lastSeen }

  function sweep() {
    const now = Date.now()
    for (const [key, e] of entries) {
      if (now - e.lastSeen > idleMs) {
        e.poller.stop()
        entries.delete(key)
        logger.info(`[懒加载] ${key} 空闲 ${idleMs}ms 停拉`)
      }
    }
  }
  const sweeper = setInterval(sweep, 10000)
  if (sweeper.unref) sweeper.unref()

  return {
    acquire(key) {
      let e = entries.get(key)
      if (!e) {
        const poller = createPoller({ key, intervalMs: 5000, fetcher: makeFetcher(key), cache, logger })
        e = { poller, lastSeen: Date.now() }
        entries.set(key, e)
        poller.start()
        logger.info(`[懒加载] ${key} 进入活跃清单`)
      } else {
        e.lastSeen = Date.now() // 续命
      }
    },
    getOrNull(key) { return cache.get(key) ?? null },
    _stopAll() { clearInterval(sweeper); for (const e of entries.values()) e.poller.stop() },
  }
}
