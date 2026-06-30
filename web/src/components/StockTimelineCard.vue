<script setup>
import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
import * as echarts from 'echarts'
import { usePolling } from '../usePolling.js'

const props = defineProps({
  code: { type: String, required: true },
  marketId: { type: Number, required: false, default: null },
})
const emit = defineEmits(['close'])
const chartEl = ref(null)
let chart = null

// getter 形式响应式 URL：切换个股（props.code 变）时自动重拉，无需重建 poll
const poll = usePolling(() => {
  const m = props.marketId != null ? `?market=${props.marketId}` : ''
  return `/api/stock/${props.code}/timeline${m}`
}, 3000)
const points = computed(() => poll.data.value?.points ?? [])

function render() {
  if (!chart) return
  const pts = points.value
  chart.setOption({
    grid: { left: 48, right: 12, top: 16, bottom: 24 },
    xAxis: { type: 'category', data: pts.map((p) => p.time), axisLabel: { color: '#888' } },
    yAxis: { scale: true, axisLabel: { color: '#888' } },
    series: [
      { type: 'line', data: pts.map((p) => p.price), showSymbol: false, lineStyle: { color: '#e53935' }, name: '价格' },
      { type: 'line', data: pts.map((p) => p.avg), showSymbol: false, lineStyle: { color: '#f5a623' }, name: '均价' },
    ],
  })
}

watch(points, render)

onMounted(() => { chart = echarts.init(chartEl.value); poll.start() })
onUnmounted(() => { poll.stop(); if (chart) chart.dispose(); chart = null })
</script>

<template>
  <div class="card-overlay" @click.self="emit('close')">
    <div class="card">
      <div class="card-head"><span class="mono">{{ code }} 分时</span><button class="close" @click="emit('close')">✕</button></div>
      <div ref="chartEl" class="chart"></div>
    </div>
  </div>
</template>

<style scoped>
.card-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; z-index: 50; }
.card { width: 640px; max-width: 92vw; background: #14161a; border: 1px solid #333; border-radius: 8px; padding: 12px; }
.card-head { display: flex; justify-content: space-between; align-items: center; color: var(--fg); margin-bottom: 8px; }
.close { background: none; border: none; color: var(--fg); cursor: pointer; font-size: 16px; }
.chart { height: 300px; }
</style>
