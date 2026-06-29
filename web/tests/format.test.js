import { test, expect } from 'vitest'
import { changeColor, fmtPct, fmtPrice, fmtAmount } from '../src/format.js'

test('changeColor 语义', () => {
  expect(changeColor(1.2)).toBe('up')
  expect(changeColor(-0.3)).toBe('down')
  expect(changeColor(0)).toBe('flat')
  expect(changeColor(null)).toBe('flat')
})
test('fmtPct 带符号两位', () => {
  expect(fmtPct(1.2)).toBe('+1.20%')
  expect(fmtPct(-0.5)).toBe('-0.50%')
  expect(fmtPct(null)).toBe('—')
})
test('fmtPrice', () => {
  expect(fmtPrice(12.3)).toBe('12.30')
  expect(fmtPrice(null)).toBe('—')
})
test('fmtAmount 亿万自适应', () => {
  expect(fmtAmount(120000000)).toBe('1.20亿')
  expect(fmtAmount(34500000)).toBe('3450万')
  expect(fmtAmount(null)).toBe('—')
})
