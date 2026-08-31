import Fastify from 'fastify'
import { registerMockProvider } from './mock-provider.js'
import { TaskExecutor } from './task-executor.js'

interface TaskBody {
  prompt?: unknown
}

const port = Number.parseInt(process.env.PORT ?? '3000', 10)
const app = Fastify({ logger: true })
const executor = new TaskExecutor({
  profile: process.env.DSH_PROFILE ?? 'sdk',
  provider: process.env.DSH_PROVIDER ?? 'deepseek-official',
  model: process.env.DSH_MODEL ?? 'deepseek-v4-flash',
  cwd: process.env.DSH_WORKSPACE ?? process.cwd(),
  dshHome: process.env.DSH_HOME ?? '/tmp/dsh-home',
  maxTokens: Number.parseInt(process.env.DSH_MAX_TOKENS ?? '2048', 10),
  initializeTimeoutMs: Number.parseInt(
    process.env.DSH_INITIALIZE_TIMEOUT_MS ?? '10000',
    10,
  ),
})

if (process.env.ENABLE_MOCK_PROVIDER === 'true') {
  registerMockProvider(app)
}

app.get('/', async () => ({
  demo: '02-task-execution',
  endpoints: ['GET /health', 'POST /tasks'],
}))

app.get('/health', async () => ({ status: 'ok' }))

app.post<{ Body: TaskBody }>('/tasks', async (request, reply) => {
  if (
    typeof request.body?.prompt !== 'string' ||
    request.body.prompt.trim().length === 0
  ) {
    return reply.code(400).send({ error: 'prompt must be a non-empty string' })
  }

  try {
    return await executor.execute(request.body.prompt)
  } catch (error) {
    request.log.error({ error }, 'task execution failed')
    return reply.code(502).send({
      error: error instanceof Error ? error.message : String(error),
    })
  }
})

app.addHook('onClose', async () => {
  await executor.close()
})

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down')
  await app.close()
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))

await app.listen({ host: '0.0.0.0', port })
