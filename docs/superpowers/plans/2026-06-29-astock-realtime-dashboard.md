# A 股全市场实时盯盘网页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个全市场扫描型 A 股实时盯盘网页：东方财富免费接口 → Node 后端（主动拉取 + 内存缓存 + 懒加载 + 降级）→ Vue 3 前端（顶部概览 / 涨跌幅榜 / 板块异动 + 板块下钻 + 个股分时卡片）。

**Architecture:** 后端单点每 3 秒主动抓东方财富全市场快照写内存缓存，所有浏览器客户端只读这份缓存（请求量恒定，不被封 IP）。后端做代理 + 字段清洗 + 失败降级；前端纯只读 + 轻下钻，红涨绿跌 + 变化闪烁。

**Tech Stack:** Node 24（原生 fetch/ESM）、Fastify 5（含 pino 日志）、Vitest 3；Vue 3.5、Vite 6、ECharts 5、@vue/test-utils 2。

## Global Constraints

- 运行时：Node v24.13.0（原生 `fetch`、原生 ESM，`"type": "module"`）。
- 工程结构：`server/` 与 `web/` 为**两个独立 npm 工程**，各自 `package.json` + `node_modules`。**禁止使用 npm workspaces**（规避 workspace symlink 问题）。
- 数据源：东方财富免费接口；前端**永不直连**东方财富，只调本服务 `/api/*`（同源，无跨域）。
- 接口 URL：本计划给出社区通行的 push2 端点，实施时**首次必须真抓一次核验返回结构**，并把真实返回 JSON **存档为测试 fixture**。
- 字段约定：东方财富返回 `f2/f3/f12/f14` 等编号字段，后端清洗为 `code/name/price/changePct` 等语义字段后才对外。
- API 响应统一信封：`{ data, updatedAt, stale }`（`updatedAt` 为毫秒时间戳，`stale` 为布尔）。
- 颜色规则：**红涨绿跌**（与欧美相反），硬编码主题色。
- 刷新频率：概览/涨跌幅榜 3000ms、板块 5000ms、按需下钻 3000~5000ms、非交易时段 30000ms。
- 降级原则：任一接口单次抓取失败 → **保留上一份缓存**继续供给 + 标 `stale:true`，绝不清空或崩界面。
- 日志：每个回源 / 缓存命中 / 降级 / 懒加载进出 / 字段缺失，都打关键路径日志（中文前缀如 `[东方财富]`/`[缓存]`/`[降级]`/`[懒加载]`/`[告警]`）。
- 锁文件：首次 `npm install` 后，因 Vite/esbuild/rollup 有平台专属 optional deps，**用 `npm install --include=optional`** 生成 lockfile，保证 Linux 同事 `npm ci` 不挂。

---

## 文件结构

```
astock-dashboard/
├── server/
│   ├── package.json                 # Fastify 5 + Vitest，type:module
│   ├── src/
│   │   ├── app.js                   # Fastify 实例 + 路由注册 + 启动
│   │   ├── eastmoney/
│   │   │   ├── endpoints.js         # 东方财富 URL 构造（纯函数）
│   │   │   ├── parse.js             # 原始 JSON → 干净对象（纯函数，核心测试点）
│   │   │   └── fetch.js             # http + parse 组合（fetchOverview/Ranking/...）
│   │   ├── cache.js                 # 内存缓存：set/get/markStale
│   │   ├── poller.js                # 通用定时拉取器：start/stop + 退避
│   │   ├── lazy.js                  # 按需懒加载管理（引用计数 + 60s 停拉）
│   │   ├── session.js              # 交易时段判定（控制频率切换）
│   │   └── routes.js                # /api/* 路由，套统一信封
│   └── tests/
│       ├── fixtures/                # 真抓存档的东方财富 JSON 样本
│       ├── parse.test.js
│       ├── cache.test.js
│       ├── poller.test.js
│       ├── lazy.test.js
│       ├── session.test.js
│       └── routes.test.js
└── web/
    ├── package.json                 # Vue 3.5 + Vite 6 + ECharts 5 + Vitest
    ├── vite.config.js               # dev 代理 /api → localhost:3000
    ├── index.html
    ├── src/
    │   ├── main.js
    │   ├── App.vue                  # 整体布局装配
    │   ├── api.js                   # fetch 封装，调 /api/*
    │   ├── format.js                # 红涨绿跌取色 + 数字格式（纯函数）
    │   ├── usePolling.js            # 轮询组合式函数（暂停/恢复/重试）
    │   └── components/
    │       ├── OverviewBar.vue
    │       ├── RankingTable.vue
    │       ├── SectorPanel.vue
    │       ├── SectorStocks.vue
    │       └── StockTimelineCard.vue
    └── tests/
        ├── format.test.js
        ├── usePolling.test.js
        └── components/*.test.js
```

执行顺序：**先后端（Task 1–9）跑通并能 curl 出干净数据，再前端（Task 10–18）**，最后 Task 19 联调冒烟。每个 Task 末尾 commit。

---

## Task 1: 后端脚手架 + 健康检查

**Files:**
- Create: `server/package.json`
- Create: `server/src/app.js`
- Create: `server/tests/health.test.js`

**Interfaces:**
- Produces: `buildApp()` → 返回 Fastify 实例（已注册路由，未 listen）；`server/src/app.js` 默认导出 `buildApp`，并在直接运行时 `listen`。

- [ ] **Step 1: 初始化工程**

```bash
cd server
npm init -y
npm pkg set type=module
npm pkg set scripts.dev="node --watch src/app.js"
npm pkg set scripts.start="node src/app.js"
npm pkg set scripts.test="vitest run"
npm pkg set scripts.test:watch="vitest"
npm install fastify@^5
npm install -D vitest@^3 --include=optional
```

- [ ] **Step 2: 写失败测试** — `server/tests/health.test.js`

```js
import { test, expect } from 'vitest'
import { buildApp } from '../src/app.js'

test('GET /health 返回 ok', async () => {
  const app = buildApp()
  const res = await app.inject({ method: 'GET', url: '/health' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ status: 'ok' })
  await app.close()
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd server && npx vitest run tests/health.test.js`
Expected: FAIL（`buildApp` 未定义 / 模块不存在）

- [ ] **Step 4: 写最小实现** — `server/src/app.js`

```js
import Fastify from 'fastify'

export function buildApp() {
  const app = Fastify({
    logger: { transport: { target: 'pino-pretty' } },
  })
  app.get('/health', async () => ({ status: 'ok' }))
  return app
}

// 直接运行时启动监听（被 import 时不启动，便于测试）
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = buildApp()
  const port = Number(process.env.PORT ?? 3000)
  app.listen({ port, host: '0.0.0.0' })
    .then(() => app.log.info(`[启动] 盯盘后端已监听 :${port}`))
    .catch((err) => { app.log.error(err); process.exit(1) })
}
```

- [ ] **Step 5: 装 pino-pretty 并跑测试**

```bash
cd server && npm install -D pino-pretty && npx vitest run tests/health.test.js
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/zhangyida/astock-dashboard
git add server/package.json server/package-lock.json server/src/app.js server/tests/health.test.js
git commit -m "feat(server): Fastify 脚手架 + /health"
```

---

## Task 2: 东方财富 URL 构造（endpoints.js）

**Files:**
- Create: `server/src/eastmoney/endpoints.js`
- Create: `server/tests/endpoints.test.js`

**Interfaces:**
- Produces:
  - `rankingUrl({ type, limit })` → string。`type ∈ {up,down,amplitude,turnover}`，映射到 `fid` 与排序方向 `po`。
  - `overviewUrl()` → string（沪深创三大指数 ulist 接口）。
  - `sectorsUrl({ type })` → string。`type ∈ {industry,concept}`。
  - `sectorStocksUrl({ boardCode })` → string。
  - `timelineUrl({ secid })` → string。
  - `toSecid({ code, marketId })` → string，如 `'1.600000'`；`marketId` 缺失时按代码前缀推断（6/5/9 开头→`1` 沪，否则→`0` 深）。

- [ ] **Step 1: 写失败测试** — `server/tests/endpoints.test.js`

```js
import { test, expect } from 'vitest'
import { rankingUrl, sectorsUrl, toSecid, timelineUrl } from '../src/eastmoney/endpoints.js'

test('涨幅榜 url 用 fid=f3 且降序 po=1', () => {
  const u = rankingUrl({ type: 'up', limit: 50 })
  expect(u).toContain('fid=f3')
  expect(u).toContain('po=1')
  expect(u).toContain('pz=50')
})

test('跌幅榜降序参数为升序 po=0', () => {
  expect(rankingUrl({ type: 'down', limit: 50 })).toContain('po=0')
})

test('行业板块 fs=m:90 t:2', () => {
  expect(sectorsUrl({ type: 'industry' })).toContain('m%3A90%2Bt%3A2')
})

test('toSecid 沪市 6 开头前缀 1', () => {
  expect(toSecid({ code: '600000' })).toBe('1.600000')
})

test('toSecid 深市 0 开头前缀 0', () => {
  expect(toSecid({ code: '000001' })).toBe('0.000001')
})

test('toSecid 优先用 marketId', () => {
  expect(toSecid({ code: '600000', marketId: 0 })).toBe('0.600000')
})

test('timelineUrl 带 secid', () => {
  expect(timelineUrl({ secid: '1.600000' })).toContain('secid=1.600000')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && npx vitest run tests/endpoints.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现** — `server/src/eastmoney/endpoints.js`

```js
const HOST = 'https://push2.eastmoney.com'

