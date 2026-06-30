import { test, expect } from 'vitest'
import { rankingUrl, sectorsUrl, toSecid, timelineUrl } from '../src/eastmoney/endpoints.js'

test('涨幅榜 url 用 fid=f3 且降序 po=1', () => {
  const u = rankingUrl({ type: 'up', limit: 50 })
  expect(u).toContain('fid=f3')
  expect(u).toContain('po=1')
  expect(u).toContain('pz=50')
})

test('跌幅榜降序参数为升序 po=0', () => {
  expect(rankingUrl({ type: 'down', limit: 50 })).toContain('po=0')
})

test('行业板块 fs=m:90 t:2', () => {
  expect(sectorsUrl({ type: 'industry' })).toContain('m%3A90%2Bt%3A2')
})

test('toSecid 沪市 6 开头前缀 1', () => {
  expect(toSecid({ code: '600000' })).toBe('1.600000')
})

test('toSecid 深市 0 开头前缀 0', () => {
  expect(toSecid({ code: '000001' })).toBe('0.000001')
})

test('toSecid 优先用 marketId', () => {
  expect(toSecid({ code: '600000', marketId: 0 })).toBe('0.600000')
})

test('toSecid 北交所 920819 带 marketId:0 不误判为沪市', () => {
  expect(toSecid({ code: '920819', marketId: 0 })).toBe('0.920819')
})

test('toSecid 北交所 4 开头（430090）无 marketId 也映射到 0.xxxxx', () => {
  expect(toSecid({ code: '430090' })).toBe('0.430090')
})

test('toSecid 北交所 8 开头（830001）无 marketId 也映射到 0.xxxxx', () => {
  expect(toSecid({ code: '830001' })).toBe('0.830001')
})

test('timelineUrl 带 secid', () => {
  expect(timelineUrl({ secid: '1.600000' })).toContain('secid=1.600000')
})
