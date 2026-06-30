<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { usePolling } from '../usePolling.js'
import { useFlash } from '../useFlash.js'
import { changeColor, fmtPrice, fmtPct } from '../format.js'

const emit = defineEmits(['pick-stock'])
const tabs = [
  { key: 'up', label: '涨幅' }, { key: 'down', label: '跌幅' },
  { key: 'amplitude', label: '振幅' }, { key: 'turnover', label: '换手' },
]
const type = ref('up')
const { flashClass } = useFlash()

// 用 getter 形式的响应式 URL：切 tab 时 usePolling 内部会自动重拉，无需重建 poll 实例
const poll = usePolling(() => `/api/ranking?type=${type.value}`, 3000)
const rows = computed(() => poll.data.value ?? [])

onMounted(() => poll.start())
onUnmounted(() => poll.stop())
</script>

<template>
  <div class="ranking">
    <div class="tabs">
      <button v-for="t in tabs" :key="t.key" :class="{ active: type === t.key }" @click="type = t.key">
        {{ t.label }}
      </button>
    </div>
    <table class="mono">
      <thead><tr><th>#</th><th>代码</th><th>名称</th><th>现价</th><th>涨跌幅</th></tr></thead>
      <tbody>
        <tr v-for="(r, i) in rows" :key="r.code" @click="emit('pick-stock', { code: r.code, marketId: r.marketId })">
          <td>{{ i + 1 }}</td>
          <td>{{ r.code }}</td>
          <td>{{ r.name }}</td>
          <td :class="flashClass(r.code, r.price)">{{ fmtPrice(r.price) }}</td>
          <td :class="changeColor(r.changePct)">{{ fmtPct(r.changePct) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.tabs button { background: none; border: 1px solid #333; color: var(--fg); padding: 4px 10px; cursor: pointer; }
.tabs button.active { background: #2a2d33; }
table { width: 100%; border-collapse: collapse; color: var(--fg); }
th, td { padding: 4px 8px; text-align: right; border-bottom: 1px solid #23262b; }
th:nth-child(3), td:nth-child(3) { text-align: left; }
tbody tr { cursor: pointer; }
tbody tr:hover { background: #1c1f24; }
</style>
