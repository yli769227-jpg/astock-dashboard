import { test, expect, vi } from 'vitest'
import Fastify from 'fastify'
import { registerRoutes } from '../src/routes.js'
import { createCache } from '../src/cache.js'

function fakeLazy(cache) {
  return {
    acquire: vi.fn(() => () => {}),
    getOrNull: (key) => cache.get(key) ?? null,
  }
}

test('/api/overview 返回信封结构', async () => {
  const cache = createCache()
  cache.set('overview', { indices: [{ code: '000001' }] })
  const app = Fastify()
  registerRoutes(app, { cache, lazy: fakeLazy(cache) })
  const res = await app.inject({ url: '/api/overview' })
  const body = res.json()
  expect(body).toHaveProperty('data')
  expect(body).toHaveProperty('updatedAt')
  expect(body).toHaveProperty('stale')
  await app.close()
})

test('/api/ranking 非法 type 回退 up', async () => {
  const cache = createCache()
  cache.set('ranking:up', [{ code: '600000' }])
  const app = Fastify()
  registerRoutes(app, { cache, lazy: fakeLazy(cache) })
  const res = await app.inject({ url: '/api/ranking?type=xxx' })
  expect(res.json().data[0].code).toBe('600000')
  await app.close()
})

test('/api/sector/:code/stocks 触发 lazy.acquire', async () => {
  const cache = createCache()
  const lazy = fakeLazy(cache)
  const app = Fastify()
  registerRoutes(app, { cache, lazy })
  await app.inject({ url: '/api/sector/BK0475/stocks' })
  expect(lazy.acquire).toHaveBeenCalledWith('sector:BK0475')
  await app.close()
})

test('/api/stock/:code/timeline?market=0 触发 lazy.acquire 带市场后缀', async () => {
  const cache = createCache()
  const lazy = fakeLazy(cache)
  const app = Fastify()
  registerRoutes(app, { cache, lazy })
  await app.inject({ url: '/api/stock/920819/timeline?market=0' })
  expect(lazy.acquire).toHaveBeenCalledWith('timeline:920819:0')
  await app.close()
})

test('缓存为空时返回 data:null 而非报错', async () => {
  const cache = createCache()
  const app = Fastify()
  registerRoutes(app, { cache, lazy: fakeLazy(cache) })
  const res = await app.inject({ url: '/api/overview' })
  expect(res.statusCode).toBe(200)
  expect(res.json().data).toBeNull()
  await app.close()
})
