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
    lazy.acquire(key) // 触发懒加载续命（short-connection，每次请求刷新 lastSeen）
    return envelope(lazy.getOrNull(key))
  })

  app.get('/api/stock/:code/timeline', async (req) => {
    const market = req.query.market   // '0' | '1' | undefined
    const key = `timeline:${req.params.code}:${market ?? ''}`
    lazy.acquire(key)
    return envelope(lazy.getOrNull(key))
  })
}
