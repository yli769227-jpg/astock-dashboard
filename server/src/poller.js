const MAX_BACKOFF = 30000

export function createPoller({ key, intervalMs, fetcher, cache, logger, intervalFn }) {
  let timer = null
  let stopped = false
  let backoff = intervalMs

  // 成功后的基准间隔：有 intervalFn 用之（非交易时段降频），否则用固定 intervalMs
  const baseInterval = () => (intervalFn ? intervalFn(new Date()) : intervalMs)

  async function tick() {
    const t0 = Date.now()
    let next
    try {
      const data = await fetcher()
      cache.set(key, data)
      next = baseInterval() // 成功：复位到基准间隔
      const n = Array.isArray(data) ? data.length : '1'
      logger.info(`[东方财富] 拉取 ${key} OK ${n} 条 耗时 ${Date.now() - t0}ms`)
    } catch (err) {
      cache.markStale(key)
      backoff = Math.min(Math.max(backoff, baseInterval()) * 2, MAX_BACKOFF)
      next = backoff
      logger.warn(`[降级] ${key} 抓取失败：${err.message}，供给旧快照，下次 ${next}ms 后重试`)
    } finally {
      if (next === baseInterval()) backoff = baseInterval() // 成功后退避归位
      if (!stopped) timer = setTimeout(tick, next)
    }
  }

  return {
    start() { stopped = false; tick() },
    stop() { stopped = true; if (timer) clearTimeout(timer); timer = null },
  }
}
