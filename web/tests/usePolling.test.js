import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { usePolling } from '../src/usePolling.js'
import * as api from '../src/api.js'

beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

test('start 立即拉一次并填充 data', async () => {
  vi.spyOn(api, 'getJson').mockResolvedValue({ data: [1], updatedAt: 123, stale: false })
  const p = usePolling('/api/ranking', 3000)
  p.start()
  await vi.advanceTimersByTimeAsync(0)
  expect(p.data.value).toEqual([1])
  expect(p.stale.value).toBe(false)
  p.stop()
})

test('连续 3 次失败才置 error', async () => {
  vi.spyOn(api, 'getJson').mockRejectedValue(new Error('x'))
  const p = usePolling('/api/ranking', 1000)
  p.start()
  await vi.advanceTimersByTimeAsync(0)
  expect(p.error.value).toBeFalsy() // 第 1 次失败不报
  await vi.advanceTimersByTimeAsync(1000)
  await vi.advanceTimersByTimeAsync(1000)
  expect(p.error.value).toBeTruthy() // 第 3 次
  p.stop()
})

test('stop 后不再拉', async () => {
  const spy = vi.spyOn(api, 'getJson').mockResolvedValue({ data: [], updatedAt: 1, stale: false })
  const p = usePolling('/api/x', 1000)
  p.start(); await vi.advanceTimersByTimeAsync(0); p.stop()
  await vi.advanceTimersByTimeAsync(5000)
  expect(spy).toHaveBeenCalledTimes(1)
})
