import { test, expect } from 'vitest'
import { buildApp } from '../src/app.js'

test('GET /health 返回 ok', async () => {
  const app = buildApp()
  const res = await app.inject({ method: 'GET', url: '/health' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ status: 'ok' })
  await app.close()
})
