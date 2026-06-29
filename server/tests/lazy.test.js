import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLazyManager } from '../src/lazy.js'
import { createCache } from '../src/cache.js'

const noopLog = { info() {}, warn() {}, error() {} }
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

test('首个 acquire 触发拉取', async () => {
  const cache = createCache()
  const m = createLazyManager({ cache, logger: noopLog, makeFetcher: (k) => async () => [k], idleMs: 60000 })
  m.acquire('sector:BK1')
  await vi.advanceTimersByTimeAsync(0)
  expect(cache.get('sector:BK1').data).toEqual(['sector:BK1'])
  m._stopAll()
})

test('停止访问超过 idle 后停拉', async () => {
  const cache = createCache()
  const fetcher = vi.fn(async () => [1])
  const m = createLazyManager({ cache, logger: noopLog, makeFetcher: () => fetcher, idleMs: 60000 })
  m.acquire('k')
  await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(71000) // 不再 acquire，超过 idle + sweep
  const after = fetcher.mock.calls.length
  await vi.advanceTimersByTimeAsync(10000)
  expect(fetcher.mock.calls.length).toBe(after) // 已停拉
  m._stopAll()
})

test('持续 acquire 续命则不停拉', async () => {
  const cache = createCache()
  const fetcher = vi.fn(async () => [1])
  const m = createLazyManager({ cache, logger: noopLog, makeFetcher: () => fetcher, idleMs: 60000 })
  m.acquire('k')
  for (let i = 0; i < 10; i++) { await vi.advanceTimersByTimeAsync(10000); m.acquire('k') }
  const before = fetcher.mock.calls.length
  await vi.advanceTimersByTimeAsync(6000)
  expect(fetcher.mock.calls.length).toBeGreaterThan(before)
  m._stopAll()
})
