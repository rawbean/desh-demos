import Fastify from 'fastify'
import { RuntimeManager } from './runtime-manager.js'

const port = Number.parseInt(process.env.PORT ?? '3000', 10)

const runtime = new RuntimeManager({
  profile: process.env.DSH_PROFILE ?? 'sdk',
  provider: process.env.DSH_PROVIDER ?? 'deepseek-official',
  model: process.env.DSH_MODEL ?? 'deepseek-v4-flash',
  cwd: process.env.DSH_WORKSPACE ?? process.cwd(),
  dshHome: process.env.DSH_HOME ?? '/tmp/dsh-home',
  initializeTimeoutMs: Number.parseInt(
    process.env.DSH_INITIALIZE_TIMEOUT_MS ?? '10000',
    10,
  ),
})

const app = Fastify({ logger: true })

app.get('/', async () => ({
  demo: '01-runtime-lifecycle',
  endpoints: [
    'GET /health',
    'GET /runtime',
    'POST /runtime/start',
    'POST /runtime/stop',
  ],
}))

app.get('/health', async () => ({
  status: 'ok',
  runtime: runtime.status(),
}))

app.get('/runtime', async () => runtime.status())

app.post('/runtime/start', async (_request, reply) => {
  try {
    return await runtime.start()
  } catch (error) {
    return reply.code(503).send({
      ...runtime.status(),
      error: error instanceof Error ? error.message : String(error),
    })
  }
})

app.post('/runtime/stop', async (_request, reply) => {
  try {
    return await runtime.stop()
  } catch (error) {
    return reply.code(500).send({
      ...runtime.status(),
      error: error instanceof Error ? error.message : String(error),
    })
  }
})

app.addHook('onClose', async () => {
  await runtime.stop()
})

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down')
  await app.close()
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))

await app.listen({ host: '0.0.0.0', port })
