import { writeFile, mkdir } from 'node:fs/promises'
import { rankingUrl, overviewUrl, sectorsUrl, timelineUrl } from '../src/eastmoney/endpoints.js'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  'Referer': 'https://quote.eastmoney.com/',
}

const targets = {
  ranking: rankingUrl({ type: 'up', limit: 50 }),
  overview: overviewUrl(),
  sectors: sectorsUrl({ type: 'industry' }),
  timeline: timelineUrl({ secid: '1.600000' }),
}

await mkdir(new URL('../tests/fixtures/', import.meta.url), { recursive: true })
for (const [name, url] of Object.entries(targets)) {
  const res = await fetch(url, { headers: HEADERS })
  const json = await res.json()
  const path = new URL(`../tests/fixtures/${name}.json`, import.meta.url)
  await writeFile(path, JSON.stringify(json, null, 2))
  console.log(`[存档] ${name} ← ${res.status}，data 顶层键: ${Object.keys(json.data ?? json).join(',')}`)
}
