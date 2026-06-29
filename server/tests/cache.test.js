import { test, expect } from 'vitest'
import { createCache } from '../src/cache.js'

test('set 后 get 拿到带信封的数据', () => {
  const c = createCache()
  c.set('k', [1, 2])
  const e = c.get('k')
  expect(e.data).toEqual([1, 2])
  expect(e.stale).toBe(false)
  expect(typeof e.updatedAt).toBe('number')
})

test('markStale 只翻标记不动 data', () => {
  const c = createCache()
  c.set('k', { a: 1 })
  const before = c.get('k').updatedAt
  c.markStale('k')
  expect(c.get('k').stale).toBe(true)
  expect(c.get('k').data).toEqual({ a: 1 })
  expect(c.get('k').updatedAt).toBe(before)
})

test('markStale 不存在的 key 安全', () => {
  const c = createCache()
  expect(() => c.markStale('none')).not.toThrow()
})

test('get 未知 key 返回 undefined', () => {
  expect(createCache().get('x')).toBeUndefined()
})
