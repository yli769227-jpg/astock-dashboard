function minutes(date) { return date.getHours() * 60 + date.getMinutes() }
const AM_OPEN = 9 * 60 + 30, AM_CLOSE = 11 * 60 + 30
const PM_OPEN = 13 * 60, PM_CLOSE = 15 * 60

export function isTradingTime(date) {
  const day = date.getDay()
  if (day === 0 || day === 6) return false
  const m = minutes(date)
  return (m >= AM_OPEN && m <= AM_CLOSE) || (m >= PM_OPEN && m <= PM_CLOSE)
}

export function residentInterval(date) {
  return isTradingTime(date) ? 3000 : 30000
}

export function sessionLabel(date) {
  const day = date.getDay()
  if (day === 0 || day === 6) return '已收盘'
  const m = minutes(date)
  if (isTradingTime(date)) return '交易中'
  if (m > AM_CLOSE && m < PM_OPEN) return '午间休市'
  if (m > PM_CLOSE) return '已收盘'
  return '未开盘'
}
