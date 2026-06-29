import Fastify from 'fastify'

export function buildApp() {
  const app = Fastify({
    logger: { transport: { target: 'pino-pretty' } },
  })
  app.get('/health', async () => ({ status: 'ok' }))
  return app
}

export default buildApp

// 直接运行时启动监听（被 import 时不启动，便于测试）
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = buildApp()
  const port = Number(process.env.PORT ?? 3000)
  app.listen({ port, host: '0.0.0.0' })
    .then(() => app.log.info(`[启动] 盯盘后端已监听 :${port}`))
    .catch((err) => { app.log.error(err); process.exit(1) })
}
