import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPoller } from '../src/poller.js'
import { createCache } from '../src/cache.js'

const noopLog = { info() {}, warn() {}, error() {} }
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

test('start 立即拉一次并写缓存', async () => {
  const cache = createCache()
  const fetcher = vi.fn(async () => [42])
  const p = createPoller({ key: 'r', intervalMs: 3000, fetcher, cache, logger: noopLog })
  p.start()
  await vi.advanceTimersByTimeAsync(0)
  expect(cache.get('r').data).toEqual([42])
  p.stop()
})

test('失败时标 stale 且不抛出', async () => {
  const cache = createCache()
  cache.set('r', ['旧'])
  const fetcher = vi.fn(async () => { throw new Error('boom') })
  const p = createPoller({ key: 'r', intervalMs: 3000, fetcher, cache, logger: noopLog })
  p.start()
  await vi.advanceTimersByTimeAsync(0)
  expect(cache.get('r').stale).toBe(true)
  expect(cache.get('r').data).toEqual(['旧']) // 旧快照保留
  p.stop()
})

test('stop 后不再拉取', async () => {
  const cache = createCache()
  const fetcher = vi.fn(async () => [1])
  const p = createPoller({ key: 'r', intervalMs: 1000, fetcher, cache, logger: noopLog })
  p.start()
  await vi.advanceTimersByTimeAsync(0)
  p.stop()
  await vi.advanceTimersByTimeAsync(5000)
  expect(fetcher).toHaveBeenCalledTimes(1)
})
