import { test, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import OverviewBar from '../../src/components/OverviewBar.vue'
import * as api from '../../src/api.js'

afterEach(() => vi.restoreAllMocks())

test('渲染指数名称与涨跌色', async () => {
  vi.spyOn(api, 'getJson').mockResolvedValue({
    data: { indices: [{ code: '000001', name: '上证指数', price: 3021.5, changePct: 0.8 }], session: '交易中' },
    updatedAt: Date.now(), stale: false,
  })
  const w = mount(OverviewBar)
  await new Promise((r) => setTimeout(r, 10))
  await w.vm.$nextTick()
  expect(w.text()).toContain('上证指数')
  expect(w.text()).toContain('交易中')
  expect(w.find('.up').exists()).toBe(true)
  w.unmount()
})

test('stale 时显示快照提示', async () => {
  vi.spyOn(api, 'getJson').mockResolvedValue({
    data: { indices: [], session: '已收盘' }, updatedAt: Date.now() - 9000, stale: true,
  })
  const w = mount(OverviewBar)
  await new Promise((r) => setTimeout(r, 10))
  await w.vm.$nextTick()
  expect(w.text()).toMatch(/快照|中断/)
  w.unmount()
})
