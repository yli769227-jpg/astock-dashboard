<script setup>
import { onMounted, onUnmounted, computed } from 'vue'
import { usePolling } from '../usePolling.js'
import { changeColor, fmtPrice, fmtPct } from '../format.js'

const poll = usePolling('/api/overview', 3000)
onMounted(() => poll.start())
onUnmounted(() => poll.stop())

const indices = computed(() => poll.data.value?.indices ?? [])
const session = computed(() => poll.data.value?.session ?? '')
const agoSec = computed(() => poll.updatedAt.value ? Math.round((Date.now() - poll.updatedAt.value) / 1000) : null)
</script>

<template>
  <div class="overview-bar mono">
    <span v-for="idx in indices" :key="idx.code" class="idx">
      {{ idx.name }}
      <b :class="changeColor(idx.changePct)">{{ fmtPrice(idx.price) }} {{ fmtPct(idx.changePct) }}</b>
    </span>
    <span class="session">🕐 {{ session }}</span>
    <span v-if="poll.stale.value" class="warn">⚠️ 行情更新中断，展示 {{ agoSec }} 秒前快照</span>
    <span v-else class="heartbeat">⏱ {{ agoSec }} 秒前更新</span>
  </div>
</template>

<style scoped>
.overview-bar { display: flex; gap: 18px; align-items: center; padding: 8px 14px; background: var(--bg); color: var(--fg); }
.warn { color: #f5a623; }
.heartbeat { color: var(--flat); }
.idx b { margin-left: 4px; }
</style>
