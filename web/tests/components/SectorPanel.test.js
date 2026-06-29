import { test, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import SectorPanel from '../../src/components/SectorPanel.vue'
import * as api from '../../src/api.js'

afterEach(() => vi.restoreAllMocks())
const wait = () => new Promise((r) => setTimeout(r, 10))

test('渲染板块并点击展开成分股', async () => {
  vi.spyOn(api, 'getJson').mockImplementation(async (path) => {
    if (path.includes('/sectors')) return { data: [{ code: 'BK0475', name: '半导体', changePct: 3.2, leader: '中芯国际' }], updatedAt: 1, stale: false }
    return { data: [{ code: '688981', name: '中芯国际', price: 50, changePct: 4.0 }], updatedAt: 1, stale: false }
  })
  const w = mount(SectorPanel)
  await wait(); await w.vm.$nextTick()
  expect(w.text()).toContain('半导体')
  await w.find('tbody tr').trigger('click')
  await wait(); await w.vm.$nextTick()
  expect(w.text()).toContain('中芯国际')
  w.unmount()
})