// 涨跌幅榜字段：代码/名称/现价/涨跌幅/涨跌额/成交量/成交额/振幅/换手/市场id
const LIST_FIELDS = 'f2,f3,f4,f5,f6,f7,f8,f12,f13,f14'
// 全 A 股市场过滤（沪深京主板/创业/科创/北交）
const ALL_A = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048'

const RANKING_FID = {
  up: { fid: 'f3', po: 1 },        // 涨幅降序
  down: { fid: 'f3', po: 0 },      // 涨幅升序 = 跌幅榜
  amplitude: { fid: 'f7', po: 1 }, // 振幅降序
  turnover: { fid: 'f8', po: 1 },  // 换手降序
}

export function rankingUrl({ type, limit = 50 }) {
  const { fid, po } = RANKING_FID[type] ?? RANKING_FID.up
  const q = new URLSearchParams({
    pn: '1', pz: String(limit), po: String(po), np: '1',
    fltt: '2', invt: '2', fid, fs: ALL_A, fields: LIST_FIELDS,
  })
  return `${HOST}/api/qt/clist/get?${q}`
}

export function overviewUrl() {
  // 上证指数 1.000001 / 深证成指 0.399001 / 创业板指 0.399006
  const q = new URLSearchParams({
    fields: 'f2,f3,f4,f12,f13,f14',
    secids: '1.000001,0.399001,0.399006',
  })
  return `${HOST}/api/qt/ulist.np/get?${q}`
}

export function sectorsUrl({ type }) {
  const t = type === 'concept' ? 't:3' : 't:2' // 行业 t:2 / 概念 t:3
  const q = new URLSearchParams({
    pn: '1', pz: '50', po: '1', np: '1', fltt: '2', invt: '2', fid: 'f3',
    fs: `m:90+${t}`,
    // 板块字段：代码/名称/涨跌幅/涨跌额/换手 + 领涨股名 f128
    fields: 'f2,f3,f4,f8,f12,f13,f14,f128',
  })
  return `${HOST}/api/qt/clist/get?${q}`
}

export function sectorStocksUrl({ boardCode, limit = 30 }) {
  const q = new URLSearchParams({
    pn: '1', pz: String(limit), po: '1', np: '1', fltt: '2', invt: '2', fid: 'f3',
    fs: `b:${boardCode}+f:!50`,
    fields: LIST_FIELDS,
  })
  return `${HOST}/api/qt/clist/get?${q}`
}

export function timelineUrl({ secid }) {
  const q = new URLSearchParams({
    secid,
    fields1: 'f1,f2,f3,f7',
    fields2: 'f51,f53,f56,f58', // 时间/价格/成交量/均价
    ndays: '1', iscr: '0',
  })
  return `${HOST}/api/qt/stock/trends2/get?${q}`
}

export function toSecid({ code, marketId }) {
  if (marketId === 0 || marketId === 1) return `${marketId}.${code}`
  const sh = /^[695]/.test(code)
  return `${sh ? 1 : 0}.${code}`
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && npx vitest run tests/endpoints.test.js`
Expected: PASS（7 passed）

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangyida/astock-dashboard
git add server/src/eastmoney/endpoints.js server/tests/endpoints.test.js
git commit -m "feat(server): 东方财富 URL 构造 + secid 推断"
```

---

## Task 3: 真抓核验 + 存档 fixture

**Files:**
- Create: `server/tests/fixtures/ranking.json`
- Create: `server/tests/fixtures/overview.json`
- Create: `server/tests/fixtures/sectors.json`
- Create: `server/tests/fixtures/timeline.json`
- Create: `server/scripts/snapshot.js`

**Interfaces:**
- Produces: 4 个真实返回 JSON 样本，供 Task 4 的 parse 测试做 fixture。

> 本 Task 没有 TDD 循环（是抓数据），但**必须在交易时段或盘后执行一次**，确认接口结构与本计划假设一致；若字段不符，回到 Task 2/4 修正映射。

- [ ] **Step 1: 写抓取脚本** — `server/scripts/snapshot.js`

```js
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
```

- [ ] **Step 2: 运行抓取**

Run: `cd server && node scripts/snapshot.js`
Expected: 打印 4 行 `[存档] ...`，生成 4 个 fixture 文件。
**人工核验：** 打开 `ranking.json`，确认 `data.diff` 是数组、每项含 `f12`(代码)、`f14`(名称)、`f3`(涨跌幅)。若字段编号不同，记录差异并修正 `endpoints.js` 的 `fields` 与 Task 4 的 parse。

- [ ] **Step 3: Commit**

```bash
cd /Users/zhangyida/astock-dashboard
git add server/scripts/snapshot.js server/tests/fixtures/
git commit -m "test(server): 存档东方财富真实返回 fixture + 抓取脚本"
```

---

## Task 4: 字段清洗（parse.js）— 核心测试点

**Files:**
- Create: `server/src/eastmoney/parse.js`
- Create: `server/tests/parse.test.js`

**Interfaces:**
- Produces:
  - `parseRanking(json)` → `Array<{code,name,price,changePct,changeAmt,volume,amount,amplitude,turnover,marketId}>`
  - `parseOverview(json)` → `{ indices: Array<{code,name,price,changePct,changeAmt}> }`
  - `parseSectors(json)` → `Array<{code,name,changePct,changeAmt,turnover,leader}>`
  - `parseTimeline(json)` → `{ secid, prevClose, points: Array<{time,price,avg,volume}> }`
  - 所有 parse 对**缺字段的单条**跳过而非抛错；整体结构异常返回空数组 `[]` / 空对象。

- [ ] **Step 1: 写失败测试** — `server/tests/parse.test.js`

```js
import { test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseRanking, parseOverview, parseSectors, parseTimeline } from '../src/eastmoney/parse.js'

const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url)))

test('parseRanking 翻译编号字段为语义字段', () => {
  const rows = parseRanking(load('ranking'))
  expect(rows.length).toBeGreaterThan(0)
  const r = rows[0]
  expect(r).toHaveProperty('code')
  expect(r).toHaveProperty('name')
  expect(typeof r.changePct).toBe('number')
})

test('parseRanking 缺 f12 的条目被跳过而非抛错', () => {
  const broken = { data: { diff: [{ f14: '无代码股', f3: 1.2 }, { f12: '600000', f14: '浦发', f3: 0.5 }] } }
  const rows = parseRanking(broken)
  expect(rows).toHaveLength(1)
  expect(rows[0].code).toBe('600000')
})

test('parseRanking 结构异常返回空数组', () => {
  expect(parseRanking({})).toEqual([])
  expect(parseRanking(null)).toEqual([])
})

test('parseOverview 取出三大指数', () => {
  const { indices } = parseOverview(load('overview'))
  expect(indices.length).toBe(3)
  expect(indices[0]).toHaveProperty('changePct')
})

test('parseOverview 把 ×100 整数还原为浮点（ulist 无 fltt=2）', () => {
  // 上证指数 3021.50 / +0.80% / +24.00 在 ulist 接口里是 302150 / 80 / 2400
  const raw = { data: { diff: [{ f12: '000001', f14: '上证指数', f2: 302150, f3: 80, f4: 2400 }] } }
  const { indices } = parseOverview(raw)
  expect(indices[0].price).toBeCloseTo(3021.5, 2)
  expect(indices[0].changePct).toBeCloseTo(0.8, 2)
  expect(indices[0].changeAmt).toBeCloseTo(24, 2)
})

test('parseSectors 含领涨股字段', () => {
  const rows = parseSectors(load('sectors'))
  expect(rows[0]).toHaveProperty('leader')
})

test('parseTimeline 解析分时点', () => {
  const t = parseTimeline(load('timeline'))
  expect(Array.isArray(t.points)).toBe(true)
  expect(t.points[0]).toHaveProperty('time')
  expect(t.points[0]).toHaveProperty('price')
})

test('parseTimeline 昨收取 preSettlement，0 视为 null', () => {
  const withPrev = { data: { code: '600000', market: 1, preSettlement: 9.87, trends: ['09:30,10,1000,10'] } }
  expect(parseTimeline(withPrev).prevClose).toBe(9.87)
  const zeroPrev = { data: { code: '600000', market: 1, preSettlement: 0, trends: [] } }
  expect(parseTimeline(zeroPrev).prevClose).toBeNull()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && npx vitest run tests/parse.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现** — `server/src/eastmoney/parse.js`

```js
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
```

> 注：`parseTimeline` 中 trends 各列顺序依赖 `endpoints.js` 里 `fields2` 的顺序（`f51,f53,f56,f58` = 时间/价格/成交量/均价）。Step 用 Task 3 的真实 `timeline.json` 验证；若列顺序不符，调整索引。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && npx vitest run tests/parse.test.js`
Expected: PASS（6 passed）。若某条因真实字段顺序失败，对照 fixture 调整索引后再跑。

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangyida/astock-dashboard
git add server/src/eastmoney/parse.js server/tests/parse.test.js
git commit -m "feat(server): 东方财富字段清洗 parse（缺字段降级跳过）"
```

---

## Task 5: HTTP 抓取组合（fetch.js）

**Files:**
- Create: `server/src/eastmoney/fetch.js`
- Create: `server/tests/fetch.test.js`

**Interfaces:**
- Consumes: `endpoints.js` 的 URL 构造、`parse.js` 的清洗函数。
- Produces:
  - `fetchRanking(type)` → `Promise<Array>`（= parseRanking 结果）
  - `fetchOverview()` → `Promise<{indices}>`
  - `fetchSectors(type)` → `Promise<Array>`
  - `fetchSectorStocks(boardCode)` → `Promise<Array>`
  - `fetchTimeline(secid)` → `Promise<{points,...}>`
  - 所有 fetch 失败（网络/非 2xx）→ throw Error（由调用方 Task 6 的 poller 捕获降级）。

- [ ] **Step 1: 写失败测试**（用 `vi.stubGlobal` 打桩 fetch）— `server/tests/fetch.test.js`

```js
import { test, expect, vi, afterEach } from 'vitest'
import { fetchRanking } from '../src/eastmoney/fetch.js'

afterEach(() => vi.unstubAllGlobals())

test('fetchRanking 成功解析', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200,
    json: async () => ({ data: { diff: [{ f12: '600000', f14: '浦发', f3: 1.1 }] } }),
  })))
  const rows = await fetchRanking('up')
  expect(rows[0].code).toBe('600000')
})

