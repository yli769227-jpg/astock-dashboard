import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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

  // 懒加载 fetcher 路由：key 形如 sector:BK0475 / timeline:600000: / timeline:920819:0
  const makeFetcher = (key) => {
    const parts = key.split(':')
    const kind = parts[0]
    if (kind === 'sector') return () => fetchSectorStocks(parts[1])
    if (kind === 'timeline') {
      const code = parts[1]
      const market = parts[2] === '' || parts[2] === undefined ? undefined : Number(parts[2])
      return () => fetchTimeline(toSecid({ code, marketId: market }))
    }
    return async () => null
  }
  const lazy = createLazyManager({ cache, logger: log, makeFetcher, idleMs: 60000 })

  // 非交易时段降频：板块 5s→30s
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

  app.addHook('onClose', async () => { pollers.forEach((p) => p.stop()); lazy._stopAll() })
  return app
}

export default buildApp

// 直接运行时启动监听（被 import 时不启动，便于测试）
if (import.meta.url === `file://${process.argv[1]}`) {
  process.env.TZ = process.env.TZ ?? 'Asia/Shanghai'
  const app = buildApp()
  const port = Number(process.env.PORT ?? 3000)
  app.listen({ port, host: '0.0.0.0' })
    .then(() => app.log.info(`[启动] 盯盘后端监听 :${port}（TZ=${process.env.TZ}）`))
    .catch((err) => { app.log.error(err); process.exit(1) })
}
