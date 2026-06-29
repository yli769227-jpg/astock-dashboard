<script setup>
import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
import { usePolling } from '../usePolling.js'
import { changeColor, fmtPct } from '../format.js'
import SectorStocks from './SectorStocks.vue'

const emit = defineEmits(['pick-stock'])
const type = ref('industry')
const expanded = ref(null)

// getter 形式响应式 URL：切 行业/概念 时自动重拉，无需重建 poll
const poll = usePolling(() => `/api/sectors?type=${type.value}`, 5000)
const rows = computed(() => poll.data.value ?? [])

watch(type, () => { expanded.value = null }) // 切换类别时收起已展开的成分股

onMounted(() => poll.start())
onUnmounted(() => poll.stop())

function toggle(code) { expanded.value = expanded.value === code ? null : code }
</script>

<template>
  <div class="sector">
    <div class="tabs">
      <button :class="{ active: type === 'industry' }" @click="type = 'industry'">行业</button>
      <button :class="{ active: type === 'concept' }" @click="type = 'concept'">概念</button>
    </div>
    <table class="mono">
      <thead><tr><th>板块</th><th>涨跌幅</th><th>领涨</th></tr></thead>
      <tbody>
        <template v-for="r in rows" :key="r.code">
          <tr @click="toggle(r.code)">
            <td>{{ r.name }}</td>
            <td :class="changeColor(r.changePct)">{{ fmtPct(r.changePct) }}</td>
            <td>{{ r.leader ?? '—' }}</td>
          </tr>
          <tr v-if="expanded === r.code"><td colspan="3" class="sub">
            <SectorStocks :code="r.code" @pick-stock="(c) => emit('pick-stock', c)" />
          </td></tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.tabs button { background: none; border: 1px solid #333; color: var(--fg); padding: 4px 10px; cursor: pointer; }
.tabs button.active { background: #2a2d33; }
table { width: 100%; border-collapse: collapse; color: var(--fg); }
th, td { padding: 4px 8px; text-align: right; border-bottom: 1px solid #23262b; }
th:first-child, td:first-child { text-align: left; }
tbody tr { cursor: pointer; }
.sub { padding: 0; }
</style>