test('fetchRanking 非 2xx 抛错', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })))
  await expect(fetchRanking('up')).rejects.toThrow(/403/)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && npx vitest run tests/fetch.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现** — `server/src/eastmoney/fetch.js`

```js
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && npx vitest run tests/fetch.test.js`
Expected: PASS（2 passed）

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangyida/astock-dashboard
git add server/src/eastmoney/fetch.js server/tests/fetch.test.js
git commit -m "feat(server): HTTP 抓取层（超时 + 非2xx 抛错）"
```

---

## Task 6: 内存缓存（cache.js）

**Files:**
- Create: `server/src/cache.js`
- Create: `server/tests/cache.test.js`

**Interfaces:**
- Produces: `createCache()` → `{ set(key, data), get(key), markStale(key) }`
  - `set(key, data)`：存 `{ data, updatedAt: Date.now(), stale: false }`
  - `get(key)`：返回该信封或 `undefined`
  - `markStale(key)`：若存在则置 `stale: true`（不改 data/updatedAt）

- [ ] **Step 1: 写失败测试** — `server/tests/cache.test.js`

```js
import { test, expect } from 'vitest'
import { createCache } from '../src/cache.js'

test('set 后 get 拿到带信封的数据', () => {
  const c = createCache()
  c.set('k', [1, 2])
  const e = c.get('k')
  expect(e.data).toEqual([1, 2])
  expect(e.stale).toBe(false)
  expect(typeof e.updatedAt).toBe('number')
})

test('markStale 只翻标记不动 data', () => {
  const c = createCache()
  c.set('k', { a: 1 })
  const before = c.get('k').updatedAt
  c.markStale('k')
  expect(c.get('k').stale).toBe(true)
  expect(c.get('k').data).toEqual({ a: 1 })
  expect(c.get('k').updatedAt).toBe(before)
})

test('markStale 不存在的 key 安全', () => {
  const c = createCache()
  expect(() => c.markStale('none')).not.toThrow()
})

