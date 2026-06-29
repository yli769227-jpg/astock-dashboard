import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseRanking, parseOverview, parseSectors, parseTimeline } from '../src/eastmoney/parse.js'

const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url)))

test('parseRanking 翻译编号字段为语义字段', () => {
  const rows = parseRanking(load('ranking'))
  expect(rows.length).toBeGreaterThan(0)
  const r = rows[0]
  expect(r).toHaveProperty('code')
  expect(r).toHaveProperty('name')
  expect(typeof r.changePct).toBe('number')
})

test('parseRanking 缺 f12 的条目被跳过而非抛错', () => {
  const broken = { data: { diff: [{ f14: '无代码股', f3: 1.2 }, { f12: '600000', f14: '浦发', f3: 0.5 }] } }
  const rows = parseRanking(broken)
  expect(rows).toHaveLength(1)
  expect(rows[0].code).toBe('600000')
})

test('parseRanking 结构异常返回空数组', () => {
  expect(parseRanking({})).toEqual([])
  expect(parseRanking(null)).toEqual([])
})

test('parseOverview 取出三大指数', () => {
  const { indices } = parseOverview(load('overview'))
  expect(indices.length).toBe(3)
  expect(indices[0]).toHaveProperty('changePct')
})

test('parseOverview 把 ×100 整数还原为浮点（ulist 无 fltt=2）', () => {
  // 上证指数 3021.50 / +0.80% / +24.00 在 ulist 接口里是 302150 / 80 / 2400
  const raw = { data: { diff: [{ f12: '000001', f14: '上证指数', f2: 302150, f3: 80, f4: 2400 }] } }
  const { indices } = parseOverview(raw)
  expect(indices[0].price).toBeCloseTo(3021.5, 2)
  expect(indices[0].changePct).toBeCloseTo(0.8, 2)
  expect(indices[0].changeAmt).toBeCloseTo(24, 2)
})

test('parseSectors 含领涨股字段', () => {
  const rows = parseSectors(load('sectors'))
  expect(rows[0]).toHaveProperty('leader')
})

test('parseTimeline 解析分时点', () => {
  const t = parseTimeline(load('timeline'))
  expect(Array.isArray(t.points)).toBe(true)
  expect(t.points[0]).toHaveProperty('time')
  expect(t.points[0]).toHaveProperty('price')
  expect(t.points[0].volume).toBe(2942)
  expect(t.points[0].avg).toBe(8.750)
})

test('parseTimeline 昨收取 preSettlement，0 视为 null', () => {
  const withPrev = { data: { code: '600000', market: 1, preSettlement: 9.87, trends: ['09:30,10,1000,10'] } }
  expect(parseTimeline(withPrev).prevClose).toBe(9.87)
  const zeroPrev = { data: { code: '600000', market: 1, preSettlement: 0, trends: [] } }
  expect(parseTimeline(zeroPrev).prevClose).toBeNull()
})
