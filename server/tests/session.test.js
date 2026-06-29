import { test, expect } from 'vitest'
import { isTradingTime, residentInterval, sessionLabel } from '../src/session.js'

// 2026-06-29 是周一
const at = (h, m) => new Date(2026, 5, 29, h, m, 0)

test('上午盘中为交易时段', () => {
  expect(isTradingTime(at(10, 0))).toBe(true)
})
test('午间休市非交易时段', () => {
  expect(isTradingTime(at(12, 0))).toBe(false)
  expect(sessionLabel(at(12, 0))).toBe('午间休市')
})
test('收盘后非交易时段', () => {
  expect(isTradingTime(at(15, 30))).toBe(false)
  expect(sessionLabel(at(15, 30))).toBe('已收盘')
})
test('周末非交易', () => {
  const sat = new Date(2026, 5, 27, 10, 0) // 周六
  expect(isTradingTime(sat)).toBe(false)
})
test('交易时段 resident 间隔 3s，否则 30s', () => {
  expect(residentInterval(at(10, 0))).toBe(3000)
  expect(residentInterval(at(20, 0))).toBe(30000)
})
