import { test, expect } from 'vitest'
import { useFlash } from '../src/useFlash.js'

test('首次无 flash，变大 flash up，变小 flash down', () => {
  const { flashClass } = useFlash()
  expect(flashClass('600000', 10)).toBe('')      // 首次
  expect(flashClass('600000', 10)).toBe('')      // 没变
  expect(flashClass('600000', 11)).toBe('cell-flash-up')
  expect(flashClass('600000', 9)).toBe('cell-flash-down')
})
