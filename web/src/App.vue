<script setup>
import { ref } from 'vue'
import OverviewBar from './components/OverviewBar.vue'
import RankingTable from './components/RankingTable.vue'
import SectorPanel from './components/SectorPanel.vue'
import StockTimelineCard from './components/StockTimelineCard.vue'

const picked = ref(null)
</script>

<template>
  <div class="app">
    <OverviewBar />
    <div class="main">
      <section class="left"><h3>涨跌幅榜</h3><RankingTable @pick-stock="(s) => picked = s" /></section>
      <section class="right"><h3>板块异动</h3><SectorPanel @pick-stock="(s) => picked = s" /></section>
    </div>
    <StockTimelineCard v-if="picked" :code="picked.code" :market-id="picked.marketId" @close="picked = null" />
  </div>
</template>

<style scoped>
.app { background: var(--bg); min-height: 100vh; color: var(--fg); }
.main { display: flex; gap: 12px; padding: 12px; }
.left { flex: 6; } .right { flex: 4; }
h3 { margin: 6px 0; font-size: 14px; color: #aaa; }
</style>
