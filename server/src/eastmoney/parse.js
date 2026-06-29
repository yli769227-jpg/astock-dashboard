// 东方财富 clist 返回非法值常用 '-' 表示，统一转 null
function num(v) {
  if (v === '-' || v === undefined || v === null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// overview 的 ulist 接口无 fltt=2，f2/f3/f4 是 ×100 的整数，需除以 100 还原
// （ranking/sectors 的 clist 接口带 fltt=2，已是浮点，不用此函数）—— 见 Task 3 实测
function scaled(v) {
  const n = num(v)
  return n === null ? null : n / 100
}

export function parseRanking(json) {
  const diff = json?.data?.diff
  if (!Array.isArray(diff)) return []
  const out = []
  for (const d of diff) {
    if (d?.f12 === undefined || d?.f14 === undefined) continue // 缺关键字段跳过
    out.push({
      code: String(d.f12),
      name: String(d.f14),
      price: num(d.f2),
      changePct: num(d.f3),
      changeAmt: num(d.f4),
      volume: num(d.f5),
      amount: num(d.f6),
      amplitude: num(d.f7),
      turnover: num(d.f8),
      marketId: num(d.f13),
    })
  }
  return out
}

export function parseOverview(json) {
  const diff = json?.data?.diff
  if (!Array.isArray(diff)) return { indices: [] }
  const indices = diff
    .filter((d) => d?.f12 !== undefined)
    .map((d) => ({
      code: String(d.f12),
      name: String(d.f14),
      price: scaled(d.f2),       // ×100 整数还原
      changePct: scaled(d.f3),   // ×100 整数还原
      changeAmt: scaled(d.f4),   // ×100 整数还原
    }))
  return { indices }
}

export function parseSectors(json) {
  const diff = json?.data?.diff
  if (!Array.isArray(diff)) return []
  const out = []
  for (const d of diff) {
    if (d?.f12 === undefined) continue
    out.push({
      code: String(d.f12),
      name: String(d.f14),
      changePct: num(d.f3),
      changeAmt: num(d.f4),
      turnover: num(d.f8),
      leader: d.f128 ? String(d.f128) : null,
    })
  }
  return out
}

export function parseTimeline(json) {
  const data = json?.data
  if (!data || !Array.isArray(data.trends)) return { secid: null, prevClose: null, points: [] }
  // trends 每项形如 "2024-06-28 09:30,价格,均价,成交量,..." 取决于 fields2 顺序
  const points = []
  for (const line of data.trends) {
    const p = String(line).split(',')
    if (p.length < 4) continue
    points.push({
      time: p[0],
      price: num(p[1]),
      avg: num(p[3]),
      volume: num(p[2]),
    })
  }
  // Task 3 实测：昨收字段是 data.preSettlement（不是 prePrice）；盘中可能返回 0，视为不可用
  const prev = num(data.preSettlement)
  return { secid: data.code ? `${data.market}.${data.code}` : null, prevClose: prev === 0 ? null : prev, points }
}
