<script setup>
import { onMounted, onUnmounted, computed } from 'vue'
import { usePolling } from '../usePolling.js'
import { changeColor, fmtPrice, fmtPct } from '../format.js'

const props = defineProps({ code: { type: String, required: true } })
const emit = defineEmits(['pick-stock'])
const poll = usePolling(`/api/sector/${props.code}/stocks`, 5000)
onMounted(() => poll.start())
onUnmounted(() => poll.stop())
const rows = computed(() => poll.data.value ?? [])
</script>

<template>
  <table class="mono substocks">
    <tbody>
      <tr v-for="r in rows" :key="r.code" @click.stop="emit('pick-stock', { code: r.code, marketId: r.marketId })">
        <td>{{ r.code }}</td><td>{{ r.name }}</td>
        <td :class="changeColor(r.changePct)">{{ fmtPrice(r.price) }} {{ fmtPct(r.changePct) }}</td>
      </tr>
      <tr v-if="!rows.length"><td colspan="3" class="flat">加载中…</td></tr>
    </tbody>
  </table>
</template>

<style scoped>
.substocks { width: 100%; background: #1a1d22; border-collapse: collapse; }
td { padding: 3px 8px; text-align: right; color: var(--fg); border-bottom: 1px solid #23262b; cursor: pointer; }
td:nth-child(2) { text-align: left; }
</style>
