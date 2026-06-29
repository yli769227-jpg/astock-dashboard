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
  expect(p.error.value).toBeFalsy() // 第 2 次失败也不报
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

test('tab 隐藏时暂停轮询，恢复可见时立即拉一次', async () => {
  const spy = vi.spyOn(api, 'getJson').mockResolvedValue({ data: [1], updatedAt: 1, stale: false })
  const p = usePolling('/api/x', 1000)
  p.start()
  await vi.advanceTimersByTimeAsync(0)
  const afterStart = spy.mock.calls.length
  // 模拟 tab 隐藏
  Object.defineProperty(document, 'hidden', { value: true, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
  await vi.advanceTimersByTimeAsync(5000)
  expect(spy.mock.calls.length).toBe(afterStart)
  // 模拟 tab 恢复可见
  Object.defineProperty(document, 'hidden', { value: false, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
  await vi.advanceTimersByTimeAsync(0)
  expect(spy.mock.calls.length).toBeGreaterThan(afterStart)
  p.stop()
  // 恢复 document.hidden 为 false 用于后续测试
  Object.defineProperty(document, 'hidden', { value: false, configurable: true })
})

test('path 为响应式 getter 时，URL 变化立即重新拉取新地址', async () => {
  const { ref } = await import('vue')
  const spy = vi.spyOn(api, 'getJson').mockResolvedValue({ data: [1], updatedAt: 1, stale: false })
  const type = ref('up')
  const p = usePolling(() => `/api/ranking?type=${type.value}`, 3000)
  p.start()
  await vi.advanceTimersByTimeAsync(0)
  expect(spy).toHaveBeenLastCalledWith('/api/ranking?type=up')
  type.value = 'down'                       // 改变响应式依赖
  await vi.advanceTimersByTimeAsync(0)       // 应立即用新 URL 重拉
  expect(spy).toHaveBeenLastCalledWith('/api/ranking?type=down')
  p.stop()
})
