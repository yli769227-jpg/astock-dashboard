import { test, expect, vi, afterEach } from 'vitest'
import { fetchRanking } from '../src/eastmoney/fetch.js'

afterEach(() => vi.unstubAllGlobals())

test('fetchRanking 成功解析', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200,
    json: async () => ({ data: { diff: [{ f12: '600000', f14: '浦发', f3: 1.1 }] } }),
  })))
  const rows = await fetchRanking('up')
  expect(rows[0].code).toBe('600000')
})

test('fetchRanking 非 2xx 抛错', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })))
  await expect(fetchRanking('up')).rejects.toThrow(/403/)
})
