export function changeColor(pct) {
  if (pct === null || pct === undefined || pct === 0) return 'flat'
  return pct > 0 ? 'up' : 'down'
}

export function fmtPct(n) {
  if (n === null || n === undefined) return '—'
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`
}

export function fmtPrice(n) {
  if (n === null || n === undefined) return '—'
  return n.toFixed(2)
}

export function fmtAmount(n) {
  if (n === null || n === undefined) return '—'
  if (n >= 1e8) return `${(n / 1e8).toFixed(2)}亿`
  if (n >= 1e4) return `${Math.round(n / 1e4)}万`
  return String(n)
}
