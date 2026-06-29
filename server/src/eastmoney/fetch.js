import { rankingUrl, overviewUrl, sectorsUrl, sectorStocksUrl, timelineUrl } from './endpoints.js'
import { parseRanking, parseOverview, parseSectors, parseTimeline } from './parse.js'

const HEADERS = { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://quote.eastmoney.com/' }

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`东方财富返回 ${res.status}`)
  return res.json()
}

export async function fetchRanking(type) {
  return parseRanking(await getJson(rankingUrl({ type, limit: 50 })))
}
export async function fetchOverview() {
  return parseOverview(await getJson(overviewUrl()))
}
export async function fetchSectors(type) {
  return parseSectors(await getJson(sectorsUrl({ type })))
}
export async function fetchSectorStocks(boardCode) {
  return parseRanking(await getJson(sectorStocksUrl({ boardCode }))) // 成分股结构同 clist
}
export async function fetchTimeline(secid) {
  return parseTimeline(await getJson(timelineUrl({ secid })))
}
