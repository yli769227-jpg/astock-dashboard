import { test, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import * as api from '../../src/api.js'

const setOption = vi.fn()
const dispose = vi.fn()
vi.mock('echarts', () => ({ init: () => ({ setOption, dispose, resize: vi.fn() }) }))

afterEach(() => vi.restoreAllMocks())
const wait = () => new Promise((r) => setTimeout(r, 10))

test('加载分时数据并 setOption', async () => {
  vi.spyOn(api, 'getJson').mockResolvedValue({
    data: { points: [{ time: '09:30', price: 10, avg: 10 }, { time: '09:31', price: 10.2, avg: 10.1 }] },
    updatedAt: 1, stale: false,
  })
  const { default: Card } = await import('../../src/components/StockTimelineCard.vue')
  const w = mount(Card, { props: { code: '600000' } })
  await wait(); await w.vm.$nextTick()
  expect(setOption).toHaveBeenCalled()
  w.unmount()
  expect(dispose).toHaveBeenCalled() // 卸载销毁
})

test('点关闭 emit close', async () => {
  vi.spyOn(api, 'getJson').mockResolvedValue({ data: { points: [] }, updatedAt: 1, stale: false })
  const { default: Card } = await import('../../src/components/StockTimelineCard.vue')
  const w = mount(Card, { props: { code: '600000' } })
  await wait()
  await w.find('.close').trigger('click')
  expect(w.emitted('close')).toBeTruthy()
  w.unmount()
})