test('get 未知 key 返回 undefined', () => {
  expect(createCache().get('x')).toBeUndefined()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && npx vitest run tests/cache.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现** — `server/src/cache.js`

```js
export function createCache() {
  const store = new Map()
  return {
    set(key, data) {
      store.set(key, { data, updatedAt: Date.now(), stale: false })
    },
    get(key) {
      return store.get(key)
    },
    markStale(key) {
      const e = store.get(key)
      if (e) e.stale = true
    },
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && npx vitest run tests/cache.test.js`
Expected: PASS（4 passed）

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangyida/astock-dashboard
git add server/src/cache.js server/tests/cache.test.js
git commit -m "feat(server): 内存缓存 set/get/markStale"
```

---

## Task 7: 定时拉取器 + 退避（poller.js）

**Files:**
- Create: `server/src/poller.js`
- Create: `server/tests/poller.test.js`

**Interfaces:**
- Consumes: `cache.js`。
- Produces: `createPoller({ key, intervalMs, fetcher, cache, logger, intervalFn })` → `{ start(), stop() }`
  - `intervalFn`（可选）：`(date) => number`，每次 tick 后调用以决定下次成功间隔（用于非交易时段降频）。未传则恒用 `intervalMs`。
  - `start()`：立即拉一次，然后按 `intervalMs`（或 `intervalFn`）周期拉。
  - 成功：`cache.set(key, data)` + 日志 `[东方财富] 拉取 <key> OK`，并把退避重置回 `intervalMs`。
  - 失败：`cache.markStale(key)` + 日志 `[降级]`，下次间隔指数退避（×2，上限 30000ms），成功后复位。
  - `stop()`：清除定时器，幂等。

- [ ] **Step 1: 写失败测试**（用假定时器）— `server/tests/poller.test.js`

```js
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPoller } from '../src/poller.js'
import { createCache } from '../src/cache.js'

const noopLog = { info() {}, warn() {}, error() {} }
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

test('start 立即拉一次并写缓存', async () => {
  const cache = createCache()
  const fetcher = vi.fn(async () => [42])
  const p = createPoller({ key: 'r', intervalMs: 3000, fetcher, cache, logger: noopLog })
  p.start()
  await vi.advanceTimersByTimeAsync(0)
  expect(cache.get('r').data).toEqual([42])
  p.stop()
})

test('失败时标 stale 且不抛出', async () => {
  const cache = createCache()
  cache.set('r', ['旧'])
  const fetcher = vi.fn(async () => { throw new Error('boom') })
  const p = createPoller({ key: 'r', intervalMs: 3000, fetcher, cache, logger: noopLog })
  p.start()
  await vi.advanceTimersByTimeAsync(0)
  expect(cache.get('r').stale).toBe(true)
  expect(cache.get('r').data).toEqual(['旧']) // 旧快照保留
  p.stop()
})

test('stop 后不再拉取', async () => {
  const cache = createCache()
  const fetcher = vi.fn(async () => [1])
  const p = createPoller({ key: 'r', intervalMs: 1000, fetcher, cache, logger: noopLog })
  p.start()
  await vi.advanceTimersByTimeAsync(0)
  p.stop()
  await vi.advanceTimersByTimeAsync(5000)
  expect(fetcher).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && npx vitest run tests/poller.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现** — `server/src/poller.js`

```js
const MAX_BACKOFF = 30000

export function createPoller({ key, intervalMs, fetcher, cache, logger, intervalFn }) {
  let timer = null
  let stopped = false
  let backoff = intervalMs

  // 成功后的基准间隔：有 intervalFn 用之（非交易时段降频），否则用固定 intervalMs
  const baseInterval = () => (intervalFn ? intervalFn(new Date()) : intervalMs)

  async function tick() {
    const t0 = Date.now()
    let next
    try {
      const data = await fetcher()
      cache.set(key, data)
      next = baseInterval() // 成功：复位到基准间隔
      backoff = next // 成功后退避无条件归位（不可放 finally 里用 baseInterval() 比较，intervalFn 时变会漏复位）
      const n = Array.isArray(data) ? data.length : '1'
      logger.info(`[东方财富] 拉取 ${key} OK ${n} 条 耗时 ${Date.now() - t0}ms`)
    } catch (err) {
      cache.markStale(key)
      backoff = Math.min(Math.max(backoff, baseInterval()) * 2, MAX_BACKOFF)
      next = backoff
      logger.warn(`[降级] ${key} 抓取失败：${err.message}，供给旧快照，下次 ${next}ms 后重试`)
    } finally {
      if (!stopped) timer = setTimeout(tick, next)
    }
  }

  return {
    start() { stopped = false; tick() },
    stop() { stopped = true; if (timer) clearTimeout(timer); timer = null },
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && npx vitest run tests/poller.test.js`
Expected: PASS（3 passed）

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangyida/astock-dashboard
git add server/src/poller.js server/tests/poller.test.js
git commit -m "feat(server): 定时拉取器 + 失败指数退避 + 旧快照降级"
```

---

## Task 8: 按需懒加载管理（lazy.js）

> 设计说明：HTTP 短连接是无状态的，每次 `/api/sector/:code/stocks` 请求无法在「客户端关闭」时收到通知，因此引用计数模型不适用。改用**访问续命（last-seen）模型**：每次 `acquire(key)` 刷新该 key 的 `lastSeen`；一个后台 sweeper 每 10s 扫描，超过 `idleMs` 无人访问的 key 停拉。

**Files:**
- Create: `server/src/lazy.js`
- Create: `server/tests/lazy.test.js`

**Interfaces:**
- Consumes: `poller.js`、`cache.js`。
- Produces: `createLazyManager({ cache, logger, makeFetcher, idleMs = 60000 })` → `{ acquire(key), getOrNull(key), _stopAll() }`
  - `acquire(key)`：首次访问某 key 时为它起一个 poller（用 `makeFetcher(key)` 作 fetcher，间隔 5000ms）并记 `lastSeen`；再次访问只刷新 `lastSeen`（续命），不重复起 poller。无返回值。
  - `getOrNull(key)`：返回 `cache.get(key) ?? null`。
  - `_stopAll()`：清理 sweeper 与全部 poller（供 app 关闭时调用）。
  - 后台 sweeper：`setInterval` 每 10000ms 扫描，`now - lastSeen > idleMs` 的 key → stop poller + 从 entries 删除 + 日志 `[懒加载] <key> 空闲 <idleMs>ms 停拉`。sweeper 用 `.unref()` 避免阻止进程退出。
  - `makeFetcher(key)`：调用方注入，把 `key`（如 `sector:BK0475` / `timeline:1.600000`）映射到对应 fetch 调用。

- [ ] **Step 1: 写失败测试** — `server/tests/lazy.test.js`

```js
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLazyManager } from '../src/lazy.js'
import { createCache } from '../src/cache.js'

const noopLog = { info() {}, warn() {}, error() {} }
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

test('首个 acquire 触发拉取', async () => {
  const cache = createCache()
  const m = createLazyManager({ cache, logger: noopLog, makeFetcher: (k) => async () => [k], idleMs: 60000 })
  m.acquire('sector:BK1')
  await vi.advanceTimersByTimeAsync(0)
  expect(cache.get('sector:BK1').data).toEqual(['sector:BK1'])
  m._stopAll()
})

test('停止访问超过 idle 后停拉', async () => {
  const cache = createCache()
  const fetcher = vi.fn(async () => [1])
  const m = createLazyManager({ cache, logger: noopLog, makeFetcher: () => fetcher, idleMs: 60000 })
  m.acquire('k')
  await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(71000) // 不再 acquire，超过 idle + sweep
  const after = fetcher.mock.calls.length
  await vi.advanceTimersByTimeAsync(10000)
  expect(fetcher.mock.calls.length).toBe(after) // 已停拉
  m._stopAll()
})

test('持续 acquire 续命则不停拉', async () => {
  const cache = createCache()
  const fetcher = vi.fn(async () => [1])
  const m = createLazyManager({ cache, logger: noopLog, makeFetcher: () => fetcher, idleMs: 60000 })
  m.acquire('k')
  for (let i = 0; i < 10; i++) { await vi.advanceTimersByTimeAsync(10000); m.acquire('k') }
  const before = fetcher.mock.calls.length
  await vi.advanceTimersByTimeAsync(6000)
  expect(fetcher.mock.calls.length).toBeGreaterThan(before)
  m._stopAll()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && npx vitest run tests/lazy.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现** — `server/src/lazy.js`

```js
import { createPoller } from './poller.js'

export function createLazyManager({ cache, logger, makeFetcher, idleMs = 60000 }) {
  const entries = new Map() // key -> { poller, lastSeen }

  function sweep() {
    const now = Date.now()
    for (const [key, e] of entries) {
      if (now - e.lastSeen > idleMs) {
        e.poller.stop()
        entries.delete(key)
        logger.info(`[懒加载] ${key} 空闲 ${idleMs}ms 停拉`)
      }
    }
  }
  const sweeper = setInterval(sweep, 10000)
  if (sweeper.unref) sweeper.unref()

  return {
    acquire(key) {
      let e = entries.get(key)
      if (!e) {
        const poller = createPoller({ key, intervalMs: 5000, fetcher: makeFetcher(key), cache, logger })
        e = { poller, lastSeen: Date.now() }
        entries.set(key, e)
        poller.start()
        logger.info(`[懒加载] ${key} 进入活跃清单`)
      } else {
        e.lastSeen = Date.now() // 续命
      }
    },
    getOrNull(key) { return cache.get(key) ?? null },
    _stopAll() { clearInterval(sweeper); for (const e of entries.values()) e.poller.stop() },
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && npx vitest run tests/lazy.test.js`
Expected: PASS（3 passed）

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangyida/astock-dashboard
git add server/src/lazy.js server/tests/lazy.test.js
git commit -m "feat(server): 按需懒加载（访问续命 last-seen + 60s 空闲停拉）"
```

---

## Task 9: 交易时段判定（session.js）

**Files:**
- Create: `server/src/session.js`
- Create: `server/tests/session.test.js`

**Interfaces:**
- Produces:
  - `isTradingTime(date)` → boolean。周一~五，且时间落在 09:30–11:30 或 13:00–15:00（本地时区按服务器，假设服务器为 Asia/Shanghai）。
  - `residentInterval(date)` → number。交易时段返回 3000，否则返回 30000。
  - `sessionLabel(date)` → string。`'交易中'` / `'午间休市'` / `'已收盘'` / `'未开盘'`。
  - 入参 `date` 必传（便于测试注入固定时间）。

- [ ] **Step 1: 写失败测试** — `server/tests/session.test.js`

```js
import { test, expect } from 'vitest'
import { isTradingTime, residentInterval, sessionLabel } from '../src/session.js'

// 2026-06-29 是周一
const at = (h, m) => new Date(2026, 5, 29, h, m, 0)

test('上午盘中为交易时段', () => {
  expect(isTradingTime(at(10, 0))).toBe(true)
})
test('午间休市非交易时段', () => {
  expect(isTradingTime(at(12, 0))).toBe(false)
  expect(sessionLabel(at(12, 0))).toBe('午间休市')
})
test('收盘后非交易时段', () => {
  expect(isTradingTime(at(15, 30))).toBe(false)
  expect(sessionLabel(at(15, 30))).toBe('已收盘')
})
test('周末非交易', () => {
  const sat = new Date(2026, 5, 27, 10, 0) // 周六
  expect(isTradingTime(sat)).toBe(false)
})
test('交易时段 resident 间隔 3s，否则 30s', () => {
  expect(residentInterval(at(10, 0))).toBe(3000)
  expect(residentInterval(at(20, 0))).toBe(30000)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && npx vitest run tests/session.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现** — `server/src/session.js`

```js
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
```

> 注：本计划默认服务器时区为 Asia/Shanghai。部署到非中国时区服务器时，在 Task 10 启动脚本里设 `TZ=Asia/Shanghai`（Step 中已含）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && npx vitest run tests/session.test.js`
Expected: PASS（5 passed）

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangyida/astock-dashboard
git add server/src/session.js server/tests/session.test.js
git commit -m "feat(server): A 股交易时段判定 + 频率切换"
```

---

## Task 10: API 路由 + 装配启动（routes.js + app.js）

**Files:**
- Modify: `server/src/app.js`
- Create: `server/src/routes.js`
- Create: `server/tests/routes.test.js`

**Interfaces:**
- Consumes: `cache.js`、`poller.js`、`lazy.js`、`fetch.js`、`endpoints.js(toSecid)`、`session.js`。
- Produces: `registerRoutes(app, { cache, lazy })` 注册：
  - `GET /api/overview` → `{ data, updatedAt, stale }`（含 `data.session` 标签）
  - `GET /api/ranking?type=up` → 信封；`type` 非法回退 `up`
  - `GET /api/sectors?type=industry` → 信封
  - `GET /api/sector/:code/stocks` → 信封；首次访问触发懒加载 acquire，**短连接立即返回当前缓存**（可能为 null，前端轮询下次即有数据）
  - `GET /api/stock/:code/timeline` → 信封；同上懒加载
  - 缓存命中打 `[缓存] <path> 命中` 日志（debug 级）。
  - `buildApp()` 改为：建 cache、注册常驻 3 poller（overview 3s/ranking×4 3s/sectors 5s）、建 lazy manager、注册路由。

- [ ] **Step 1: 写失败测试** — `server/tests/routes.test.js`

```js
import { test, expect, vi } from 'vitest'
import Fastify from 'fastify'
import { registerRoutes } from '../src/routes.js'
import { createCache } from '../src/cache.js'

function fakeLazy(cache) {
  return {
    acquire: vi.fn(() => () => {}),
    getOrNull: (key) => cache.get(key) ?? null,
  }
}

test('/api/overview 返回信封结构', async () => {
  const cache = createCache()
  cache.set('overview', { indices: [{ code: '000001' }] })
  const app = Fastify()
  registerRoutes(app, { cache, lazy: fakeLazy(cache) })
  const res = await app.inject({ url: '/api/overview' })
  const body = res.json()
  expect(body).toHaveProperty('data')
  expect(body).toHaveProperty('updatedAt')
  expect(body).toHaveProperty('stale')
  await app.close()
})

test('/api/ranking 非法 type 回退 up', async () => {
  const cache = createCache()
  cache.set('ranking:up', [{ code: '600000' }])
  const app = Fastify()
  registerRoutes(app, { cache, lazy: fakeLazy(cache) })
  const res = await app.inject({ url: '/api/ranking?type=xxx' })
  expect(res.json().data[0].code).toBe('600000')
  await app.close()
})

test('/api/sector/:code/stocks 触发 lazy.acquire', async () => {
  const cache = createCache()
  const lazy = fakeLazy(cache)
  const app = Fastify()
  registerRoutes(app, { cache, lazy })
  await app.inject({ url: '/api/sector/BK0475/stocks' })
  expect(lazy.acquire).toHaveBeenCalledWith('sector:BK0475')
  await app.close()
})

test('缓存为空时返回 data:null 而非报错', async () => {
  const cache = createCache()
  const app = Fastify()
  registerRoutes(app, { cache, lazy: fakeLazy(cache) })
  const res = await app.inject({ url: '/api/overview' })
  expect(res.statusCode).toBe(200)
  expect(res.json().data).toBeNull()
  await app.close()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && npx vitest run tests/routes.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现** — `server/src/routes.js`

```js
import { sessionLabel } from './session.js'

function envelope(entry) {
  if (!entry) return { data: null, updatedAt: null, stale: true }
  return { data: entry.data, updatedAt: entry.updatedAt, stale: entry.stale }
}

const RANKING_TYPES = new Set(['up', 'down', 'amplitude', 'turnover'])

export function registerRoutes(app, { cache, lazy }) {
  app.get('/api/overview', async () => {
    const env = envelope(cache.get('overview'))
    if (env.data) env.data = { ...env.data, session: sessionLabel(new Date()) }
    return env
  })

  app.get('/api/ranking', async (req) => {
    const type = RANKING_TYPES.has(req.query.type) ? req.query.type : 'up'
    return envelope(cache.get(`ranking:${type}`))
  })

  app.get('/api/sectors', async (req) => {
    const type = req.query.type === 'concept' ? 'concept' : 'industry'
    return envelope(cache.get(`sectors:${type}`))
  })

  app.get('/api/sector/:code/stocks', async (req) => {
    const key = `sector:${req.params.code}`
    lazy.acquire(key) // 触发懒加载（短连接不持有 release，靠 idle 自然回收）
    return envelope(lazy.getOrNull(key))
  })

  app.get('/api/stock/:code/timeline', async (req) => {
    const key = `timeline:${req.params.code}`
    lazy.acquire(key)
    return envelope(lazy.getOrNull(key))
  })
}
```

> 懒加载模型说明：`lazy.acquire(key)` 用的是 Task 8 已实现的**访问续命（last-seen）模型**——HTTP 短连接每次请求只刷新 `lastSeen`，后台 sweeper 在 `idleMs` 无访问后停拉。路由层每次请求调一次 `acquire(key)` 续命即可，无需 release。

- [ ] **Step 4: 改写 app.js 装配** — `server/src/app.js`

```js
import Fastify from 'fastify'
import { createCache } from './cache.js'
import { createPoller } from './poller.js'
import { createLazyManager } from './lazy.js'
import { registerRoutes } from './routes.js'
import { fetchOverview, fetchRanking, fetchSectors, fetchSectorStocks, fetchTimeline } from './eastmoney/fetch.js'
import { toSecid } from './eastmoney/endpoints.js'
import { residentInterval, isTradingTime } from './session.js'

export function buildApp({ startPollers = true } = {}) {
  const app = Fastify({ logger: { transport: { target: 'pino-pretty' } } })
  const cache = createCache()
  const log = app.log

  // 懒加载 fetcher 路由：key 形如 sector:BK0475 / timeline:600000
  const makeFetcher = (key) => {
    const [kind, id] = key.split(':')
    if (kind === 'sector') return () => fetchSectorStocks(id)
    if (kind === 'timeline') return () => fetchTimeline(toSecid({ code: id }))
    return async () => null
  }
  const lazy = createLazyManager({ cache, logger: log, makeFetcher, idleMs: 60000 })

  // 非交易时段降频：概览/榜单 3s→30s；板块 5s→30s
  const sectorInterval = (d) => (isTradingTime(d) ? 5000 : 30000)

  const pollers = []
  if (startPollers) {
    pollers.push(createPoller({ key: 'overview', intervalMs: 3000, intervalFn: residentInterval, fetcher: fetchOverview, cache, logger: log }))
    for (const type of ['up', 'down', 'amplitude', 'turnover']) {
      pollers.push(createPoller({ key: `ranking:${type}`, intervalMs: 3000, intervalFn: residentInterval, fetcher: () => fetchRanking(type), cache, logger: log }))
    }
    for (const type of ['industry', 'concept']) {
      pollers.push(createPoller({ key: `sectors:${type}`, intervalMs: 5000, intervalFn: sectorInterval, fetcher: () => fetchSectors(type), cache, logger: log }))
    }
    pollers.forEach((p) => p.start())
    log.info(`[启动] 常驻拉取器已开启 ${pollers.length} 个`)
  }

  app.get('/health', async () => ({ status: 'ok' }))
  registerRoutes(app, { cache, lazy })

  app.addHook('onClose', async () => { pollers.forEach((p) => p.stop()); lazy._stopAll() })
  return app
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.env.TZ = process.env.TZ ?? 'Asia/Shanghai'
  const app = buildApp()
  const port = Number(process.env.PORT ?? 3000)
  app.listen({ port, host: '0.0.0.0' })
    .then(() => app.log.info(`[启动] 盯盘后端监听 :${port}（TZ=${process.env.TZ}）`))
    .catch((err) => { app.log.error(err); process.exit(1) })
}
```

> 注意：`health.test.js` 调用 `buildApp()` 会启动常驻 poller 打真实网络。改 `health.test.js` 用 `buildApp({ startPollers: false })`，并在断言后 `await app.close()`。

- [ ] **Step 5: 更新 health 测试避免起 poller**

修改 `server/tests/health.test.js` 第 5 行：`const app = buildApp({ startPollers: false })`。

- [ ] **Step 6: 跑全部后端测试**

Run: `cd server && npx vitest run`
Expected: PASS（所有文件，含 routes 4 + lazy 3 重写 + 其余）

- [ ] **Step 7: 真实启动冒烟**

```bash
cd server && (node src/app.js &) && sleep 6 && \
curl -s localhost:3000/api/overview | head -c 400 && echo && \
curl -s 'localhost:3000/api/ranking?type=up' | head -c 400 && echo && \
kill %1 2>/dev/null
```
Expected: 两条 curl 都返回含 `"data"` 且 `data` 非 null 的 JSON（盘中数据有值；非交易时段可能是上次收盘值或 null，但结构正确）。输出 ✅/❌。

- [ ] **Step 8: Commit**

```bash
cd /Users/zhangyida/astock-dashboard
git add server/src/routes.js server/src/app.js server/src/lazy.js server/tests/
git commit -m "feat(server): /api/* 路由 + 常驻拉取装配 + 懒加载续命模型"
```

---

## Task 11: 前端脚手架 + dev 代理

**Files:**
- Create: `web/`（Vite 官方 vue 模板）
- Modify: `web/vite.config.js`
- Modify: `web/package.json`

**Interfaces:**
- Produces: 可 `npm run dev` 启动的 Vue 3 工程；dev server 把 `/api` 代理到 `http://localhost:3000`。

- [ ] **Step 1: 用 Vite 创建 vue 工程**

```bash
cd /Users/zhangyida/astock-dashboard
npm create vite@latest web -- --template vue
cd web
npm install --include=optional
npm install echarts@^5
npm install -D vitest@^3 @vue/test-utils@^2 jsdom@^25 --include=optional
npm pkg set scripts.test="vitest run"
```

- [ ] **Step 2: 配置 dev 代理 + 测试环境** — `web/vite.config.js`

```js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
```

- [ ] **Step 3: 验证脚手架能起**

```bash
cd web && timeout 8 npm run dev > /tmp/vite.log 2>&1; grep -q "Local:" /tmp/vite.log && echo "✅ dev 起得来" || (cat /tmp/vite.log && echo "❌")
```
Expected: ✅ dev 起得来

- [ ] **Step 4: Commit**

```bash
cd /Users/zhangyida/astock-dashboard
git add web/
git commit -m "feat(web): Vite+Vue 脚手架 + /api dev 代理 + vitest 配置"
```

---

## Task 12: 格式化纯函数（format.js）

**Files:**
- Create: `web/src/format.js`
- Create: `web/tests/format.test.js`

**Interfaces:**
- Produces:
  - `changeColor(pct)` → `'up'|'down'|'flat'`（pct>0→up, <0→down, =0/null→flat）。**红涨绿跌**由 CSS 类承载，此函数只给语义类名。
  - `fmtPct(n)` → string，如 `+1.23%` / `-0.50%` / `—`（null）。
  - `fmtPrice(n)` → string，保留 2 位；null→`—`。
  - `fmtAmount(n)` → string，亿/万自适应，如 `1.2亿` / `3450万`。

- [ ] **Step 1: 写失败测试** — `web/tests/format.test.js`

```js
import { test, expect } from 'vitest'
import { changeColor, fmtPct, fmtPrice, fmtAmount } from '../src/format.js'

test('changeColor 语义', () => {
  expect(changeColor(1.2)).toBe('up')
  expect(changeColor(-0.3)).toBe('down')
  expect(changeColor(0)).toBe('flat')
  expect(changeColor(null)).toBe('flat')
})
test('fmtPct 带符号两位', () => {
  expect(fmtPct(1.2)).toBe('+1.20%')
  expect(fmtPct(-0.5)).toBe('-0.50%')
  expect(fmtPct(null)).toBe('—')
})
test('fmtPrice', () => {
  expect(fmtPrice(12.3)).toBe('12.30')
  expect(fmtPrice(null)).toBe('—')
})
test('fmtAmount 亿万自适应', () => {
  expect(fmtAmount(120000000)).toBe('1.20亿')
  expect(fmtAmount(34500000)).toBe('3450万')
  expect(fmtAmount(null)).toBe('—')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run tests/format.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现** — `web/src/format.js`

```js
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd web && npx vitest run tests/format.test.js`
Expected: PASS（4 passed）

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangyida/astock-dashboard
git add web/src/format.js web/tests/format.test.js
git commit -m "feat(web): 格式化纯函数（红涨绿跌语义 + 金额自适应）"
```

---

## Task 13: 轮询组合式函数（usePolling.js）

**Files:**
- Create: `web/src/usePolling.js`
- Create: `web/src/api.js`
- Create: `web/tests/usePolling.test.js`

**Interfaces:**
- Consumes: `api.js` 的 `getJson(path)`。
- Produces:
  - `getJson(path)`（api.js）→ `Promise<{data,updatedAt,stale}>`，失败抛错。
  - `usePolling(path, intervalMs)`（usePolling.js）→ `{ data, updatedAt, stale, error, start, stop }`（均为 ref）。
    - `start()`：立即拉一次，再周期拉；监听 `document.visibilitychange`，隐藏时 stop、显示时立即拉。
    - 连续失败累计 ≥3 次才把 `error` 置真；任一次成功清零。
    - 成功时更新 `data/updatedAt/stale`。

- [ ] **Step 1: 写 api.js**（无独立测试，被 usePolling 测试覆盖）— `web/src/api.js`

```js
export async function getJson(path) {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`接口 ${path} 返回 ${res.status}`)
  return res.json()
}
```

- [ ] **Step 2: 写失败测试** — `web/tests/usePolling.test.js`

```js
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { usePolling } from '../src/usePolling.js'
import * as api from '../src/api.js'

beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

test('start 立即拉一次并填充 data', async () => {
  vi.spyOn(api, 'getJson').mockResolvedValue({ data: [1], updatedAt: 123, stale: false })
  const p = usePolling('/api/ranking', 3000)
  p.start()
  await vi.advanceTimersByTimeAsync(0)
  expect(p.data.value).toEqual([1])
  expect(p.stale.value).toBe(false)
  p.stop()
})

test('连续 3 次失败才置 error', async () => {
  vi.spyOn(api, 'getJson').mockRejectedValue(new Error('x'))
  const p = usePolling('/api/ranking', 1000)
  p.start()
  await vi.advanceTimersByTimeAsync(0)
  expect(p.error.value).toBeFalsy() // 第 1 次失败不报
  await vi.advanceTimersByTimeAsync(1000)
  await vi.advanceTimersByTimeAsync(1000)
  expect(p.error.value).toBeTruthy() // 第 3 次
  p.stop()
})

test('stop 后不再拉', async () => {
  const spy = vi.spyOn(api, 'getJson').mockResolvedValue({ data: [], updatedAt: 1, stale: false })
  const p = usePolling('/api/x', 1000)
  p.start(); await vi.advanceTimersByTimeAsync(0); p.stop()
  await vi.advanceTimersByTimeAsync(5000)
  expect(spy).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd web && npx vitest run tests/usePolling.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 4: 写实现** — `web/src/usePolling.js`

```js
import { ref } from 'vue'
import { getJson } from './api.js'

export function usePolling(path, intervalMs) {
  const data = ref(null)
  const updatedAt = ref(null)
  const stale = ref(false)
  const error = ref(false)
  let timer = null
  let fails = 0
  let stopped = true

  async function tick() {
    try {
      const env = await getJson(path)
      data.value = env.data
      updatedAt.value = env.updatedAt
      stale.value = env.stale
      fails = 0
      error.value = false
    } catch {
      fails += 1
      if (fails >= 3) error.value = true
    } finally {
      if (!stopped) timer = setTimeout(tick, intervalMs)
    }
  }

  function onVisibility() {
    if (document.hidden) { if (timer) clearTimeout(timer); timer = null }
    else if (!stopped) tick()
  }

  return {
    data, updatedAt, stale, error,
    start() {
      stopped = false
      document.addEventListener('visibilitychange', onVisibility)
      tick()
    },
    stop() {
      stopped = true
      if (timer) clearTimeout(timer); timer = null
      document.removeEventListener('visibilitychange', onVisibility)
    },
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd web && npx vitest run tests/usePolling.test.js`
Expected: PASS（3 passed）

- [ ] **Step 6: Commit**

```bash
cd /Users/zhangyida/astock-dashboard
git add web/src/api.js web/src/usePolling.js web/tests/usePolling.test.js
git commit -m "feat(web): usePolling 轮询（隐藏暂停 + 3 连败才报错）"
```

---

## Task 14: 顶部概览条（OverviewBar.vue）

**Files:**
- Create: `web/src/components/OverviewBar.vue`
- Create: `web/tests/components/OverviewBar.test.js`
- Create: `web/src/theme.css`

**Interfaces:**
- Consumes: `usePolling('/api/overview', 3000)`、`format.js`。
- Produces: `<OverviewBar />` 渲染三大指数（带涨跌色）+ session 标签 + 「N 秒前更新 / stale 提示」。

- [ ] **Step 1: 写主题色 CSS** — `web/src/theme.css`

```css
:root { --up: #e53935; --down: #1 db954; --flat: #888; --bg: #14161a; --fg: #e8e8e8; }
.up { color: var(--up); }
.down { color: var(--down); }
.flat { color: var(--flat); }
.cell-flash-up { animation: flashUp .6s ease-out; }
.cell-flash-down { animation: flashDown .6s ease-out; }
@keyframes flashUp { from { background: rgba(229,57,53,.5); } to { background: transparent; } }
@keyframes flashDown { from { background: rgba(29,185,84,.5); } to { background: transparent; } }
.mono { font-variant-numeric: tabular-nums; font-family: ui-monospace, Menlo, monospace; }
```

> 修正：CSS 中 `--down` 值写成 `#1db954`（绿色），上面误含空格，实施时写为 `--down: #1db954;`。

- [ ] **Step 2: 写失败测试** — `web/tests/components/OverviewBar.test.js`

```js
import { test, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import OverviewBar from '../../src/components/OverviewBar.vue'
import * as api from '../../src/api.js'

afterEach(() => vi.restoreAllMocks())

test('渲染指数名称与涨跌色', async () => {
  vi.spyOn(api, 'getJson').mockResolvedValue({
    data: { indices: [{ code: '000001', name: '上证指数', price: 3021.5, changePct: 0.8 }], session: '交易中' },
    updatedAt: Date.now(), stale: false,
  })
  const w = mount(OverviewBar)
  await new Promise((r) => setTimeout(r, 10))
  await w.vm.$nextTick()
  expect(w.text()).toContain('上证指数')
  expect(w.text()).toContain('交易中')
  expect(w.find('.up').exists()).toBe(true)
  w.unmount()
})

test('stale 时显示快照提示', async () => {
  vi.spyOn(api, 'getJson').mockResolvedValue({
    data: { indices: [], session: '已收盘' }, updatedAt: Date.now() - 9000, stale: true,
  })
  const w = mount(OverviewBar)
  await new Promise((r) => setTimeout(r, 10))
  await w.vm.$nextTick()
  expect(w.text()).toMatch(/快照|中断/)
  w.unmount()
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd web && npx vitest run tests/components/OverviewBar.test.js`
Expected: FAIL（组件不存在）

- [ ] **Step 4: 写实现** — `web/src/components/OverviewBar.vue`

```vue
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
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd web && npx vitest run tests/components/OverviewBar.test.js`
Expected: PASS（2 passed）

- [ ] **Step 6: Commit**

```bash
cd /Users/zhangyida/astock-dashboard
git add web/src/theme.css web/src/components/OverviewBar.vue web/tests/components/OverviewBar.test.js
git commit -m "feat(web): 顶部概览条 + 主题色 + 心跳/stale 提示"
```

---

## Task 15: 涨跌幅榜（RankingTable.vue）

**Files:**
- Create: `web/src/components/RankingTable.vue`
- Create: `web/src/useFlash.js`
- Create: `web/tests/components/RankingTable.test.js`
- Create: `web/tests/useFlash.test.js`

**Interfaces:**
- Consumes: `usePolling`、`format.js`。
- Produces:
  - `useFlash()`（useFlash.js）→ `{ flashClass(code, value) }`：记住每个 code 上次的 value，本次不同则返回 `'cell-flash-up'`/`'cell-flash-down'`（按新旧值大小），相同返回 `''`。
  - `<RankingTable />`：4 个 tab（涨幅/跌幅/振幅/换手）切换 `type`，表格渲染前 50，行点击 `emit('pick-stock', code)`。

- [ ] **Step 1: 写 useFlash 失败测试** — `web/tests/useFlash.test.js`

```js
import { test, expect } from 'vitest'
import { useFlash } from '../src/useFlash.js'

test('首次无 flash，变大 flash up，变小 flash down', () => {
  const { flashClass } = useFlash()
  expect(flashClass('600000', 10)).toBe('')      // 首次
  expect(flashClass('600000', 10)).toBe('')      // 没变
  expect(flashClass('600000', 11)).toBe('cell-flash-up')
  expect(flashClass('600000', 9)).toBe('cell-flash-down')
})
```

- [ ] **Step 2: 跑测试确认失败 + 写 useFlash** — `web/src/useFlash.js`

Run: `cd web && npx vitest run tests/useFlash.test.js` → FAIL，然后：

```js
export function useFlash() {
  const last = new Map()
  return {
    flashClass(code, value) {
      const prev = last.get(code)
      last.set(code, value)
      if (prev === undefined || value === prev) return ''
      return value > prev ? 'cell-flash-up' : 'cell-flash-down'
    },
  }
}
```

Run 同命令 → PASS（1 passed）

- [ ] **Step 3: 写组件失败测试** — `web/tests/components/RankingTable.test.js`

```js
import { test, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import RankingTable from '../../src/components/RankingTable.vue'
import * as api from '../../src/api.js'

afterEach(() => vi.restoreAllMocks())
const wait = () => new Promise((r) => setTimeout(r, 10))

test('渲染榜单行并涨红', async () => {
  vi.spyOn(api, 'getJson').mockResolvedValue({
    data: [{ code: '600000', name: '浦发银行', price: 10, changePct: 5.1 }],
    updatedAt: Date.now(), stale: false,
  })
  const w = mount(RankingTable)
  await wait(); await w.vm.$nextTick()
  expect(w.text()).toContain('浦发银行')
  expect(w.find('.up').exists()).toBe(true)
  w.unmount()
})

test('点行 emit pick-stock', async () => {
  vi.spyOn(api, 'getJson').mockResolvedValue({
    data: [{ code: '600000', name: '浦发', price: 10, changePct: 1 }], updatedAt: 1, stale: false,
  })
  const w = mount(RankingTable)
  await wait(); await w.vm.$nextTick()
  await w.find('tbody tr').trigger('click')
  expect(w.emitted('pick-stock')[0]).toEqual(['600000'])
  w.unmount()
})
```

- [ ] **Step 4: 跑测试确认失败**

Run: `cd web && npx vitest run tests/components/RankingTable.test.js`
Expected: FAIL（组件不存在）

- [ ] **Step 5: 写实现** — `web/src/components/RankingTable.vue`

```vue
<script setup>
import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
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

let poll = usePolling(`/api/ranking?type=${type.value}`, 3000)
poll.start()
const rows = computed(() => poll.data.value ?? [])

watch(type, (t) => {
  poll.stop()
  poll = usePolling(`/api/ranking?type=${t}`, 3000)
  poll.start()
})
onMounted(() => {})
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
        <tr v-for="(r, i) in rows" :key="r.code" @click="emit('pick-stock', r.code)">
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
```

- [ ] **Step 6: 跑测试确认通过**

Run: `cd web && npx vitest run tests/components/RankingTable.test.js`
Expected: PASS（2 passed）

- [ ] **Step 7: Commit**

```bash
cd /Users/zhangyida/astock-dashboard
git add web/src/components/RankingTable.vue web/src/useFlash.js web/tests/useFlash.test.js web/tests/components/RankingTable.test.js
git commit -m "feat(web): 涨跌幅榜（4 tab + 变化闪烁 + 点击下钻 emit）"
```

---

## Task 16: 板块异动 + 成分股下钻（SectorPanel.vue + SectorStocks.vue）

**Files:**
- Create: `web/src/components/SectorPanel.vue`
- Create: `web/src/components/SectorStocks.vue`
- Create: `web/tests/components/SectorPanel.test.js`

**Interfaces:**
- Consumes: `usePolling`、`format.js`。
- Produces:
  - `<SectorStocks :code="boardCode" />`：轮询 `/api/sector/:code/stocks`，渲染成分股小榜；行点击 `emit('pick-stock', code)`。
  - `<SectorPanel />`：行业/概念 tab + 板块榜；点板块行展开 `<SectorStocks>`（同一时刻只展开一个）；转发子组件的 `pick-stock`。

- [ ] **Step 1: 写失败测试** — `web/tests/components/SectorPanel.test.js`

```js
import { test, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import SectorPanel from '../../src/components/SectorPanel.vue'
import * as api from '../../src/api.js'

afterEach(() => vi.restoreAllMocks())
const wait = () => new Promise((r) => setTimeout(r, 10))

test('渲染板块并点击展开成分股', async () => {
  vi.spyOn(api, 'getJson').mockImplementation(async (path) => {
    if (path.includes('/sectors')) return { data: [{ code: 'BK0475', name: '半导体', changePct: 3.2, leader: '中芯国际' }], updatedAt: 1, stale: false }
    return { data: [{ code: '688981', name: '中芯国际', price: 50, changePct: 4.0 }], updatedAt: 1, stale: false }
  })
  const w = mount(SectorPanel)
  await wait(); await w.vm.$nextTick()
  expect(w.text()).toContain('半导体')
  await w.find('tbody tr').trigger('click')
  await wait(); await w.vm.$nextTick()
  expect(w.text()).toContain('中芯国际')
  w.unmount()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run tests/components/SectorPanel.test.js`
Expected: FAIL（组件不存在）

- [ ] **Step 3: 写 SectorStocks** — `web/src/components/SectorStocks.vue`

```vue
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
      <tr v-for="r in rows" :key="r.code" @click.stop="emit('pick-stock', r.code)">
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
```

- [ ] **Step 4: 写 SectorPanel** — `web/src/components/SectorPanel.vue`

```vue
<script setup>
import { ref, watch, onUnmounted, computed } from 'vue'
import { usePolling } from '../usePolling.js'
import { changeColor, fmtPct } from '../format.js'
import SectorStocks from './SectorStocks.vue'

const emit = defineEmits(['pick-stock'])
const type = ref('industry')
const expanded = ref(null)

let poll = usePolling(`/api/sectors?type=${type.value}`, 5000)
poll.start()
const rows = computed(() => poll.data.value ?? [])

watch(type, (t) => {
  poll.stop(); expanded.value = null
  poll = usePolling(`/api/sectors?type=${t}`, 5000)
  poll.start()
})
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
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd web && npx vitest run tests/components/SectorPanel.test.js`
Expected: PASS（1 passed）

- [ ] **Step 6: Commit**

```bash
cd /Users/zhangyida/astock-dashboard
git add web/src/components/SectorPanel.vue web/src/components/SectorStocks.vue web/tests/components/SectorPanel.test.js
git commit -m "feat(web): 板块异动 + 点击展开成分股下钻"
```

---

## Task 17: 个股分时卡片（StockTimelineCard.vue）

**Files:**
- Create: `web/src/components/StockTimelineCard.vue`
- Create: `web/tests/components/StockTimelineCard.test.js`

**Interfaces:**
- Consumes: `usePolling`、`echarts`。
- Produces: `<StockTimelineCard :code="..." @close="..." />`：浮层卡片，轮询 `/api/stock/:code/timeline`，用 ECharts 画分时折线（价 + 均价）。`code` 变化时重新轮询；卸载时销毁 ECharts 实例。

- [ ] **Step 1: 写失败测试**（mock echarts，避免 jsdom 无 canvas）— `web/tests/components/StockTimelineCard.test.js`

```js
import { test, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import * as api from '../../src/api.js'

const setOption = vi.fn()
const dispose = vi.fn()
vi.mock('echarts', () => ({ init: () => ({ setOption, dispose, resize: vi.fn() }) }))

afterEach(() => vi.restoreAllMocks())
const wait = () => new Promise((r) => setTimeout(r, 10))

test('加载分时数据并 setOption', async () => {
  vi.spyOn(api, 'getJson').mockResolvedValue({
    data: { points: [{ time: '09:30', price: 10, avg: 10 }, { time: '09:31', price: 10.2, avg: 10.1 }] },
    updatedAt: 1, stale: false,
  })
  const { default: Card } = await import('../../src/components/StockTimelineCard.vue')
  const w = mount(Card, { props: { code: '600000' } })
  await wait(); await w.vm.$nextTick()
  expect(setOption).toHaveBeenCalled()
  w.unmount()
  expect(dispose).toHaveBeenCalled() // 卸载销毁
})

test('点关闭 emit close', async () => {
  vi.spyOn(api, 'getJson').mockResolvedValue({ data: { points: [] }, updatedAt: 1, stale: false })
  const { default: Card } = await import('../../src/components/StockTimelineCard.vue')
  const w = mount(Card, { props: { code: '600000' } })
  await wait()
  await w.find('.close').trigger('click')
  expect(w.emitted('close')).toBeTruthy()
  w.unmount()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run tests/components/StockTimelineCard.test.js`
Expected: FAIL（组件不存在）

- [ ] **Step 3: 写实现** — `web/src/components/StockTimelineCard.vue`

```vue
<script setup>
import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
import * as echarts from 'echarts'
import { usePolling } from '../usePolling.js'

const props = defineProps({ code: { type: String, required: true } })
const emit = defineEmits(['close'])
const chartEl = ref(null)
let chart = null

let poll = usePolling(`/api/stock/${props.code}/timeline`, 3000)
const points = computed(() => poll.data.value?.points ?? [])

function render() {
  if (!chart) return
  const pts = points.value
  chart.setOption({
    grid: { left: 48, right: 12, top: 16, bottom: 24 },
    xAxis: { type: 'category', data: pts.map((p) => p.time), axisLabel: { color: '#888' } },
    yAxis: { scale: true, axisLabel: { color: '#888' } },
    series: [
      { type: 'line', data: pts.map((p) => p.price), showSymbol: false, lineStyle: { color: '#e53935' }, name: '价格' },
      { type: 'line', data: pts.map((p) => p.avg), showSymbol: false, lineStyle: { color: '#f5a623' }, name: '均价' },
    ],
  })
}

watch(points, render)
watch(() => props.code, (c) => {
  poll.stop()
  poll = usePolling(`/api/stock/${c}/timeline`, 3000)
  poll.start()
})

onMounted(() => { chart = echarts.init(chartEl.value); poll.start() })
onUnmounted(() => { poll.stop(); if (chart) chart.dispose(); chart = null })
</script>

<template>
  <div class="card-overlay" @click.self="emit('close')">
    <div class="card">
      <div class="card-head"><span class="mono">{{ code }} 分时</span><button class="close" @click="emit('close')">✕</button></div>
      <div ref="chartEl" class="chart"></div>
    </div>
  </div>
</template>

<style scoped>
.card-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; z-index: 50; }
.card { width: 640px; max-width: 92vw; background: #14161a; border: 1px solid #333; border-radius: 8px; padding: 12px; }
.card-head { display: flex; justify-content: space-between; align-items: center; color: var(--fg); margin-bottom: 8px; }
.close { background: none; border: none; color: var(--fg); cursor: pointer; font-size: 16px; }
.chart { height: 300px; }
</style>
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd web && npx vitest run tests/components/StockTimelineCard.test.js`
Expected: PASS（2 passed）

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangyida/astock-dashboard
git add web/src/components/StockTimelineCard.vue web/tests/components/StockTimelineCard.test.js
git commit -m "feat(web): 个股分时卡片（ECharts + 卸载销毁实例）"
```

---

## Task 18: 整体装配（App.vue + main.js）

**Files:**
- Modify: `web/src/App.vue`
- Modify: `web/src/main.js`

**Interfaces:**
- Consumes: 全部组件。
- Produces: 顶部概览条 + 左右两栏（涨跌幅榜 60% / 板块异动 40%）+ 选中股票时弹出分时卡片。

- [ ] **Step 1: 改 main.js 引入主题** — `web/src/main.js`

```js
import { createApp } from 'vue'
import './theme.css'
import App from './App.vue'

createApp(App).mount('#app')
```

- [ ] **Step 2: 写 App.vue** — `web/src/App.vue`

```vue
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
      <section class="left"><h3>涨跌幅榜</h3><RankingTable @pick-stock="(c) => picked = c" /></section>
      <section class="right"><h3>板块异动</h3><SectorPanel @pick-stock="(c) => picked = c" /></section>
    </div>
    <StockTimelineCard v-if="picked" :code="picked" @close="picked = null" />
  </div>
</template>

<style scoped>
.app { background: var(--bg); min-height: 100vh; color: var(--fg); }
.main { display: flex; gap: 12px; padding: 12px; }
.left { flex: 6; } .right { flex: 4; }
h3 { margin: 6px 0; font-size: 14px; color: #aaa; }
</style>
```

- [ ] **Step 3: 跑全部前端测试确保未回归**

Run: `cd web && npx vitest run`
Expected: PASS（所有测试文件全绿）

- [ ] **Step 4: dev 启动 + 构建验证**

```bash
cd web && npm run build 2>&1 | tail -5
```
Expected: 出现 `built in` 字样，`dist/` 生成，无报错。输出 ✅/❌。

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangyida/astock-dashboard
git add web/src/App.vue web/src/main.js
git commit -m "feat(web): 整体布局装配 + 分时卡片联动"
```

---

## Task 19: 后端托管前端 + 端到端冒烟

**Files:**
- Modify: `server/src/app.js`
- Modify: `server/package.json`
- Create: `README.md`

**Interfaces:**
- Consumes: `web/dist`（Task 18 构建产物）。
- Produces: 生产模式下 `server` 同时托管 `web/dist`，单进程单端口对外（便于内网分享）。

- [ ] **Step 1: 装静态托管插件**

```bash
cd server && npm install @fastify/static@^8 --include=optional
```

- [ ] **Step 2: app.js 注册静态目录**（在 `registerRoutes` 之后、`return app` 之前加）

```js
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ...在 buildApp 内，registerRoutes(app, { cache, lazy }) 之后：
const distDir = fileURLToPath(new URL('../../web/dist', import.meta.url))
if (existsSync(distDir)) {
  app.register(fastifyStatic, { root: distDir })
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url.startsWith('/api')) return reply.code(404).send({ error: 'not found' })
    return reply.sendFile('index.html') // SPA 回退
  })
  log.info(`[启动] 托管前端 dist：${distDir}`)
} else {
  log.warn(`[启动] 未找到 web/dist，仅提供 /api（开发模式用 vite dev）`)
}
```

> 注意 import 语句加到 app.js 顶部。`@fastify/static` 需在 `setNotFoundHandler` 前 register。

- [ ] **Step 3: 写 README** — `README.md`

```markdown
# A 股全市场实时盯盘网页

全市场扫描盯盘：顶部概览 + 涨跌幅榜 + 板块异动 + 板块下钻 + 个股分时。数据来自东方财富免费接口，仅供参考，不构成投资建议。

## 开发
```bash
# 终端 1：后端
cd server && npm install && npm run dev
# 终端 2：前端（带 /api 代理）
cd web && npm install && npm run dev
```

## 部署（单进程，内网分享）
```bash
cd web && npm install && npm run build      # 产出 web/dist
cd ../server && npm install
TZ=Asia/Shanghai PORT=3000 npm start         # 浏览器开 http://<本机IP>:3000
```

## 测试
```bash
cd server && npm test    # 后端
cd web && npm test       # 前端
```
```

- [ ] **Step 4: 端到端冒烟（交易时段执行最佳）**

```bash
cd /Users/zhangyida/astock-dashboard/web && npm run build >/dev/null 2>&1
cd ../server && (TZ=Asia/Shanghai node src/app.js &) && sleep 6
echo "--- /api/overview ---"; curl -s localhost:3000/api/overview | head -c 300; echo
echo "--- 首页 ---"; curl -s localhost:3000/ | grep -o '<div id="app">' && echo "✅ 前端可访问"
kill %1 2>/dev/null
```
Expected: overview 返回含 `data`；首页返回含 `<div id="app">`。

- [ ] **Step 5: 人工冒烟清单**（浏览器开 `http://localhost:3000`，逐条打勾，输出 ✅/❌/⚠️）

```
[ ] 顶部三大指数有数、红涨绿跌正确
[ ] 涨跌幅榜在动，切 涨幅/跌幅/振幅/换手 tab 数据变
[ ] 现价跳动时单元格闪一下（涨闪红/跌闪绿）
[ ] 板块异动榜有数，切 行业/概念 正常
[ ] 点板块行展开成分股榜
[ ] 点个股弹出分时图卡片，价/均价两条线
[ ] 关闭卡片正常
[ ] 顶部「N 秒前更新」在跳秒
[ ] 断网 10 秒：顶部出现「⚠️ 快照」提示，界面不崩；恢复后自动复原
[ ] 切到别的浏览器 tab 再回来：立即刷新一次
```

- [ ] **Step 6: Commit**

```bash
cd /Users/zhangyida/astock-dashboard
git add server/src/app.js server/package.json server/package-lock.json README.md
git commit -m "feat: 后端托管前端 dist + 端到端冒烟 + README"
```

---

## Self-Review 结论

**1. Spec 覆盖**（逐节核对）
- 顶部概览/涨跌幅榜/板块异动 → Task 14/15/16 ✅
- 板块下钻成分股 → Task 16（SectorStocks）✅
- 个股分时卡片 → Task 17 ✅
- 后端主动拉 + 内存缓存 → Task 6/7/10 ✅
- 懒加载 + 60s 停拉 → Task 8（访问续命 last-seen 模型，Task 10 路由层每请求 acquire 续命）✅
- 失败降级保留旧快照 + stale → Task 7 + 信封 Task 10 + 前端提示 Task 14 ✅
- 交易时段频率切换 → Task 9（residentInterval/isTradingTime）→ Task 7 poller 的 `intervalFn` → Task 10 装配接线（overview/ranking 用 `residentInterval`，sectors 用 `sectorInterval`）✅
- 红涨绿跌 + 变化闪烁 → Task 12/14/15（theme.css + useFlash）✅
- 更新心跳 + 页面隐藏暂停 + 数字等宽 → Task 13/14（usePolling visibility + mono）✅
- 字段缺失跳过 + 退避 → Task 4/7 ✅
- 关键路径日志 → Task 7/8/10（pino + 中文前缀）✅
- 测试策略 5 类 → 适配层 Task 4 / 缓存懒加载 Task 6/8 / 契约 Task 10 / 前端组件 Task 13-17 / 冒烟 Task 19 ✅
- 内网分享单进程 → Task 19 ✅
- YAGNI 砍项（登录/K线/自选/移动端）→ 计划未引入 ✅

**2. 占位符扫描**：无 TBD/TODO。theme.css 的 `--down` 笔误已在 Task 14 Step 1 下方显式纠正为 `#1db954`。东方财富接口结构由 Task 3 真抓核验兜底。

**3. 类型一致性**：信封 `{data,updatedAt,stale}` 全链一致；`changeColor/fmtPct/fmtPrice/fmtAmount`、`usePolling` 返回 ref、`flashClass(code,value)` 各处签名一致；`buildApp({startPollers})`、`createLazyManager` 续命版 `_stopAll` 在 app.js onClose 调用一致；`createPoller` 的 `intervalFn` 在 Task 7 定义、Task 10 装配处使用，签名一致。

**接线点已闭合**：非交易时段降频已通过 `createPoller.intervalFn` 串起 Task 7/9/10，自检无悬空缺口。
