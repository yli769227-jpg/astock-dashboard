import { test, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import RankingTable from '../../src/components/RankingTable.vue'
import * as api from '../../src/api.js'

afterEach(() => vi.restoreAllMocks())
const wait = () => new Promise((r) => setTimeout(r, 10))

test('渲染榜单行并涨红', async () => {
  vi.spyOn(api, 'getJson').mockResolvedValue({
    data: [{ code: '600000', name: '浦发银行', price: 10, changePct: 5.1 }],
    updatedAt: Date.now(), stale: false,
  })
  const w = mount(RankingTable)
  await wait(); await w.vm.$nextTick()
  expect(w.text()).toContain('浦发银行')
  expect(w.find('.up').exists()).toBe(true)
  w.unmount()
})

test('点行 emit pick-stock', async () => {
  vi.spyOn(api, 'getJson').mockResolvedValue({
    data: [{ code: '600000', name: '浦发', price: 10, changePct: 1 }], updatedAt: 1, stale: false,
  })
  const w = mount(RankingTable)
  await wait(); await w.vm.$nextTick()
  await w.find('tbody tr').trigger('click')
  expect(w.emitted('pick-stock')[0]).toEqual(['600000'])
  w.unmount()
})
